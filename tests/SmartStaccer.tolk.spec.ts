import {
    Address,
    beginCell,
    Builder,
    Cell,
    Contract,
    contractAddress,
    ContractProvider,
    Sender,
    SendMode,
    toNano,
    TupleReader,
} from '@ton/core';
import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { runTolkCompiler } from '@ton/tolk-js';
import * as fs from 'fs';
import * as path from 'path';
import '@ton/test-utils';

// ── Opcodes: CRC32 over the message name (see contracts/smart_staccer.tolk) ────
const OP_NEW_SALE = 0xfeaec34b;
const OP_CLAIM_SALE = 0x81f78480;
const OP_WITHDRAW = 0x4ca83dc8;
const OP_ADMIN_WITHDRAW = 0x4fa215c9;

const toUsdt = (amount: number) => BigInt(Math.round(amount * 1_000_000));

/** VarUInteger 16 encoding, as used by `coins` in Tact and Tolk alike. */
function storeCoins(builder: Builder, amount: bigint) {
    const value = BigInt(amount);
    if (value === 0n) {
        return builder.storeUint(0, 4);
    }
    let hex = value.toString(16);
    if (hex.length % 2 !== 0) {
        hex = '0' + hex;
    }
    const bytes = Buffer.from(hex, 'hex');
    return builder.storeUint(bytes.length, 4).storeBuffer(bytes);
}

/**
 * Tolk serialises a map as a single 0 bit when empty and as 1 + a ref otherwise.
 * Both maps start empty, so storage is two addresses followed by two zero bits.
 */
function buildStorage(admin: Address, usdtWallet: Address) {
    return beginCell().storeAddress(admin).storeAddress(usdtWallet).storeBit(false).storeBit(false).endCell();
}

function addressOfStateInit(workchain: number, init: { code: Cell; data: Cell }) {
    return contractAddress(workchain, init);
}

async function compileTolk() {
    const result = await runTolkCompiler({
        entrypointFileName: 'contracts/smart_staccer.tolk',
        fsReadCallback: (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf-8'),
    });
    if (result.status === 'error') {
        throw new Error(`Tolk compilation failed:\n${result.message}`);
    }
    return result;
}

class SmartStaccerTolk implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell },
    ) {}

    static async fromInit(admin: Address, usdtWallet: Address) {
        const compiled = await compileTolk();
        const code = Cell.fromBoc(Buffer.from(compiled.codeBoc64, 'base64'))[0];
        const data = buildStorage(admin, usdtWallet);
        const init = { code, data };
        return new SmartStaccerTolk(addressOfStateInit(0, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, { value, sendMode: SendMode.PAY_GAS_SEPARATELY, body: beginCell().endCell() });
    }

    async sendNewSale(
        provider: ContractProvider,
        via: Sender,
        args: { saleId: bigint; creator: Address; usdtAmount: bigint; value?: bigint },
    ) {
        const body = storeCoins(
            beginCell().storeUint(OP_NEW_SALE, 32).storeUint(args.saleId, 64).storeAddress(args.creator),
            args.usdtAmount,
        ).endCell();
        await provider.internal(via, { value: args.value ?? toNano('0.05'), sendMode: SendMode.PAY_GAS_SEPARATELY, body });
    }

    async sendClaimSale(provider: ContractProvider, via: Sender, args: { saleId: bigint; value?: bigint }) {
        const body = beginCell().storeUint(OP_CLAIM_SALE, 32).storeUint(args.saleId, 64).endCell();
        await provider.internal(via, { value: args.value ?? toNano('0.05'), sendMode: SendMode.PAY_GAS_SEPARATELY, body });
    }

    async sendWithdraw(provider: ContractProvider, via: Sender, args: { amount: bigint; value?: bigint }) {
        const body = storeCoins(beginCell().storeUint(OP_WITHDRAW, 32), args.amount).endCell();
        await provider.internal(via, { value: args.value ?? toNano('0.05'), sendMode: SendMode.PAY_GAS_SEPARATELY, body });
    }

    async sendAdminWithdraw(
        provider: ContractProvider,
        via: Sender,
        args: { creator: Address; amount: bigint; value?: bigint },
    ) {
        const body = storeCoins(
            beginCell().storeUint(OP_ADMIN_WITHDRAW, 32).storeAddress(args.creator),
            args.amount,
        ).endCell();
        await provider.internal(via, { value: args.value ?? toNano('0.05'), sendMode: SendMode.PAY_GAS_SEPARATELY, body });
    }

    async getBalance(provider: ContractProvider, creator: Address): Promise<bigint> {
        const res = await provider.get('balance', [
            { type: 'slice', cell: beginCell().storeAddress(creator).endCell() },
        ]);
        return readStackCoins(res.stack);
    }

    async getSale(provider: ContractProvider, saleId: bigint) {
        const res = await provider.get('sale', [{ type: 'int', value: saleId }]);
        return res.stack;
    }

    async getContractTonBalance(provider: ContractProvider): Promise<bigint> {
        const res = await provider.get('contractTonBalance', []);
        return res.stack.readBigNumber();
    }
}

function readStackCoins(stack: TupleReader): bigint {
    return stack.readBigNumber();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SmartStaccer (Tolk port)', () => {
    let blockchain: Blockchain;
    let botAdmin: SandboxContract<TreasuryContract>;
    let creator: SandboxContract<TreasuryContract>;
    let mockUsdtWallet: SandboxContract<TreasuryContract>;
    let staccer: SandboxContract<SmartStaccerTolk>;

    const REGISTER_TWO_SALES = async () => {
        await staccer.sendNewSale(botAdmin.getSender(), {
            saleId: 101n,
            creator: creator.address,
            usdtAmount: toUsdt(50),
        });
        await staccer.sendNewSale(botAdmin.getSender(), {
            saleId: 102n,
            creator: creator.address,
            usdtAmount: toUsdt(30),
        });
    };

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        botAdmin = await blockchain.treasury('botAdmin');
        creator = await blockchain.treasury('creator');
        mockUsdtWallet = await blockchain.treasury('mockUsdtWallet');

        staccer = blockchain.openContract(await SmartStaccerTolk.fromInit(botAdmin.address, mockUsdtWallet.address));

        const deploy = await staccer.sendDeploy(botAdmin.getSender(), toNano('0.05'));
        expect(deploy.transactions).toHaveTransaction({ deploy: true, success: true });

        // Fund the gas tank with 2 TON so withdrawals can pay their own fees.
        await botAdmin.send({ to: staccer.address, value: toNano('2') });
    });

    it('compiles with Tolk', async () => {
        const compiled = await compileTolk();
        expect(compiled.codeHashHex).toHaveLength(64);
        expect(compiled.tolkVersion).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('accepts a gas-tank top-up with an empty body', async () => {
        const tonBalance = await staccer.getContractTonBalance();
        expect(tonBalance).toBeGreaterThan(toNano('2'));
    });

    it('rejects a sale registered by a non-admin (exit 401)', async () => {
        const r = await staccer.sendNewSale(creator.getSender(), {
            saleId: 999n,
            creator: creator.address,
            usdtAmount: toUsdt(100),
        });
        expect(r.transactions).toHaveTransaction({ to: staccer.address, success: false, exitCode: 401 });
    });

    it('rejects a dust sale below 1 USDT (exit 402)', async () => {
        const r = await staccer.sendNewSale(botAdmin.getSender(), {
            saleId: 100n,
            creator: creator.address,
            usdtAmount: toUsdt(0.5),
        });
        expect(r.transactions).toHaveTransaction({ to: staccer.address, success: false, exitCode: 402 });
    });

    it('rejects a claim for an unknown sale (exit 403)', async () => {
        const r = await staccer.sendClaimSale(creator.getSender(), { saleId: 4242n });
        expect(r.transactions).toHaveTransaction({ to: staccer.address, success: false, exitCode: 403 });
    });

    it('blocks an early claim (exit 404) and pays out after the 21-day lock', async () => {
        await REGISTER_TWO_SALES();

        const early = await staccer.sendClaimSale(creator.getSender(), { saleId: 101n });
        expect(early.transactions).toHaveTransaction({ to: staccer.address, success: false, exitCode: 404 });

        blockchain.now = Math.floor(Date.now() / 1000) + 22 * 24 * 60 * 60;

        await staccer.sendClaimSale(creator.getSender(), { saleId: 101n });
        await staccer.sendClaimSale(creator.getSender(), { saleId: 102n });

        expect(await staccer.getBalance(creator.address)).toBe(toUsdt(80));
    });

    it('enforces the 10 USDT minimum (exit 405) and pays out via AdminWithdraw', async () => {
        await REGISTER_TWO_SALES();
        blockchain.now = Math.floor(Date.now() / 1000) + 22 * 24 * 60 * 60;
        await staccer.sendClaimSale(creator.getSender(), { saleId: 101n });
        await staccer.sendClaimSale(creator.getSender(), { saleId: 102n });

        const tiny = await staccer.sendAdminWithdraw(botAdmin.getSender(), {
            creator: creator.address,
            amount: toUsdt(5),
        });
        expect(tiny.transactions).toHaveTransaction({ to: staccer.address, success: false, exitCode: 405 });

        await staccer.sendAdminWithdraw(botAdmin.getSender(), { creator: creator.address, amount: toUsdt(20) });

        expect(await staccer.getBalance(creator.address)).toBe(toUsdt(60));
    });

    it('lets a creator withdraw to their own address without the operator', async () => {
        await REGISTER_TWO_SALES();
        blockchain.now = Math.floor(Date.now() / 1000) + 22 * 24 * 60 * 60;
        await staccer.sendClaimSale(creator.getSender(), { saleId: 101n });
        await staccer.sendClaimSale(creator.getSender(), { saleId: 102n });

        await staccer.sendWithdraw(creator.getSender(), { amount: toUsdt(80) });

        expect(await staccer.getBalance(creator.address)).toBe(0n);
    });

    it('rejects an over-balance withdrawal (exit 406)', async () => {
        await REGISTER_TWO_SALES();
        blockchain.now = Math.floor(Date.now() / 1000) + 22 * 24 * 60 * 60;
        await staccer.sendClaimSale(creator.getSender(), { saleId: 101n });

        const r = await staccer.sendWithdraw(creator.getSender(), { amount: toUsdt(60) });
        expect(r.transactions).toHaveTransaction({ to: staccer.address, success: false, exitCode: 406 });
    });

    it('rejects an AdminWithdraw from a non-admin (exit 407)', async () => {
        await REGISTER_TWO_SALES();
        blockchain.now = Math.floor(Date.now() / 1000) + 22 * 24 * 60 * 60;
        await staccer.sendClaimSale(creator.getSender(), { saleId: 101n });

        const r = await staccer.sendAdminWithdraw(creator.getSender(), {
            creator: creator.address,
            amount: toUsdt(20),
        });
        expect(r.transactions).toHaveTransaction({ to: staccer.address, success: false, exitCode: 407 });
    });
});

import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { SmartStaccer } from '../wrappers/SmartStaccer/SmartStaccer_SmartStaccer';  
import '@ton/test-utils';

describe('SmartStaccer Complete Ecosystem Test', () => {
    let blockchain: Blockchain;
    let botAdmin: SandboxContract<TreasuryContract>;
    let creator: SandboxContract<TreasuryContract>;
    let mockUsdtWallet: SandboxContract<TreasuryContract>;
    let smartStaccer: SandboxContract<SmartStaccer>;

    // 6 decimals for USDT to match contract logic
    const toUsdt = (amount: number) => BigInt(amount * 1000000);

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        botAdmin = await blockchain.treasury('botAdmin');
        creator = await blockchain.treasury('creator');
        mockUsdtWallet = await blockchain.treasury('mockUsdtWallet');

        smartStaccer = blockchain.openContract(
            await SmartStaccer.fromInit(botAdmin.address, mockUsdtWallet.address)
        );

        // Deploy the contract
        await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, { $$type: 'Deploy', queryId: 0n });
        
        // Fund the contract's "Gas Tank" with 2 TON so it can pay for withdrawals
        await smartStaccer.send(botAdmin.getSender(), { value: toNano('2') }, null);
    });

    it('should pass full lifecycle: security, limits, claims, and 0-fee withdrawal', async () => {
        console.log("\n--- STARTING COMPREHENSIVE TEST ---");

        // 1. UNAUTHORIZED SALE ATTEMPT
        console.log("TEST 1: Non-admin trying to register sale...");
        const hackerResult = await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, {
            $$type: 'NewSale', saleId: 999n, creator: creator.address, usdtAmount: toUsdt(100)
        });
        expect(hackerResult.transactions).toHaveTransaction({ from: creator.address, success: false });
        console.log("✅ Blocked: Hacker cannot create sales.");

        // 2. BELOW MINIMUM SALE ATTEMPT
        console.log("TEST 2: Admin registering a sale under 1 USDT limit...");
        const tinySale = await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, {
            $$type: 'NewSale', saleId: 100n, creator: creator.address, usdtAmount: toUsdt(0.5) // 0.5 USDT
        });
        expect(tinySale.transactions).toHaveTransaction({ success: false });
        console.log("✅ Blocked: Dust sales (< 1 USDT) rejected to save storage.");

        // 3. REGISTER TWO VALID SALES
        console.log("TEST 3: Registering 2 valid sales (50 USDT and 30 USDT)...");
        await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, {
            $$type: 'NewSale', saleId: 101n, creator: creator.address, usdtAmount: toUsdt(50)
        });
        await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, {
            $$type: 'NewSale', saleId: 102n, creator: creator.address, usdtAmount: toUsdt(30)
        });

        const sale1 = await smartStaccer.getSale(101n);
        console.log(`Sale 101 Confirmed: Lock expires at timestamp ${sale1?.releaseTime}`);

        // 4. EARLY CLAIM ATTEMPT
        console.log("TEST 4: Attempting claim BEFORE 21 days...");
        const earlyClaim = await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, {
            $$type: 'ClaimSale', saleId: 101n
        });
        expect(earlyClaim.transactions).toHaveTransaction({ success: false });
        console.log("✅ Blocked: 21-day lockup holds strong.");

        // 5. TIME TRAVEL & CLAIM
        console.log("TEST 5: Time traveling 22 days into the future...");
        blockchain.now = Math.floor(Date.now() / 1000) + (22 * 24 * 60 * 60);

        await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, { $$type: 'ClaimSale', saleId: 101n });
        await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, { $$type: 'ClaimSale', saleId: 102n });

        const poolBalance = await smartStaccer.getBalance(creator.address);
        expect(poolBalance).toBe(toUsdt(80)); // 50 + 30
        console.log(`✅ Success: Creator available pool is now ${poolBalance} (80 USDT).`);

        // 6. WITHDRAW BELOW MINIMUM
        console.log("TEST 6: Creator trying to withdraw 5 USDT (Below 10 USDT minimum)...");
        const tinyWithdraw = await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, { 
            $$type: 'AdminWithdraw', creator: creator.address, amount: toUsdt(5) 
        });
        expect(tinyWithdraw.transactions).toHaveTransaction({ success: false });
        console.log("✅ Blocked: Minimum withdrawal limits enforced.");

        // 7. ZERO-FEE ADMIN WITHDRAWAL
        console.log("TEST 7: Bot triggering a 20 USDT withdrawal on behalf of the creator (0 Gas for creator)...");
        await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, { 
            $$type: 'AdminWithdraw', creator: creator.address, amount: toUsdt(20) 
        });

        const finalBalance = await smartStaccer.getBalance(creator.address);
        expect(finalBalance).toBe(toUsdt(60)); // 80 - 20
        console.log(`✅ Success: 20 USDT withdrawn. Remaining pool balance is ${finalBalance} (60 USDT).`);

        console.log("--- ALL SECURE LOGIC VERIFIED --- \n");
    });
});

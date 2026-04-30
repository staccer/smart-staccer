import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { toNano } from '@ton/core';
import { SmartStaccer } from '../wrappers/SmartStaccer/SmartStaccer_SmartStaccer'; 
import '@ton/test-utils';

describe('SmartStaccer Security & Multi-Sale Test', () => {
    let blockchain: Blockchain;
    let botAdmin: SandboxContract<TreasuryContract>;
    let creator: SandboxContract<TreasuryContract>;
    let mockUsdtWallet: SandboxContract<TreasuryContract>;
    let smartStaccer: SandboxContract<SmartStaccer>;

    beforeEach(async () => {
        blockchain = await Blockchain.create();
        botAdmin = await blockchain.treasury('botAdmin');
        creator = await blockchain.treasury('creator');
        mockUsdtWallet = await blockchain.treasury('mockUsdtWallet');

        smartStaccer = blockchain.openContract(
            await SmartStaccer.fromInit(botAdmin.address, mockUsdtWallet.address)
        );

        await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, { $$type: 'Deploy', queryId: 0n });
    });

    it('should pass all security and multi-sale scenarios', async () => {
        console.log("--- STARTING SECURITY & MULTI-SALE TEST ---");

        // 1. UNAUTHORIZED SALE ATTEMPT
        console.log("TEST: Attempting to register sale as non-admin (Should fail)...");
        const hackerResult = await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, {
            $$type: 'NewSale', saleId: 999n, creator: creator.address, usdtAmount: toNano('1000')
        });
        
        expect(hackerResult.transactions).toHaveTransaction({
            from: creator.address,
            to: smartStaccer.address,
            success: false
        });
        console.log("✅ Security Verified: Non-admin cannot create sales.");

        // 2. TWO SALES REGISTRATION
        console.log("TEST: Registering 2 sales (50 USDT and 30 USDT)...");
        await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, {
            $$type: 'NewSale', saleId: 101n, creator: creator.address, usdtAmount: toNano('50')
        });
        await smartStaccer.send(botAdmin.getSender(), { value: toNano('0.05') }, {
            $$type: 'NewSale', saleId: 102n, creator: creator.address, usdtAmount: toNano('30')
        });

        // PRINT INDIVIDUAL SALE DATA (Fixed method name)
        const sale1 = await smartStaccer.getSaleInfo(101n);
        console.log(`Sale 101 Data: Amount=${sale1?.usdtAmount}, Release=${sale1?.releaseTime}`);
        
        // 3. EARLY CLAIM ATTEMPT
        console.log("TEST: Attempting to claim sale BEFORE 21 days (Should fail)...");
        const earlyClaim = await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, {
            $$type: 'ClaimSale', saleId: 101n
        });
        
        expect(earlyClaim.transactions).toHaveTransaction({
            success: false
        });
        console.log("✅ Security Verified: Cannot claim before lockup expires.");

        // 4. TIME TRAVEL & CLAIM BOTH
        console.log("Action: Jumping 22 days into the future...");
        blockchain.now = Math.floor(Date.now() / 1000) + (22 * 24 * 60 * 60);

        console.log("Action: Claiming both sales...");
        await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, { $$type: 'ClaimSale', saleId: 101n });
        await smartStaccer.send(creator.getSender(), { value: toNano('0.05') }, { $$type: 'ClaimSale', saleId: 102n });

        // 5. PRINT & VERIFY TOTAL POOL BALANCE (Fixed method name)
        const poolBalance = await smartStaccer.getBalanceOf(creator.address);
        console.log("Total Available Pool Balance for Creator:", poolBalance.toString());
        
        // 50 + 30 = 80
        expect(poolBalance).toBe(toNano('80'));
        console.log("✅ Logic Verified: Multiple sales combined correctly into pool.");

        console.log("--- ALL TESTS PASSED ---");
    });
});

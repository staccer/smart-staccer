import { toNano, Address } from '@ton/core';
import { SmartStaccer } from '../wrappers/SmartStaccer/SmartStaccer_SmartStaccer';
import { NetworkProvider } from '@ton/blueprint';

/**
 * Deploys SmartStaccer.
 *
 * Both constructor arguments are required by `init(admin, usdtWalletAddress)`:
 *
 *   SM_STACCER_ADMIN       — address allowed to register sales and trigger
 *                            gas-paid withdrawals (the bot's operator wallet)
 *   SM_STACCER_USDT_WALLET — the contract's own USDT jetton wallet address
 *                            (NOT a user wallet; the wallet whose owner is the
 *                            contract address)
 *
 * Example:
 *   SM_STACCER_ADMIN=UQ... SM_STACCER_USDT_WALLET=UQ... \
 *     npx blueprint run deploySmartStaccer --testnet
 */
export async function run(provider: NetworkProvider) {
    const adminRaw = process.env.SM_STACCER_ADMIN;
    const usdtRaw = process.env.SM_STACCER_USDT_WALLET;

    if (!adminRaw || !usdtRaw) {
        throw new Error(
            'Missing constructor arguments. Set SM_STACCER_ADMIN and SM_STACCER_USDT_WALLET ' +
                '(both are non-empty TON addresses) before running this script.',
        );
    }

    const admin = Address.parse(adminRaw);
    const usdtWalletAddress = Address.parse(usdtRaw);

    const smartStaccer = provider.open(await SmartStaccer.fromInit(admin, usdtWalletAddress));

    await smartStaccer.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        null,
    );

    await provider.waitForDeploy(smartStaccer.address);

    console.log(`SmartStaccer deployed at ${smartStaccer.address.toString()}`);
    console.log(`  admin:       ${admin.toString()}`);
    console.log(`  usdt wallet: ${usdtWalletAddress.toString()}`);
    console.log('');
    console.log('Next: fund the gas tank by sending TON to the contract address with an empty body.');
}

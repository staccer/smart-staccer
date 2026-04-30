import { toNano } from '@ton/core';
import { SmartStaccer } from '../build/SmartStaccer/SmartStaccer_SmartStaccer';
import { NetworkProvider } from '@ton/blueprint';

export async function run(provider: NetworkProvider) {
    const smartStaccer = provider.open(await SmartStaccer.fromInit());

    await smartStaccer.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        null,
    );

    await provider.waitForDeploy(smartStaccer.address);

    // run methods on `smartStaccer`
}

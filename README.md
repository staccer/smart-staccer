# SmartStaccer: The Decentralized Trust Layer

This repository contains the source code for the **SmartStaccer** smart contract, built using [Tact](https://tact-lang.org/) for the TON Blockchain. 

> **Status:** Development / Preview.  
> This contract is the foundation for our upcoming decentralized payout system. While the Staccer bot currently operates on a baseline system, this code is being made public to build **Trust through Transparency** ahead of its full production integration.

---

## Why Trust SmartStaccer?

In the future update, all creator rewards will be governed by this contract. By making the code Open Source, we ensure:

1.  **Immutability:** No one (including the Staccer team) can alter your sales data once registered.
2.  **21-Day Security Lock:** A cryptographic lock ensures a buffer for fraud prevention while guaranteeing that funds are released to the creator immediately after the period ends.
3.  **Self-Custody:** Creators withdraw their "Available Balance" directly to their TON wallet via on-chain messages.

---

## Technical Architecture & Safety

The contract follows a strict 2-phase lifecycle for every sale:

*   **NewSale:** The bot registers a sale. To prevent storage spam, a **Minimum Sale of 1.00 USDT** is enforced. The `releaseTime` is hardcoded to `now + 21 days`.
*   **Claim & Withdraw:** Once the lock expires, funds move to the "Available Pool." Creators can trigger a withdrawal (Minimum **10.00 USDT**) to ensure transaction fees remain negligible compared to the payout.

### The "Gas Tank" Concept (AdminWithdraw)
We’ve implemented a **zero-friction payout** system. The contract acts as a "Gas Tank," holding a small TON balance to cover the network fees of outgoing USDT transfers. 
*   Through the `AdminWithdraw` message, the Staccer bot can trigger payouts for the creator.
*   **Result:** Creators can receive their earnings even if their wallet has a **0.00 TON balance**, making it the most accessible PPV tool on the market.


---

## Developer Guide

### Prerequisites
*   Node.js & NPM
*   Experience with the TON ecosystem

### Verification & Testing
You can verify the security logic yourself by running the simulation suite. We use the **Sandbox** emulator to test edge cases (e.g., trying to withdraw before 21 days).
```bash
# Install dependencies
npm install

# Build the contract and generate wrappers
npx blueprint build

# Run the security & multi-sale test suite
npx blueprint test -- --verbose

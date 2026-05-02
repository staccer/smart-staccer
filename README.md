# 🔐 SmartStaccer: The Decentralized Trust Layer

This repository contains the source code for the **SmartStaccer** smart contract, built using [Tact](https://tact-lang.org/) for the TON Blockchain. 

> **Status:** Development / Preview.  
> This contract is the foundation for our upcoming decentralized payout system. While the Staccer bot currently operates on a baseline system, this code is being made public to build **Trust through Transparency** ahead of its full production integration.

---

## 🛡️ Why Trust SmartStaccer?

In the future update, all creator rewards will be governed by this contract. By making the code Open Source, we ensure:

1.  **Immutability:** No one (including the Staccer team) can alter your sales data once registered.
2.  **21-Day Security Lock:** A cryptographic lock ensures a buffer for fraud prevention while guaranteeing that funds are released to the creator immediately after the period ends.
3.  **Self-Custody:** Creators withdraw their "Available Balance" directly to their TON wallet via on-chain messages.

---

## ⚙️ Technical Architecture

The contract follows a strict 2-phase lifecycle for every sale:

*   **NewSale:** The bot registers a sale ID, creator address, and USDT amount. The `releaseTime` is hardcoded to `now + 21 days`.
*   **Claim & Withdraw:** Once the lock expires, the creator (and only the creator) can move funds to their available pool and trigger a `JettonTransfer` of USDT to their personal wallet.

---

## 🛠 Developer Guide

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

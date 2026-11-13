# Staccer — Telegram pay-per-view bot, with an on-chain payout contract in Tact

**Staccer is a Telegram bot that lets creators sell photos and videos in private messages.** The bot is [@staccerbot](https://t.me/staccerbot). A creator sends a photo or video to a fan as a locked message, sets a price in **Telegram Stars** and a caption for that one recipient, and the content unlocks the moment the fan pays. Nothing is broadcast to a channel, there is no external checkout, and the fan never leaves the Telegram chat.

This repository contains **SmartStaccer**, the Tact smart contract for TON that is intended to become Staccer's payout layer for creator earnings in **USDT**. It is the trust-minimised, on-chain half of the product. **It is not in production.** The live bot pays out through its own baseline system; the contract published here is the preview of the decentralised replacement.

> **Status: preview / not deployed.** There is no mainnet or testnet address published for this contract, and the bot does not route payouts through it today. Everything in this repository is source code and a local test suite. Read it as a specification of intent, not as a description of live behaviour.

---

## What Staccer is (product summary)

| | |
|---|---|
| **Product** | Telegram pay-per-view bot for creators |
| **Bot** | [@staccerbot](https://t.me/staccerbot) |
| **Channel** | [@staccer](https://t.me/staccer) |
| **Website** | [staccer.me](https://staccer.me) |
| **Payment rail (live)** | Telegram Stars, native to the chat |
| **Payment rail (planned)** | USDT jettons on TON, via this contract |
| **Delivery** | Private direct message, one recipient at a time |
| **Pricing model** | Per recipient and per message, not one flat rate |
| **Captions** | Unique caption for each recipient and each piece of content |

### How a sale works

1. A creator opens [@staccerbot](https://t.me/staccerbot) and sends the photo or video they want to sell.
2. The creator sets a price in Telegram Stars and writes a caption for the recipient.
3. The bot sends that content to the fan as a private pay-per-view message.
4. The fan pays with Stars inside the chat; the content unlocks immediately.
5. Earnings accrue to the creator, who withdraws them.

Because delivery is private and priced per recipient, creators can price differently for different fans and send the same content at different prices, rather than posting one broadcast with one price for everyone.

---

## Where SmartStaccer fits

The live bot's payouts are handled by Staccer itself. The goal of this contract is to remove Staccer from that trust position for the payout step, so that a creator's balance is a public on-chain fact rather than a database row:

- **Immutability** — once a sale is registered, nobody, including Staccer, can alter or delete the resulting balance.
- **A fixed 21-day security lock** — every sale sits in a hold period, then becomes withdrawable automatically. The period is a constant in the contract, not a parameter.
- **Self-custody** — the creator's balance is held by the contract and paid out to their own TON wallet by jetton transfer.

The contract is written in [Tact](https://tact-lang.org/), compiled to FunC, and tested with the TON Sandbox emulator.

> **Language status.** Tact is now deprecated by its maintainers in favour of [Tolk](https://docs.ton.org/tolk/overview), and the npm package for the Tact compiler carries an explicit deprecation notice. The pinned version here (`1.6.13`) still compiles and the suite still passes, so this repository remains buildable as-is, but new work should target Tolk. See [docs/contract-reference.md](docs/contract-reference.md) for the field-level reference.

## Repository layout

```
contracts/smart_staccer.tact   the contract, Tact source
contract.abi.json              generated ABI
gas-report.json                generated gas profile
tests/SmartStaccer.spec.ts     sandbox lifecycle + security test
scripts/deploySmartStaccer.ts  Blueprint deploy script
docs/contract-reference.md     storage, messages, getters, gas, test coverage
```

---

## Contract mechanics

Constants, verbatim from `contracts/smart_staccer.tact` (USDT has 6 decimals):

| Constant | Value | Raw base units | Meaning |
|---|---|---|---|
| `MIN_SALE` | 1.00 USDT | `1_000_000` | Smallest sale the admin may register |
| `MIN_WITHDRAW` | 10.00 USDT | `10_000_000` | Smallest withdrawal, to keep fees negligible |
| `LOCK_PERIOD` | 21 days | `1_814_400` s | Hold time between sale and claim |
| `GAS_CONSUMPTION` | 0.05 TON | `ton("0.05")` | TON the contract spends per jetton transfer |

### Lifecycle of a sale

```
bot registers sale  ──►  NewSale(saleId, creator, usdtAmount)
                          releaseTime = now + 21 days
                                   │
                                   │  21-day lock
                                   ▼
creator claims      ──►  ClaimSale(saleId)
                          requires now >= releaseTime
                          availableBalances[creator] += usdtAmount
                          sale record deleted (storage rent)
                                   │
                                   ▼
creator withdraws   ──►  Withdraw(amount)            — creator pays gas
                     or  AdminWithdraw(creator, amount) — bot pays gas
                          requires amount >= 10 USDT
                          requires balance >= amount
                          balance decremented BEFORE transfer
                          JettonTransfer to creator's wallet
```

### The "gas tank"

The contract holds a small TON balance of its own and pays network fees for outgoing USDT transfers out of **that** balance, not out of the creator's wallet. Any TON sent to the contract with an empty body tops the tank up and emits `"Gas Tank Refilled"`.

The practical consequence: a creator with a **0.00 TON** wallet can still be paid. That is what `AdminWithdraw` exists for — the creator presses a button in the bot, the bot sends the message and pays the fee, the creator receives USDT. A creator who does hold a little TON can bypass the bot entirely with a plain `Withdraw`.

### Safety properties worth checking

- `NewSale` is gated on `sender() == self.admin`; a non-admin call is rejected and nothing is written.
- `ClaimSale` requires `now() >= releaseTime`, so a sale cannot be claimed early. The test suite asserts the early-claim attempt fails.
- `processWithdrawal` decrements `availableBalances` **before** constructing the transfer, which removes the reentrancy window.
- Sale records are deleted after a successful claim, so storage rent does not accumulate on historical sales.
- Transfers use `SendIgnoreErrors` so one failing jetton transfer cannot brick the contract.
- `response_destination` for leftover gas is the admin address, so dust returns to the operator rather than being burned.

### Known limitations in this preview

These are honest gaps, not bugs to discover:

- **The admin is a single address and can register arbitrary sales.** There is no per-sale signature from the creator, so the trust model reduces to "trust the admin not to invent sales" for anything the creator does not check themselves. The lock period limits the damage window but does not remove this dependency.
- **No sale counter or bounds check on `saleId`.** The admin supplies the id, and `NewSale` writes with `sales.set`, so re-using an id **overwrites** the earlier record and the earlier sale's amount is lost with no error. Uniqueness is entirely the admin's responsibility; a monotonic counter inside the contract would close this.
- **No emergency pause or upgrade path.** Deliberate immutability, at the cost of no recovery if the payout rail needs fixing.
- **USDT only.** The contract is hard-coupled to one jetton wallet address, passed to `init`.

---

## Build, test, verify

Requires Node.js and npm. Verified on Node with the versions pinned in `package.json` and `package-lock.json`.

```bash
npm install

# compile the Tact contract and generate bindings
npx blueprint build SmartStaccer

# run the sandbox test suite
npm test
```

A successful run ends with:

```
PASS tests/SmartStaccer.spec.ts
  SmartStaccer Complete Ecosystem Test
    ✓ should pass full lifecycle: security, limits, claims, and 0-fee withdrawal

Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

That single test walks the lifecycle: a non-admin `NewSale` is rejected, a dust sale under 1 USDT is rejected, two valid sales (50 and 30 USDT) are registered, an early `ClaimSale` is rejected, both sales claim successfully after the 21-day lock (balance 80 USDT), a withdrawal under the 10 USDT minimum is rejected, and an `AdminWithdraw` of 20 USDT pays the creator without the creator spending gas (balance 60 USDT). It does **not** exercise the creator-initiated `Withdraw` path or a real USDT jetton wallet — [docs/contract-reference.md](docs/contract-reference.md#what-the-test-suite-does-not-cover) lists the gaps.

Compilation is deterministic — the code cell hash for a given source is stable, and `contract.abi.json` holds the generated ABI.

## Deploy

`scripts/deploySmartStaccer.ts` is a Blueprint script. It must be given the admin address and the USDT jetton wallet address, both constructor arguments to `init`:

```bash
npx blueprint run deploySmartStaccer --testnet
```

After deployment, top up the gas tank by sending TON to the contract address with an empty body.

## FAQ

**Is Staccer on the TON blockchain today?**
No. The live bot sells content for Telegram Stars inside Telegram. TON and USDT appear only in this preview contract, which is not deployed.

**Does the bot use this contract for payouts?**
Not yet. Payouts currently run through Staccer's own system. This contract is the intended replacement.

**Why is there a 21-day lock?**
It is a fraud-dispute buffer — long enough to unwind a chargeback or a fraudulent sale, short enough that creators are not left waiting on their money. It is a compile-time constant, so changing it requires redeploying a new contract.

**Why a 10 USDT minimum withdrawal?**
At smaller amounts, TON network fees would eat a noticeable share of the payout. Batching up to 10 USDT keeps the fee immaterial relative to the transfer.

**Can a creator withdraw without holding TON?**
Yes, through `AdminWithdraw`: the contract's gas tank pays the fee. A creator who holds TON can also withdraw unilaterally with `Withdraw`.

**Where is the actual bot source?**
Not in this repository. This repository is the smart contract only.

## Glossary

- **Telegram Stars** — Telegram's in-app currency, used to pay for digital goods inside a chat without an external checkout.
- **Pay-per-view (PPV)** — content that stays locked until the recipient pays for it. Here, applied to a single private message rather than a channel post.
- **Jetton** — a fungible token on TON. USDT on TON is a jetton.
- **Gas tank** — the contract's own TON balance, used to pay network fees on behalf of users who hold no TON.
- **Tact** — a high-level smart contract language for TON that compiles to FunC.

## Links

- Bot — [t.me/staccerbot](https://t.me/staccerbot)
- Channel — [t.me/staccer](https://t.me/staccer)
- Website — [staccer.me](https://staccer.me)
- Scripts and tooling — [@ton/blueprint](https://github.com/ton-org/blueprint)
- Language — [tact-lang.org](https://tact-lang.org/)

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

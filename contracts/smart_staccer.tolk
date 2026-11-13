// SmartStaccer — Staccer's on-chain payout contract, Tolk port.
//
// Tolk is the TON Foundation's recommended smart contract language; this file is
// the port of contracts/smart_staccer.tact. Behaviour is intentionally identical:
// the admin registers sales, each sale is locked for 21 days, claims accrue to a
// per-creator balance, and withdrawals move USDT jettons out of the contract.
//
// NOT DEPLOYED. See README.md.

// ── Amounts (USDT has 6 decimals) ─────────────────────────────────────────────

const MIN_SALE: coins = 1000000            // 1.00 USDT
const MIN_WITHDRAW: coins = 10000000       // 10.00 USDT
const LOCK_PERIOD: int = 1814400           // 21 days, in seconds
const GAS_CONSUMPTION: coins = 50000000    // 0.05 TON per jetton transfer
const FORWARD_GRAMS: coins = 10000000      // 0.01 TON forwarded with the transfer

// ── Exit codes ────────────────────────────────────────────────────────────────

const ERR_NOT_ADMIN = 401
const ERR_SALE_BELOW_MIN = 402
const ERR_SALE_NOT_FOUND = 403
const ERR_STILL_LOCKED = 404
const ERR_WITHDRAW_BELOW_MIN = 405
const ERR_INSUFFICIENT_BALANCE = 406
const ERR_NOT_ADMIN_WITHDRAW = 407
const ERR_UNKNOWN_OPCODE = 0xFFFF

// ── Data ──────────────────────────────────────────────────────────────────────

struct SaleRecord {
    creator: address
    usdtAmount: coins
    releaseTime: uint32
}

struct Storage {
    admin: address
    usdtWalletAddress: address
    sales: map<uint64, SaleRecord> = []
    availableBalances: map<address, coins> = []
}

fun Storage.load() {
    return Storage.fromCell(contract.getData())
}

fun Storage.save(self) {
    contract.setData(self.toCell())
}

// ── Messages ──────────────────────────────────────────────────────────────────
// Opcodes are CRC32 over the message name, so they are reproducible: crc32("NewSale") = 0xfeaec34b.

struct (0xfeaec34b) NewSale {
    saleId: uint64
    creator: address
    usdtAmount: coins
}

struct (0x81f78480) ClaimSale {
    saleId: uint64
}

// Creator-initiated: the destination is the sender, the creator pays the gas.
struct (0x4ca83dc8) Withdraw {
    amount: coins
}

// Operator-initiated: the creator pays no gas, the contract's tank does.
struct (0x4fa215c9) AdminWithdraw {
    creator: address
    amount: coins
}

// Standard TEP-74 jetton transfer body, sent to the contract's own USDT wallet.
struct (0x0f8a7ea5) JettonTransfer {
    queryId: uint64
    jettonAmount: coins
    transferRecipient: address
    sendExcessesTo: address?
    customPayload: cell?
    forwardGrams: coins
    forwardPayload: RemainingBitsAndRefs
}

type AllowedMessage = NewSale | ClaimSale | Withdraw | AdminWithdraw

contract SmartStaccer {
    storage: Storage
    incomingMessages: AllowedMessage
}

// ── Entry point ───────────────────────────────────────────────────────────────

fun onInternalMessage(in: InMessage) {
    // A plain TON transfer with no body tops up the gas tank. Nothing to do
    // beyond accepting the coins, which the TVM does on its own.
    if (in.body.isEmpty()) {
        return;
    }

    val msg = lazy AllowedMessage.fromSlice(in.body);
    var storage = lazy Storage.load();

    match (msg) {
        NewSale => {
            assert (in.senderAddress == storage.admin) throw ERR_NOT_ADMIN;
            assert (msg.usdtAmount >= MIN_SALE) throw ERR_SALE_BELOW_MIN;

            // Note: set() overwrites an existing record under the same saleId.
            // Uniqueness of saleId is the admin's responsibility.
            storage.sales.set(msg.saleId, SaleRecord {
                creator: msg.creator,
                usdtAmount: msg.usdtAmount,
                releaseTime: blockchain.now() + LOCK_PERIOD,
            });
            storage.save();
        }

        ClaimSale => {
            val r = storage.sales.get(msg.saleId);
            assert (r.isFound) throw ERR_SALE_NOT_FOUND;
            val sale = r.loadValue();
            assert (blockchain.now() >= sale.releaseTime) throw ERR_STILL_LOCKED;

            val bal = storage.availableBalances.get(sale.creator);
            val current = bal.isFound ? bal.loadValue() : 0 as coins;
            storage.availableBalances.set(sale.creator, current + sale.usdtAmount);

            // Clear the record so storage rent does not accumulate.
            storage.sales.delete(msg.saleId);
            storage.save();
        }

        Withdraw => {
            processWithdrawal(mutate storage, in.senderAddress, msg.amount);
            storage.save();
        }

        AdminWithdraw => {
            assert (in.senderAddress == storage.admin) throw ERR_NOT_ADMIN_WITHDRAW;
            processWithdrawal(mutate storage, msg.creator, msg.amount);
            storage.save();
        }

        else => {
            throw ERR_UNKNOWN_OPCODE;
        }
    }
}

// ── Withdrawal ────────────────────────────────────────────────────────────────

fun processWithdrawal(mutate storage: Storage, target: address, amount: coins) {
    val bal = storage.availableBalances.get(target);
    val current = bal.isFound ? bal.loadValue() : 0 as coins;

    assert (amount >= MIN_WITHDRAW) throw ERR_WITHDRAW_BELOW_MIN;
    assert (current >= amount) throw ERR_INSUFFICIENT_BALANCE;

    // Decrement before sending: no reentrancy window.
    storage.availableBalances.set(target, current - amount);

    val transfer = createMessage({
        bounce: BounceMode.NoBounce,
        value: GAS_CONSUMPTION,
        dest: storage.usdtWalletAddress,
        body: JettonTransfer {
            queryId: 0,
            jettonAmount: amount,
            transferRecipient: target,
            sendExcessesTo: storage.admin,
            customPayload: null,
            forwardGrams: FORWARD_GRAMS,
            forwardPayload: createEmptySlice(),
        },
    });
    transfer.send(SEND_MODE_IGNORE_ERRORS);
}

// ── Getters ───────────────────────────────────────────────────────────────────

get fun balance(creator: address): coins {
    val storage = lazy Storage.load();
    val r = storage.availableBalances.get(creator);
    return r.isFound ? r.loadValue() : 0 as coins;
}

get fun sale(saleId: uint64): SaleRecord? {
    val storage = lazy Storage.load();
    val r = storage.sales.get(saleId);
    return r.isFound ? r.loadValue() : null;
}

get fun contractTonBalance(): coins {
    return contract.getOriginalBalance();
}

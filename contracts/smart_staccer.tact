import "@stdlib/deploy";

// --- CONSTANTS (USDT has 6 Decimals) ---
const MIN_SALE: Int = 1000000;          // 1.00 USDT
const MIN_WITHDRAW: Int = 10000000;     // 10.00 USDT
const LOCK_PERIOD: Int = 1814400;       // 21 Days in seconds
const GAS_CONSUMPTION: Int = ton("0.05"); // Gas provided by contract for Jetton transfer

// --- MESSAGES ---
message NewSale { 
    saleId: Int as uint64; 
    creator: Address; 
    usdtAmount: Int as coins; 
}

message ClaimSale { 
    saleId: Int as uint64; 
}

// User triggers this (requires user to have tiny gas)
message Withdraw { 
    amount: Int as coins; 
}

// Admin triggers this (Creator pays 0 gas)
message AdminWithdraw {
    creator: Address;
    amount: Int as coins;
}

// Standard Jetton Transfer Body
message(0x0f8a7ea5) JettonTransfer {
    query_id: Int as uint64;
    amount: Int as coins;
    destination: Address;
    response_destination: Address;
    custom_payload: Cell?;
    forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

struct SaleRecord { 
    creator: Address; 
    usdtAmount: Int as coins; 
    releaseTime: Int as uint32; 
}

contract SmartStaccer with Deployable {
    admin: Address;             
    usdtWalletAddress: Address; 
    sales: map<Int, SaleRecord>;
    availableBalances: map<Address, Int>;

    init(admin: Address, usdtWalletAddress: Address) {
        self.admin = admin;
        self.usdtWalletAddress = usdtWalletAddress;
    }

    // --- 1. DEPOSIT GAS ---
    // Allows the admin to top up the contract's TON balance to pay for creator withdrawals
    receive() {
        dump("Gas Tank Refilled");
    }

    // --- 2. REGISTER SALE ---
    receive(msg: NewSale) {
        require(sender() == self.admin, "Only admin can register sales");
        require(msg.usdtAmount >= MIN_SALE, "Sale amount below minimum");

        self.sales.set(msg.saleId, SaleRecord{
            creator: msg.creator,
            usdtAmount: msg.usdtAmount,
            releaseTime: now() + LOCK_PERIOD
        });
    }

    // --- 3. CLAIM SALE (Unlock to Balance) ---
    receive(msg: ClaimSale) {
        let sale: SaleRecord? = self.sales.get(msg.saleId);
        require(sale != null, "Sale record not found");
        let s: SaleRecord = sale!!;
        
        require(now() >= s.releaseTime, "Funds are still in 21-day lockup");

        // Safe Map Unwrapping
        let current: Int = 0;
        let existingBalance: Int? = self.availableBalances.get(s.creator);
        if (existingBalance != null) {
            current = existingBalance!!;
        }
        
        self.availableBalances.set(s.creator, current + s.usdtAmount);
        self.sales.set(msg.saleId, null); // Clear storage to save gas/rent
    }

    // --- 4. WITHDRAWAL LOGIC ---
    
    // Internal helper to handle the actual USDT movement
    fun processWithdrawal(target: Address, amount: Int) {
        // Safe Map Unwrapping
        let current: Int = 0;
        let existingBalance: Int? = self.availableBalances.get(target);
        if (existingBalance != null) {
            current = existingBalance!!;
        }

        require(amount >= MIN_WITHDRAW, "Minimum withdrawal is 10 USDT");
        require(current >= amount, "Insufficient creator balance");

        // Update balance before sending (Prevents Reentrancy)
        self.availableBalances.set(target, current - amount);

        // Send USDT using the CONTRACT'S TON balance
        send(SendParameters{
            to: self.usdtWalletAddress,
            value: GAS_CONSUMPTION, 
            mode: SendIgnoreErrors, // Don't crash contract if transfer fails
            body: JettonTransfer{
                query_id: 0, 
                amount: amount, 
                destination: target,
                response_destination: self.admin, // Leftover gas goes to admin
                custom_payload: null,
                forward_ton_amount: ton("0.01"), 
                forward_payload: emptySlice()
            }.toCell()
        });
    }

    // Case A: Creator has a little TON and triggers it themselves
    receive(msg: Withdraw) {
        self.processWithdrawal(sender(), msg.amount);
    }

    // Case B: Creator clicks button in Bot, Admin triggers it (Creator pays 0)
    receive(msg: AdminWithdraw) {
        require(sender() == self.admin, "Only admin can trigger zero-fee withdrawals");
        self.processWithdrawal(msg.creator, msg.amount);
    }

    // --- GETTERS ---

    get fun balance(creator: Address): Int {
        let existingBalance: Int? = self.availableBalances.get(creator);
        if (existingBalance != null) {
            return existingBalance!!;
        }
        return 0;
    }

    get fun sale(saleId: Int): SaleRecord? {
        return self.sales.get(saleId);
    }

    get fun contractTonBalance(): Int {
        return myBalance();
    }
}

import "@stdlib/deploy";

// --- MESSAGES ---
message NewSale { saleId: Int as uint64; creator: Address; usdtAmount: Int as coins; }
message CancelSale { saleId: Int as uint64; }
message ClaimSale { saleId: Int as uint64; }
message Withdraw { amount: Int as coins; }

message WithdrawalEvent { creator: Address; amount: Int as coins; }

message(0x0f8a7ea5) JettonTransfer {
    query_id: Int as uint64; amount: Int as coins; destination: Address;
    response_destination: Address; custom_payload: Cell?; forward_ton_amount: Int as coins;
    forward_payload: Slice as remaining;
}

struct SaleRecord { creator: Address; usdtAmount: Int as coins; releaseTime: Int as uint32; }

contract SmartStaccer with Deployable {
    admin: Address;             
    usdtWalletAddress: Address; 
    sales: map<Int, SaleRecord>;
    availableBalances: map<Address, Int>;

    init(admin: Address, usdtWalletAddress: Address) {
        self.admin = admin;
        self.usdtWalletAddress = usdtWalletAddress;
    }

    receive(msg: NewSale) {
        require(sender() == self.admin, "Only bot admin allowed");
        dump("LOG: Registering New Sale");
        dump(msg.saleId);

        self.sales.set(msg.saleId, SaleRecord{
            creator: msg.creator,
            usdtAmount: msg.usdtAmount,
            releaseTime: now() + 1814400 
        });
    }

    receive(msg: ClaimSale) {
        let sale: SaleRecord? = self.sales.get(msg.saleId);
        require(sale != null, "Sale not found");
        let s: SaleRecord = sale!!;
        
        dump("LOG: Claim Attempt for SaleID");
        dump(msg.saleId);

        require(now() >= s.releaseTime, "Funds locked");

        let current: Int = 0;
        let existingBalance: Int? = self.availableBalances.get(s.creator);
        if (existingBalance != null) { current = existingBalance!!; }
        
        self.availableBalances.set(s.creator, current + s.usdtAmount);
        self.sales.set(msg.saleId, null);
        dump("LOG: Claim Successful. New Pool Balance:");
        dump(current + s.usdtAmount);
    }

    receive(msg: Withdraw) {
        let current: Int = 0;
        let existingBalance: Int? = self.availableBalances.get(sender());
        if (existingBalance != null) { current = existingBalance!!; }

        dump("LOG: Withdrawal Requested");
        dump(msg.amount);

        require(msg.amount > 0, "Amount must be > 0");
        require(current >= msg.amount, "Insufficient balance");

        self.availableBalances.set(sender(), current - msg.amount);

        send(SendParameters{
            to: self.usdtWalletAddress,
            value: ton("0.05"),
            mode: SendPayGasSeparately,
            body: JettonTransfer{
                query_id: 0, amount: msg.amount, destination: sender(),
                response_destination: sender(), custom_payload: null,
                forward_ton_amount: ton("0.01"), forward_payload: emptySlice()
            }.toCell()
        });

        emit(WithdrawalEvent{ creator: sender(), amount: msg.amount }.toCell());
    }

    // Fixed naming to match TypeScript preferences
    get fun balanceOf(creator: Address): Int {
        let existingBalance: Int? = self.availableBalances.get(creator);
        if (existingBalance != null) { return existingBalance!!; }
        return 0;
    }

    // NEW: Added the missing getter so the test can read the sale details
    get fun saleInfo(saleId: Int): SaleRecord? {
        return self.sales.get(saleId);
    }
}

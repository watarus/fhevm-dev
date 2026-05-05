# Common Confidential Finance contract patterns

Skeletons for the contracts an FHEVM agent is most often asked to generate. Each is shown in v0.11 idiom — `FHE.*` namespace, `ZamaEthereumConfig` base, ACL after every assignment, no `requestDecryption`.

## 1. Confidential ERC-7984 token (drop-in)

OpenZeppelin's `confidential-contracts` package ships a complete ERC-7984. Prefer reusing it over rolling a custom token.

```bash
npm install @openzeppelin/confidential-contracts
```

```solidity
import {FHE, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

contract MyConfidentialToken is ERC7984, Ownable {
    constructor(address owner_, string memory name_, string memory symbol_, string memory uri_)
        ERC7984(name_, symbol_, uri_) Ownable(owner_) {}

    function mint(address to, externalEuint64 amount, bytes calldata inputProof) external onlyOwner {
        _mint(to, FHE.fromExternal(amount, inputProof));
    }
    function burn(address from, externalEuint64 amount, bytes calldata inputProof) external onlyOwner {
        _burn(from, FHE.fromExternal(amount, inputProof));
    }
}
```

User-facing API: `confidentialTransfer(to, encryptedAmount, inputProof)`. The transferred amount is silently clamped to `min(requested, balance)` — the contract returns the actually-transferred encrypted amount rather than reverting on insufficient funds, which preserves confidentiality of the balance.

## 2. Confidential payroll (the headline reference)

See `assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol`. Key takeaways:
- Per-recipient encrypted balance, with both `FHE.allow(handle, recipient)` and `FHE.allow(handle, owner)` so each sees their own view.
- Encrypted aggregate (`_totalPayroll`) gated to the employer only.
- Withdrawal: `FHE.min(requested, balance)` clamp + `FHE.makePubliclyDecryptable(actual)` + a `settlePayout(payoutId, cleartext, proof)` settlement that runs `FHE.checkSignatures` and releases ETH.

## 3. Sealed-bid auction

```solidity
import {FHE, euint64, externalEuint64, eaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract SealedBidAuction is ZamaEthereumConfig {
    address public immutable beneficiary;
    uint256 public immutable endTime;

    mapping(address => euint64) private _bids;
    euint64 private _highestBid;
    eaddress private _winner;
    bool public revealed;

    constructor(address beneficiary_, uint256 endTime_) {
        beneficiary = beneficiary_;
        endTime = endTime_;
    }

    function bid(externalEuint64 amount, bytes calldata inputProof) external {
        require(block.timestamp < endTime, "ended");
        euint64 newBid = FHE.fromExternal(amount, inputProof);

        // Track the bidder's own bid (so they can decrypt it later).
        _bids[msg.sender] = FHE.isInitialized(_bids[msg.sender])
            ? FHE.max(_bids[msg.sender], newBid)
            : newBid;
        FHE.allowThis(_bids[msg.sender]);
        FHE.allow(_bids[msg.sender], msg.sender);

        // Update the running winner.
        if (FHE.isInitialized(_highestBid)) {
            ebool isHigher = FHE.gt(newBid, _highestBid);
            _highestBid = FHE.select(isHigher, newBid, _highestBid);
            _winner = FHE.select(isHigher, FHE.asEaddress(msg.sender), _winner);
        } else {
            _highestBid = newBid;
            _winner = FHE.asEaddress(msg.sender);
        }
        FHE.allowThis(_highestBid);
        FHE.allowThis(_winner);
    }

    /// Step 1: after the auction ends, mark the winner publicly decryptable.
    function startReveal() external {
        require(block.timestamp >= endTime, "not yet");
        require(!revealed, "already started");
        FHE.makePubliclyDecryptable(_winner);
        FHE.makePubliclyDecryptable(_highestBid);
    }

    /// Step 2: anyone (typically the relayer or the beneficiary) submits the
    /// abi-encoded (address, uint64) cleartext + KMS proof so the contract
    /// stores the plaintext winner and price.
    address public revealedWinner;
    uint64 public revealedPrice;
    function finalizeReveal(bytes calldata abiEncodedClear, bytes calldata proof) external {
        require(!revealed, "already revealed");
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(_winner);
        cts[1] = FHE.toBytes32(_highestBid);
        FHE.checkSignatures(cts, abiEncodedClear, proof);
        (address winner, uint64 price) = abi.decode(abiEncodedClear, (address, uint64));
        revealedWinner = winner;
        revealedPrice = price;
        revealed = true;
    }
}
```

Key points:
- Use `FHE.max` (not native `if`) for tracking the running highest bid, paired with `FHE.select` on the encrypted winner.
- Reveal in two steps: `makePubliclyDecryptable` on-chain, then `checkSignatures` + decode after the off-chain `instance.publicDecrypt`.
- `cts[]` order in `checkSignatures` must match the `abi.decode(_, (address, uint64))` order.

## 4. Private voting

```solidity
mapping(uint256 => euint32) private _yesCount;   // proposalId => encrypted yes count
mapping(uint256 => euint32) private _noCount;
mapping(uint256 => mapping(address => bool)) public hasVoted;

function vote(uint256 proposalId, externalEbool support, bytes calldata inputProof) external {
    require(!hasVoted[proposalId][msg.sender], "already voted");
    hasVoted[proposalId][msg.sender] = true;

    ebool s = FHE.fromExternal(support, inputProof);
    // Add 1 to yes if support is true, else add 1 to no.
    euint32 one = FHE.asEuint32(1);
    _yesCount[proposalId] = FHE.add(_yesCount[proposalId], FHE.select(s, one, FHE.asEuint32(0)));
    _noCount[proposalId]  = FHE.add(_noCount[proposalId],  FHE.select(s, FHE.asEuint32(0), one));

    FHE.allowThis(_yesCount[proposalId]);
    FHE.allowThis(_noCount[proposalId]);
    // Optional: grant the proposer or DAO so they can decrypt running tallies.
}
```

The tallies stay encrypted until the proposal closes and the DAO decides to reveal them via Pattern B (`makePubliclyDecryptable` + `publicDecrypt` + `checkSignatures`). Whether or not you allow individual voters to verify their vote is a privacy-design choice.

## 5. Confidential transfer split

A "private payment splitter" that distributes one encrypted input across multiple recipients in a fixed plaintext ratio:

```solidity
function distribute(externalEuint64 total, bytes calldata inputProof) external onlyOwner {
    euint64 t = FHE.fromExternal(total, inputProof);
    // Split 60 / 30 / 10 — ratios are plaintext, the amounts stay encrypted.
    euint64 a = FHE.div(FHE.mul(t, 60), 100);
    euint64 b = FHE.div(FHE.mul(t, 30), 100);
    euint64 c = FHE.sub(t, FHE.add(a, b));   // remainder; preserves the total exactly
    _credit(alice, a);
    _credit(bob,   b);
    _credit(carol, c);
}
```

`FHE.mul` and `FHE.div` accept a plaintext scalar on one side; the encrypted total stays confidential. The remainder pattern (`t - a - b`) avoids accumulated rounding error and keeps the conservation law `a + b + c == t`.

## 6. Pattern checklist (apply to every new contract)

- [ ] Inherits `ZamaEthereumConfig`.
- [ ] Every external function with encrypted input pairs `externalEuint*` with `bytes calldata inputProof`.
- [ ] `FHE.fromExternal` is called exactly once per input, near the top.
- [ ] Bit-widths are the smallest that fit the use case.
- [ ] After every state assignment, both `FHE.allowThis` and the right `FHE.allow(_, recipient)` grants are emitted.
- [ ] No `if (ebool)` / `require(ebool)`; only `FHE.select`.
- [ ] No `view` / `pure` on functions that perform FHE ops.
- [ ] Reveals use Pattern A (off-chain `userDecrypt`) for per-user views or Pattern B (`makePubliclyDecryptable` + `checkSignatures`) for on-chain reveal — never `requestDecryption`.
- [ ] Errors are custom errors (`error NotOwner();`) rather than string `require` for gas + clarity.

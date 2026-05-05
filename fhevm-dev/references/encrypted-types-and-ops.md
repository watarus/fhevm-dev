# Encrypted types and operations (`@fhevm/solidity ^0.11`)

Use this reference when generating contracts that operate on encrypted state. Always import the types and the `FHE` library from the same module:

```solidity
import {FHE, ebool, euint8, euint16, euint32, euint64, euint128, euint256, eaddress, externalEbool, externalEuint8, externalEuint16, externalEuint32, externalEuint64, externalEuint128, externalEuint256, externalEaddress} from "@fhevm/solidity/lib/FHE.sol";
```

You only need to list the symbols you actually use; importing everything is fine for a starter project.

## 1. Type cheat sheet

| Category | Solidity types | Notes |
|----------|----------------|-------|
| Boolean | `ebool` | Drives `FHE.select`. **Cannot** be coerced to native `bool` for `if`/`require`. |
| Unsigned integers | `euint8` `euint16` `euint32` `euint64` `euint128` `euint256` | Each bit costs gas; pick the smallest sufficient width. |
| Address | `eaddress` | Use for sealed-bid winner reveal etc. |
| External (input) | `externalEbool` `externalEuint*` `externalEaddress` | Function arguments only. Convert with `FHE.fromExternal` exactly once at the top of the function. |

The "uninitialized" state of any handle is the zero `bytes32`. Test it with `FHE.isInitialized(handle)` before computing on it (e.g. for a "first credit" branch).

## 2. Operator matrix

All operators live on the `FHE` library. Width promotion: mixing `euint8` and `euint16` returns `euint16`; division/remainder require a plaintext divisor.

| Family | Operators | Notes |
|--------|-----------|-------|
| Arithmetic | `add` `sub` `mul` `div` `rem` `neg` `min` `max` | Wraps modulo `2^N` (no built-in checked math). `div`/`rem` require the divisor side to be plaintext (`uint*`). |
| Comparison | `eq` `ne` `lt` `le` `gt` `ge` | Returns `ebool`. |
| Logic / bitwise | `and` `or` `xor` `not` | Defined on `ebool` and `euint*`. |
| Shift / rotate | `shl` `shr` `rotl` `rotr` | Shift amount is taken modulo bit-width — `shr(euint64 x, 70)` ≡ `shr(x, 6)`. |
| Conditional | `select(ebool cond, T ifTrue, T ifFalse)` | The only allowed branching primitive for encrypted booleans. |
| Conversion | `asEbool` `asEuint*` `asEaddress` | Trivial encryption from a plaintext literal — useful for constants. |
| External input | `fromExternal(externalE_, inputProof)` | Verifies the ZK proof and returns the corresponding internal handle. |
| Random | `randEbool` `randEuint*` | `randEuint*` accepts an optional upper bound. On-chain encrypted randomness. |

Every operator has overloads for `(encrypted, encrypted)`, `(encrypted, scalar)`, and `(scalar, encrypted)` where applicable.

## 3. Scalar overload — gas

Always prefer the scalar form when one operand is a plaintext literal:

```solidity
// ❌ encrypted-encrypted: trivially encrypts the literal first, then computes
total = FHE.add(total, FHE.asEuint64(fee));

// ✅ scalar overload: dramatically cheaper
total = FHE.add(total, fee);
```

The same applies to `sub`, `mul`, `min`, `max`, `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `and`, `or`, `xor`.

## 4. Branching

Native `if`/`require`/ternary can never read an `ebool`:

```solidity
// ❌ does not compile
if (FHE.gt(bid, highest)) highest = bid;

// ✅
ebool higher = FHE.gt(bid, highest);
highest = FHE.select(higher, bid, highest);
```

To branch on an encrypted condition in a way that affects native control flow, you must reveal the boolean — either with `instance.userDecrypt` (off-chain) or `FHE.makePubliclyDecryptable` + self-relayed `FHE.checkSignatures` (on-chain after a round trip).

## 5. View / pure restrictions

`FHE.add`, `FHE.fromExternal`, `FHE.allow*`, etc. emit events to the coprocessor and consume gas. They cannot appear in `view` or `pure` functions.

```solidity
// ❌ emits events; not view-safe
function preview(externalEuint64 a, bytes calldata p) external view returns (euint64) {
    return FHE.fromExternal(a, p);
}

// ✅
function preview(externalEuint64 a, bytes calldata p) external returns (euint64) {
    return FHE.fromExternal(a, p);
}
```

Reading an existing handle via a getter (`function getX() external view returns (euint64)`) is fine because no FHE op is performed — it only returns the underlying `bytes32`.

## 6. Bit-width selection

| Use case | Recommended type |
|----------|------------------|
| Boolean flag | `ebool` |
| Vote count, age, small index | `euint8` / `euint16` |
| Counter, generic integer | `euint32` |
| Token balance, money amount, gas | `euint64` |
| Large monetary aggregates (rare) | `euint128` |
| Hashes, large IDs | `euint256` |

Going wider than needed costs proportionally more gas in every operation.

## 7. Quick examples

### 7.1 Encrypted maximum

```solidity
ebool higher = FHE.ge(a, b);
euint32 m = FHE.select(higher, a, b);
FHE.allowThis(m);
FHE.allow(m, msg.sender);
```

### 7.2 Encrypted "is exactly equal to a constant"

```solidity
euint8 roleHandle;          // declared elsewhere as state or local
ebool isAdmin = FHE.eq(roleHandle, uint8(1));   // scalar overload
```

The plaintext literal type must match the encrypted type's bit-width — `FHE.eq(euint8, uint8)` exists, `FHE.eq(euint8, uint16)` does not.

### 7.3 Encrypted clamp `min(requested, balance)`

```solidity
euint64 actual = FHE.min(requested, balance);
balance = FHE.sub(balance, actual);
FHE.allowThis(balance);
FHE.allow(balance, msg.sender);
```

This is the canonical confidential-finance withdrawal pattern — see `assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol`.

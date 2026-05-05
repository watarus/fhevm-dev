---
name: fhevm-dev
description: |
  Build, test, and deploy FHEVM smart contracts using Zama's v0.11 toolchain (`@fhevm/solidity`, `@fhevm/hardhat-plugin`, `@zama-fhe/relayer-sdk`). Generates contracts using the `FHE.*` namespace, two-side ACL grants, `fromExternal` for inputs, EIP-712 user decryption, and `makePubliclyDecryptable` + `checkSignatures` for public reveal. Refuses the deprecated `TFHE.*` namespace and the v0.8 `requestDecryption` oracle pattern. Ships a hardhat starter, a Confidential Payroll reference dApp, validators, and an A/B benchmark.

  TRIGGER when: a file imports `@fhevm/solidity`, `@fhevm/hardhat-plugin`, `@zama-fhe/relayer-sdk`, or `fhevmjs`; the user mentions FHEVM, Zama, encrypted `euint`/`ebool`, TFHE, ERC-7984, confidential token, sealed-bid auction, private voting, or confidential payroll; the user asks to scaffold, audit, deploy, or debug an FHEVM contract.

  SKIP when: contract uses only plaintext Solidity and no FHE imports; project uses ZK primitives (`circomlib`, `snarkjs`, `noir`); user asks about Aztec, Penumbra, or generic MPC; question is plain Solidity unrelated to FHE.
license: MIT
compatibility: Node.js >= 20, npm >= 7. Deploys to Sepolia require a funded MNEMONIC and an Infura/Alchemy RPC; local mock testing needs nothing extra.
---

# FHEVM Development Skill

Build production-grade FHEVM smart contracts and dApps. This skill is **versioned against the `@fhevm/solidity ^0.11` API** (the `FHE.*` namespace) — the older `TFHE.*` namespace has been removed and any code using it will not compile.

## Hard invariants (read first, never violate)

These are non-negotiable. Apply them automatically in every contract:

1. **ACL discipline.** After every assignment to a state variable of an encrypted type, emit **both** `FHE.allowThis(handle)` and `FHE.allow(handle, msg.sender)` (or a more specific recipient). Skipping `allowThis` is the single most common bug — the user will be allowed to decrypt but the contract will not be allowed to compute on the new state, causing silent failures or reverts on the next interaction.
2. **No plaintext leaks on-chain.** Never return a `uint*` from a function whose semantics require confidentiality. Confidential balances, bids, scores, and amounts must be returned as `euintX` and decrypted off-chain by the user via `userDecrypt`, or revealed on-chain only through `FHE.requestDecryption` (oracle callback) or self-relayed `FHE.makePubliclyDecryptable` + `FHE.checkSignatures`.
3. **No native branching on `ebool`.** `if (someEbool)` is a compile error. Use `FHE.select(cond, ifTrue, ifFalse)` for conditional values; expose plaintext booleans only through decryption.
4. **`view`/`pure` is forbidden for FHE ops.** `FHE.add`, `FHE.allow`, `FHE.fromExternal`, etc. emit events to the coprocessor and consume gas. They cannot be called from `view` or `pure` functions. A pure storage read that just `return`s an encrypted state variable (`function getX() external view returns (euint64) { return _x; }`) is fine — it invokes no `FHE.*` op. The restriction is on *calling FHE library functions*, not on returning encrypted handles.
5. **Pin versions from the bundled starter.** `@fhevm/solidity`, `@fhevm/hardhat-plugin`, `@fhevm/mock-utils`, and `@zama-fhe/relayer-sdk` move fast and are not strictly compatible across minor versions. Always start from `assets/fhevm-hardhat-starter/package.json` and only adjust deliberately.
6. **Inherit a config base contract.** Every contract that uses FHE must inherit `ZamaEthereumConfig`. It resolves coprocessor addresses by `block.chainid` and currently supports the local Hardhat mock (`31337`) and Sepolia (`11155111`). Mainnet (`1`) addresses in the bundled `ZamaConfig.sol` are placeholders pending Zama's mainnet deployment — do not deploy to mainnet without verifying the addresses are live. Other chains revert with `ZamaProtocolUnsupported`.

## Workflow / decision tree

```
User request
│
├── New project from scratch?
│   └── 1. Copy assets/fhevm-hardhat-starter/ → user's target dir
│      2. Pick the closest pattern from references/common-patterns.md
│      3. Write contract using v0.11 FHE.* API
│      4. Add ACL after every state mutation (invariant #1)
│      5. Run scripts/check_acl.mjs   → must report 0 violations
│      6. Run scripts/compile_check.sh → must return status: success
│      7. Write a mock-mode test (see test/FHECounter.ts in starter)
│      8. Run npm test                → all tests must pass
│
├── Add an FHE feature to an existing FHEVM project?
│   └── Read references/encrypted-types-and-ops.md + references/acl-model.md
│      Apply assets/snippets/* and verify with scripts/check_acl.mjs
│
├── Build the headline confidential-finance dApp?
│   └── Read assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol
│      and the matching test/ConfidentialPayroll.ts. It is the canonical
│      "Confidential Finance" reference: per-employee encrypted balances,
│      encrypted payroll aggregate, FHE.min withdrawal clamp, and the
│      v0.11 self-relayed public-decryption settlement pattern.
│
├── Errors on compile / test?
│   └── Run scripts/compile_check.sh, parse JSON output, look up the
│      error in references/debugging.md (covers ACLNotAllowed,
│      InvalidProof, HCULimitExceeded, sender-mismatch, etc.).
│
└── Deploy / verify on Sepolia?
    └── Follow references/hardhat-and-deployment.md. Use
       npx hardhat vars set MNEMONIC / INFURA_API_KEY / ETHERSCAN_API_KEY
       then npx hardhat deploy --network sepolia and
       npx hardhat verify --network sepolia <address>.
```

## Quick start: encrypted counter

The `FHECounter` contract in the starter is the smallest end-to-end example. Read `assets/fhevm-hardhat-starter/contracts/FHECounter.sol` and `assets/fhevm-hardhat-starter/test/FHECounter.ts` once before generating new code — the import paths, the `ZamaEthereumConfig` base, the `FHE.fromExternal(handle, inputProof)` flow, the `FHE.allowThis` / `FHE.allow(_, msg.sender)` pair, and the `fhevm.createEncryptedInput().add32().encrypt()` test pattern are reused unchanged in almost every FHEVM contract.

## Building a new FHEVM contract (canonical sequence)

1. **Inherit the config base.** `contract MyThing is ZamaEthereumConfig { ... }`.
2. **Declare encrypted state.** Use the smallest sufficient bit-width: `euint8` for ages, `euint32` for counters, `euint64` for token balances/money. `euint256` only when truly needed (hashes). Each extra bit costs gas.
3. **Receive encrypted inputs.** Every external encrypted argument is a pair `(externalEuintXX value, bytes calldata inputProof)`. Convert with `FHE.fromExternal(value, inputProof)` *exactly once* at the top of the function. The proof is bound to `msg.sender` — the user who encrypted off-chain must be the same who submits the tx.
4. **Compute.** Use `FHE.add / sub / mul / and / or / xor / not / eq / ne / lt / le / gt / ge / min / max / shl / shr / select`. Prefer the scalar overload (`FHE.add(x, 5)`) over the encrypted-encrypted form (`FHE.add(x, FHE.asEuint32(5))`) — it is dramatically cheaper.
5. **Branch with `FHE.select`.** Replace `if (cond) a; else b;` with `result = FHE.select(cond, a, b);`. Native `if`/`require` cannot accept `ebool`.
6. **Issue ACL grants.** After every assignment to encrypted state, emit `FHE.allowThis(handle)` AND `FHE.allow(handle, recipient)`. Use `FHE.allowTransient` for ciphertexts passed to a sibling contract within the same tx (cheaper, auto-revokes).
7. **Reveal carefully.** For "user views their own value", do nothing on-chain — the user runs `instance.userDecrypt(...)` off-chain (the ACL grant already authorizes them). For "everyone sees this value" or "the contract itself needs the cleartext to release ETH/tokens", call `FHE.makePubliclyDecryptable(handle)` and store the handle keyed by a request id; the user (or any dApp) runs `instance.publicDecrypt([handle])` off-chain, then submits `(abiEncodedClear, decryptionProof)` to a settlement method on the contract that runs `FHE.checkSignatures(handles, abiEncodedClear, decryptionProof)` and decodes the cleartext.

## Receiving encrypted inputs

```solidity
function deposit(externalEuint64 amount, bytes calldata inputProof) external {
    euint64 encryptedAmount = FHE.fromExternal(amount, inputProof);
    balances[msg.sender] = FHE.isInitialized(balances[msg.sender])
        ? FHE.add(balances[msg.sender], encryptedAmount)
        : encryptedAmount;
    FHE.allowThis(balances[msg.sender]);
    FHE.allow(balances[msg.sender], msg.sender);
}
```

The off-chain encryption (frontend) — see `references/frontend-relayer-sdk.md` for the full code:

```ts
const enc = await instance
    .createEncryptedInput(contractAddr, userAddr)
    .add64(BigInt(1_000))
    .encrypt();
await contract.connect(user).deposit(enc.handles[0], enc.inputProof);
```

## Decrypting outputs (two paths — pick the right one)

| Pattern                          | Use case                                              | Where the cleartext appears               |
|----------------------------------|-------------------------------------------------------|-------------------------------------------|
| **A. User decryption (EIP-712)** | One specific user views *their own* value             | Off-chain, in the user's browser only     |
| **B. Self-relayed public decryption** | Everyone should see a value (e.g. final score, payout amount) | On-chain, after the dApp re-submits the cleartext + KMS signatures |

Full code examples for each in `references/decryption-patterns.md`. Pattern A is the default for confidential-finance dApps (each user sees only their own balance/bid/share). Pattern B is for revealing a value to the contract itself (e.g. paying out an ETH amount equal to a previously-encrypted balance).

**Important: `FHE.requestDecryption(...)` (the v0.8 oracle-callback API) does not exist in `@fhevm/solidity ^0.11`.** Older tutorials, blog posts, and community examples that use `FHE.requestDecryption` (or `Gateway.requestDecryption`) are out of date and will not compile against the current toolchain. The v0.11 idiom is **always** `FHE.makePubliclyDecryptable(handle)` on-chain plus `instance.publicDecrypt([handle])` off-chain plus `FHE.checkSignatures(...)` to verify the relayed cleartext on-chain. Reject any AI-suggested code that imports `Gateway*` or calls `requestDecryption`.

## ✅ / ❌ patterns to apply automatically

```solidity
// ❌ WRONG — forgets allowThis, contract can't keep computing on the value
balances[to] = FHE.add(balances[to], amount);
FHE.allow(balances[to], to);

// ✅ CORRECT — both grants
balances[to] = FHE.add(balances[to], amount);
FHE.allowThis(balances[to]);
FHE.allow(balances[to], to);
```

```solidity
// ❌ WRONG — ebool can't drive native branching
if (FHE.gt(bid, highest)) highest = bid;

// ✅ CORRECT — FHE.select
ebool higher = FHE.gt(bid, highest);
highest = FHE.select(higher, bid, highest);
```

```solidity
// ❌ WRONG — leaks plaintext, defeats the whole point
function balanceOf(address u) external view returns (uint64) {
    return uint64(euint64.unwrap(balances[u]));
}

// ✅ CORRECT — return the handle; user decrypts off-chain
function balanceOf(address u) external view returns (euint64) {
    return balances[u];
}
```

```solidity
// ⚠️ SUBOPTIMAL — trivially encrypts the literal first, dramatically gassier
total = FHE.add(total, FHE.asEuint64(fee));

// ✅ PREFERRED — scalar overload
total = FHE.add(total, fee);
```

```solidity
// ❌ WRONG — view function with FHE op
function preview(externalEuint64 a, bytes calldata p) external view returns (euint64) {
    return FHE.fromExternal(a, p); // FHE ops emit events; not view-safe
}

// ✅ CORRECT — drop view; or move conversion into a non-view caller
function preview(externalEuint64 a, bytes calldata p) external returns (euint64) {
    return FHE.fromExternal(a, p);
}
```

```solidity
// ❌ WRONG — division by encrypted divisor is unsupported
quotient = FHE.div(numerator, encDivisor);

// ✅ CORRECT — divide by a plaintext scalar only
quotient = FHE.div(numerator, 100);
```

## Frontend integration

Use `@zama-fhe/relayer-sdk` (replaces the deprecated `fhevmjs`). Initialize once per session, then for every encrypted-input tx call `instance.createEncryptedInput(...).addX(...).encrypt()` and pass the resulting `handles[i]` and shared `inputProof` to the contract. For viewing values, call `instance.userDecrypt(...)` with an EIP-712 signature; for revealing values, call `instance.publicDecrypt([handle])` and submit the abi-encoded cleartext + KMS proof back to a settlement method that runs `FHE.checkSignatures(...)`. Full code in `references/frontend-relayer-sdk.md`. The starter is contract-only by design — when generating a UI, keep the encryption layer in a single helper and use the `ConfidentialPayroll` contract methods as the integration target.

## Testing (mock mode)

The `@fhevm/hardhat-plugin` exposes a `fhevm` helper on the Hardhat runtime:

```ts
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

if (!fhevm.isMock) this.skip();

const enc = await fhevm.createEncryptedInput(addr, alice.address).add64(1000n).encrypt();
await contract.connect(alice).deposit(enc.handles[0], enc.inputProof);

const handle = await contract.balanceOf(alice.address);
const clear = await fhevm.userDecryptEuint(FhevmType.euint64, handle, addr, alice);
expect(clear).to.eq(1000n);
```

Always gate tests with `if (!fhevm.isMock) this.skip();` and ship a separate `*Sepolia.ts` suite that does the inverse for live integration. For self-relayed public-decryption flows, drive the round trip in tests with `fhevm.publicDecrypt(...)` followed by submitting the result to your settlement method — there is no oracle-callback helper in v0.11.

## Validation checklist (apply before declaring "done")

- [ ] Contract inherits `ZamaEthereumConfig`.
- [ ] Every `externalEuint*` argument is paired with a `bytes calldata inputProof` and converted exactly once via `FHE.fromExternal`.
- [ ] After every assignment to an encrypted state variable, both `FHE.allowThis(_)` and `FHE.allow(_, recipient)` are issued.
- [ ] No public/external function with FHE ops is `view` or `pure`.
- [ ] No `if (ebool)` / `require(ebool)` — use `FHE.select` and decrypt-then-check.
- [ ] No function returns a plaintext value derived from confidential state without an explicit reveal flow.
- [ ] `scripts/check_acl.mjs <file.sol>` reports 0 violations.
- [ ] `scripts/compile_check.sh` returns `status: success`.
- [ ] At least one mock-mode test asserts the post-state via `fhevm.userDecryptEuint`.
- [ ] `package.json` matches the pinned versions in `assets/fhevm-hardhat-starter/package.json`.

## Additional resources

### references/ — load on demand for deeper detail

- `references/encrypted-types-and-ops.md` — full table of `eboolean/euint*/eaddress`, supported operators, scalar-vs-ciphertext gas notes, shift/rotate semantics.
- `references/acl-model.md` — how the per-handle ACL works, the two-side rule for user decryption, `allowTransient` for cross-contract calls, propagation gotchas.
- `references/decryption-patterns.md` — full code for user decryption, self-relayed public decryption, and oracle-callback async decryption (sealed-bid reveal pattern).
- `references/frontend-relayer-sdk.md` — `@zama-fhe/relayer-sdk` initialization, `createEncryptedInput`, EIP-712 user decryption, public decryption.
- `references/hardhat-and-deployment.md` — `hardhat.config.ts` template, `vars` setup, mock vs Sepolia gating, deploy/verify commands.
- `references/common-patterns.md` — confidential ERC-7984 token, sealed-bid auction, private voting, confidential payroll structures with code-skeleton excerpts.
- `references/debugging.md` — error-to-fix mapping (`ACLNotAllowed`, `HCULimitExceeded`, sender-mismatch, oracle timeouts).
- `references/migration-from-tfhe.md` — symbol-by-symbol migration from the legacy `TFHE.*` API to the v0.11 `FHE.*` API.

### scripts/ — run with `--help` first; do NOT read the source

- `scripts/check_acl.mjs <file.sol>` — static analysis: every assignment to an encrypted state variable in an external function must be followed (within ~5 statements) by `FHE.allowThis` AND a matching `FHE.allow(_, msg.sender|user)`. Outputs JSON.
- `scripts/compile_check.sh [project_dir]` — runs `npx hardhat compile` and emits a JSON summary (`status`, `errors[]`, `warnings[]`).

### assets/ — copy into the user's target directory; do NOT reinvent

- `assets/fhevm-hardhat-starter/` — full working hardhat project. The literal starting point. Ships with two contracts:
  - `contracts/FHECounter.sol` — minimal hello-world for FHE state, encrypted input, and ACL grants.
  - `contracts/ConfidentialPayroll.sol` — the headline Confidential Finance reference: per-employee encrypted balances, employer-only encrypted payroll aggregate, `FHE.min` withdrawal clamp, and the v0.11 self-relayed public-decryption settlement pattern.

  Mock-mode tests for both contracts pass out of the box (`npm install && npx hardhat test`). **Always copy the entire starter before generating a new contract project.**
- `assets/snippets/` — drop-in fragments for common operations (input handling, transient ACL pattern, self-relayed public decryption call site, EIP-712 user decryption helper).

### evals/ — evaluation harness

- `evals/prompts/` — five end-to-end prompts (counter, ERC-7984 token, sealed auction, private voting, confidential payroll) used to measure first-shot generation quality with vs. without this skill loaded.
- `evals/RESULTS.md` — published A/B comparison.

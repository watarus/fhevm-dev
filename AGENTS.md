# AGENTS.md — fhevm-dev

This is the canonical AI-agent context for this repository. It is consumed by **Claude Code** (via `.claude/skills/fhevm-dev/`), **Cursor** (via `.cursorrules` and `.cursor/rules/fhevm-dev.mdc`), **Codex CLI** and **Aider** (via this `AGENTS.md`), **Continue.dev** (via `.continue/`), and any other coding agent that respects the `AGENTS.md` convention.

The full skill — including 8 references, 2 validation scripts, a runnable Hardhat starter with FHECounter and ConfidentialPayroll, and an A/B evaluation harness — lives under [`fhevm-dev/`](fhevm-dev/). Read [`fhevm-dev/SKILL.md`](fhevm-dev/SKILL.md) before generating any FHEVM code.

## Operating context

- **Toolchain**: `@fhevm/solidity ^0.11.1` (the `FHE.*` namespace), `@fhevm/hardhat-plugin ^0.4.2`, `@fhevm/mock-utils ^0.4.2`, `@zama-fhe/relayer-sdk ^0.4.1`. Pinned in [`fhevm-dev/assets/fhevm-hardhat-starter/package.json`](fhevm-dev/assets/fhevm-hardhat-starter/package.json).
- **Solidity**: `^0.8.24`, compiler `0.8.27`, `evmVersion: cancun`.
- **Networks**: local Hardhat mock (chainId `31337`) and Sepolia (`11155111`). Mainnet (`1`) addresses are placeholders pending Zama's mainnet deployment.

## Six hard invariants — apply automatically

1. **ACL discipline.** After every assignment to encrypted state, emit **both** `FHE.allowThis(handle)` and `FHE.allow(handle, recipient)`. Forgetting `allowThis` silently breaks `userDecrypt`.
2. **No plaintext leaks.** Never return a `uint*` derived from confidential state. Confidential balances/bids/scores are returned as `euintX` and decrypted off-chain via `userDecrypt`, or revealed on-chain only via `FHE.makePubliclyDecryptable` + `FHE.checkSignatures`.
3. **No native branching on `ebool`.** `if (someEbool)` and `require(someEbool)` are compile errors. Use `FHE.select(cond, ifTrue, ifFalse)`.
4. **`view`/`pure` is forbidden for FHE ops.** `FHE.add`/`FHE.allow`/`FHE.fromExternal` etc. emit events to the coprocessor and consume gas. A pure storage read that just `return`s an encrypted state variable is fine — the restriction is on **calling** FHE library functions, not on returning encrypted handles.
5. **Pin versions.** Always copy from [`fhevm-dev/assets/fhevm-hardhat-starter/package.json`](fhevm-dev/assets/fhevm-hardhat-starter/package.json). Cross-minor breakage is common.
6. **Inherit a config base contract.** Every contract that uses FHE must inherit `ZamaEthereumConfig` from `@fhevm/solidity/config/ZamaConfig.sol`.

## What to NEVER write

- `import "fhevm/lib/TFHE.sol"` or `TFHE.*` — this is the legacy v0.7/v0.8 namespace. **It does not compile against `@fhevm/solidity ^0.11`.**
- `Gateway.requestDecryption(...)`, `IGateway`, `GatewayCaller`, `onlyGateway` — the on-chain oracle decryption API was removed in v0.9+. The v0.11 idiom is `FHE.makePubliclyDecryptable(handle)` on-chain, then `instance.publicDecrypt([handle])` off-chain, then `FHE.checkSignatures(...)` settlement on-chain.
- `import "fhevmjs"` — replaced by `@zama-fhe/relayer-sdk`.
- `SepoliaConfig`, `LocalConfig`, `MainnetConfig` as base contracts — replaced by `ZamaEthereumConfig`.
- `FHE.requestDecryption(...)` or `await hre.fhevm.awaitDecryptionOracle()` — these helpers do not exist in v0.11.

If a task description includes any of the above symbols (e.g. an old tutorial copied verbatim), translate to the v0.11 equivalents in [`fhevm-dev/references/migration-from-tfhe.md`](fhevm-dev/references/migration-from-tfhe.md) before proceeding.

## Workflow for "build a new FHEVM contract"

1. Copy [`fhevm-dev/assets/fhevm-hardhat-starter/`](fhevm-dev/assets/fhevm-hardhat-starter/) wholesale into the user's target directory (do **not** rebuild the project structure from scratch).
2. Pick the closest match from [`fhevm-dev/references/common-patterns.md`](fhevm-dev/references/common-patterns.md): confidential ERC-7984 token, sealed-bid auction, private voting, confidential payroll, or private payment splitter.
3. Write the contract starting from that pattern. Apply the six invariants above without exception.
4. Run [`fhevm-dev/scripts/check_acl.mjs`](fhevm-dev/scripts/check_acl.mjs) on the generated `.sol`. It must report `"status": "clean"` and `"totalViolations": 0`. The script flags both ACL discipline lapses **and** any deprecated v0.7/v0.8 namespace usage.
5. Run [`fhevm-dev/scripts/compile_check.sh`](fhevm-dev/scripts/compile_check.sh). It must return `"status": "success"`.
6. Write a Hardhat test in mock mode. Gate with `if (!fhevm.isMock) this.skip();`. Use `fhevm.createEncryptedInput(addr, user).addX(value).encrypt()` for inputs and `fhevm.userDecryptEuint(FhevmType.euintX, handle, addr, signer)` for assertions.
7. Run `npm test`. All tests must pass.

## Reveal patterns

| Pattern | Use when | Code path |
|---|---|---|
| **A. User decryption (EIP-712)** | One specific user views their own value | Off-chain: `instance.userDecrypt(...)`. On-chain: just `FHE.allow(handle, user)` |
| **B. Self-relayed public decryption** | Anyone (or the contract itself) needs the cleartext | On-chain: `FHE.makePubliclyDecryptable(handle)`. Off-chain: `instance.publicDecrypt([handle])`. On-chain settlement: `FHE.checkSignatures(cts, abiEncodedClear, proof)` then `abi.decode(...)` |

Full code in [`fhevm-dev/references/decryption-patterns.md`](fhevm-dev/references/decryption-patterns.md).

## Frontend SDK (`@zama-fhe/relayer-sdk`)

- Initialize once per session: `await initSDK(); const instance = await createInstance({ ...SepoliaConfig, network: provider });`
- `instance.createEIP712(pubKey, [contractAddress], startTimestamp, durationDays)` requires **numbers** for `startTimestamp` and `durationDays` (not strings — the SDK enforces `typeof === "number"`).
- The `userAddress` argument to `instance.userDecrypt(...)` must equal the address that produced the EIP-712 signature; the relayer cross-checks it.
- Do not pass `signature.replace("0x", "")` — the SDK strips the prefix internally.
- Full code: [`fhevm-dev/assets/snippets/frontend-helpers.ts`](fhevm-dev/assets/snippets/frontend-helpers.ts).

## Headline reference contract

[`fhevm-dev/assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol`](fhevm-dev/assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol) is the canonical Confidential Finance dApp. It exercises every pattern in this skill: per-employee `euint64` balances with per-recipient ACL, encrypted aggregate `_totalPayroll` gated to the owner only, `FHE.min` clamp for withdrawals, `FHE.makePubliclyDecryptable` + `FHE.checkSignatures` self-relayed settlement, and ETH release. Twenty mock-mode tests pass on a clean install.

## Validation checklist before declaring "done"

- [ ] Contract inherits `ZamaEthereumConfig`.
- [ ] Every `externalEuint*` argument is paired with `bytes calldata inputProof` and converted exactly once via `FHE.fromExternal`.
- [ ] After every assignment to encrypted state, both `FHE.allowThis(_)` and `FHE.allow(_, recipient)` are issued.
- [ ] No `view`/`pure` on functions that call FHE library functions.
- [ ] No `if (ebool)` / `require(ebool)` — use `FHE.select`.
- [ ] No deprecated namespace (`TFHE.*`, `Gateway*`, `requestDecryption`, `fhevmjs`).
- [ ] `node fhevm-dev/scripts/check_acl.mjs <file.sol>` reports clean.
- [ ] `bash fhevm-dev/scripts/compile_check.sh` returns success.
- [ ] At least one mock-mode test asserts the post-state via `fhevm.userDecryptEuint`.

## Where to find more

| Topic | File |
|---|---|
| Encrypted types and operator matrix | [`fhevm-dev/references/encrypted-types-and-ops.md`](fhevm-dev/references/encrypted-types-and-ops.md) |
| ACL model + two-side rule + propagation | [`fhevm-dev/references/acl-model.md`](fhevm-dev/references/acl-model.md) |
| Decryption patterns (A and B with full code) | [`fhevm-dev/references/decryption-patterns.md`](fhevm-dev/references/decryption-patterns.md) |
| Frontend SDK usage | [`fhevm-dev/references/frontend-relayer-sdk.md`](fhevm-dev/references/frontend-relayer-sdk.md) |
| Hardhat config + deploy + Sepolia gating | [`fhevm-dev/references/hardhat-and-deployment.md`](fhevm-dev/references/hardhat-and-deployment.md) |
| Common contract patterns (auction, voting, ERC-7984, payroll, splitter) | [`fhevm-dev/references/common-patterns.md`](fhevm-dev/references/common-patterns.md) |
| Error → fix mapping | [`fhevm-dev/references/debugging.md`](fhevm-dev/references/debugging.md) |
| `TFHE.*` → `FHE.*` migration cheat sheet | [`fhevm-dev/references/migration-from-tfhe.md`](fhevm-dev/references/migration-from-tfhe.md) |

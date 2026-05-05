---
name: fhevm-dev
description: FHEVM v0.11 Solidity guidance — strict FHE.* namespace, two-side ACL, self-relayed public decryption.
---

See [`AGENTS.md`](../../AGENTS.md) at the repo root for the full agent context. Continue.dev should treat this as the canonical guidance file for any FHEVM-related task.

The skill enforces six hard invariants:

1. **ACL discipline** — `FHE.allowThis(handle)` + `FHE.allow(handle, recipient)` after every assignment to encrypted state.
2. **No plaintext leaks** — confidential state stays as `euintX`; cleartext exits only via `instance.userDecrypt(...)` (per-user) or `FHE.makePubliclyDecryptable` + `FHE.checkSignatures` (public).
3. **No native branching on `ebool`** — use `FHE.select`.
4. **No `view`/`pure` on FHE-op functions** — getters that just `return` a handle are fine.
5. **Pin versions** from `fhevm-dev/assets/fhevm-hardhat-starter/package.json`.
6. **Inherit `ZamaEthereumConfig`** from `@fhevm/solidity/config/ZamaConfig.sol`.

Never write: `TFHE.*`, `Gateway*`, `requestDecryption`, `fhevmjs`, `SepoliaConfig`, `LocalConfig`, `MainnetConfig`. These are pre-v0.11 and will not compile or load.

Headline reference: `fhevm-dev/assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol` (20 mock-mode tests pass).

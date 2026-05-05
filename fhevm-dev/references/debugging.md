# Debugging FHEVM contracts

Map a symptom to the most likely cause first; only then read the stack trace.

## 1. Compile-time errors

| Error | Cause | Fix |
|-------|-------|-----|
| `Identifier not found or not unique. TFHE` | Code uses the legacy `TFHE.*` namespace | Replace with `FHE.*`. See `migration-from-tfhe.md`. |
| `Identifier not found or not unique. Gateway` / `IGateway` | Code imports the v0.8 oracle gateway | Remove all `Gateway` references. Use the self-relayed `makePubliclyDecryptable` + `checkSignatures` pattern from `decryption-patterns.md`. |
| `requestDecryption is not a member of FHE` | The same v0.8 oracle pattern | As above. |
| `pragma solidity ^0.8.24` rejects | `solidity.version` in `hardhat.config.ts` is too old | Set to `0.8.27`, with `evmVersion: "cancun"`. |
| `Type ebool is not implicitly convertible to expected type bool` | `if (ebool)` or `require(ebool)` in code | Use `FHE.select` for conditional values; reveal via `userDecrypt`/`publicDecrypt` only when native control flow needs the cleartext. |
| `Function cannot be declared as view as this expression (potentially) modifies the state` | An FHE op (e.g. `FHE.add`, `FHE.fromExternal`) is inside a `view`/`pure` function | Drop `view`/`pure` from the function. Reading an existing handle through a getter is fine. |
| `No matching function for call to "div(euint64, euint64)"` | Trying to divide two ciphertexts | `div`/`rem` require a plaintext divisor. Use `FHE.div(numerator, plaintextDenominator)`. |

## 2. Runtime / test errors

| Error | Cause | Fix |
|-------|-------|-----|
| `ACLNotAllowed` (or silent failure of `userDecrypt`) | The contract or user is not on the handle's ACL after the latest assignment | Re-grant: after every `_state = FHE.add(...)` (or any other op that produces a new handle), call `FHE.allowThis(_state)` AND `FHE.allow(_state, recipient)`. |
| `userDecrypt` returns nothing | `FHE.allowThis(handle)` was never called for the new handle | Add `FHE.allowThis` after every assignment. |
| `userDecrypt` rejects with permission error | `FHE.allow(handle, user)` was never called | Add the user-facing grant. |
| `Reverted with reason "FHE.fromExternal: invalid sender"` | The signer that submitted the tx is not the address used in `instance.createEncryptedInput(_, userAddress)` | Match the encryptor and the submitter signers. |
| `Reverted with reason "InvalidKMSSignatures"` (inside `FHE.checkSignatures`) | The cleartext + proof submitted to `settlePayout` did not come from a `makePubliclyDecryptable`-flagged handle, or the `cts[]` order in `checkSignatures` does not match the order used to decrypt | Verify on-chain that `FHE.makePubliclyDecryptable(handle)` was called before the user runs `instance.publicDecrypt`. Check the `cts[]` order matches the `abi.decode` order. |
| `HCULimitExceeded` | The transaction exceeded the per-tx Homomorphic Compute Unit budget | Split work across transactions; reduce `euint*` bit-widths; prefer scalar overloads (`FHE.add(x, 5)` over `FHE.add(x, FHE.asEuint*(5))`). |
| `fhevm.userDecryptEuint(...)` rejects in tests | Same root cause as `userDecrypt` permission errors | Check the test's `signer` parameter matches the `FHE.allow(handle, signer.address)` recipient. |
| `cannot estimate gas; transaction may fail` on Sepolia for a function that compiled fine | The signer's address is not on the ACL of one of the input handles consumed inside the function | Trace which handle the function reads, confirm `FHE.allow(handle, signer)` was emitted on a prior tx. |

## 3. Frontend / SDK errors

| Error | Cause | Fix |
|-------|-------|-----|
| `instance.createEncryptedInput(...).add32 is not a function` | Wrong width helper for the contract argument type | Use `add64` for `euint64` arguments, etc. |
| `instance.userDecrypt(...) returned undefined for handle` | ACL is fine but the EIP-712 signature was made with a different signer than the `signer.address` parameter | Use the same signer end-to-end. |
| Imports `fhevmjs` | Deprecated package | Switch to `@zama-fhe/relayer-sdk` (`/bundle` entry for browser bundlers). |

## 4. Diagnostic recipes

### "Has anyone been allowed on this handle?"

In tests, after every assignment, you can assert:

```ts
expect(await contract.runner!.provider!.send("eth_call", [...]) /* via FHE.isAllowed view */)
```

…or just sanity-check by attempting `fhevm.userDecryptEuint` from each expected signer and ensuring it returns the expected cleartext.

### "Is the FHEVM toolchain version what I think?"

```bash
npm ls @fhevm/solidity @fhevm/hardhat-plugin @fhevm/mock-utils @zama-fhe/relayer-sdk
```

The starter pins `@fhevm/solidity ^0.11`, `@fhevm/hardhat-plugin ^0.4`, `@fhevm/mock-utils ^0.4`, `@zama-fhe/relayer-sdk ^0.4`. A mismatch is a common source of subtle bugs.

### "Did `FHE.requestDecryption` really get removed?"

```bash
grep -n requestDecryption node_modules/@fhevm/solidity/lib/FHE.sol
# (no output means: yes, it is gone in v0.11)
```

# Access-control list (ACL) model

Every encrypted handle has a per-handle ACL stored on the FHEVM ACL contract. Anyone who is not on the list cannot decrypt — neither off-chain via the relayer SDK nor on-chain via `FHE.checkSignatures`. Forgetting to issue the right ACL grants is the **single most common source of FHEVM bugs**.

## 1. The two-side rule for user decryption

For a user `U` to call `instance.userDecrypt(handle)` against a contract `C`, both of the following must hold:

* `FHE.allow(handle, U)` was called (so `U` is on the list)
* `FHE.allowThis(handle)` was called (so `C` is on the list)

If only `FHE.allow(handle, U)` is called, the user has permission but the *contract* does not — `userDecrypt` silently fails. After every assignment to an encrypted state variable, emit **both** grants:

```solidity
balances[user] = FHE.add(balances[user], amount);
FHE.allowThis(balances[user]);          // contract can keep computing on it
FHE.allow(balances[user], user);        // user can decrypt it off-chain
```

## 2. Permanent vs transient

| Function | Persistence | Use when |
|----------|-------------|----------|
| `FHE.allow(handle, account)` | Stored permanently in the ACL | The grant must survive across transactions (e.g. a balance the user can read at any time). |
| `FHE.allowThis(handle)` | Same as above, with `account = address(this)` | The contract needs to compute on the handle in a future tx. |
| `FHE.allowTransient(handle, account)` | Valid only for the duration of the current tx; auto-revoked on tx end | Cheaper. Use when passing a ciphertext to a sibling contract within the same tx (e.g. `confidentialTransfer` → `swap`). |
| `FHE.makePubliclyDecryptable(handle)` | Anyone can fetch the cleartext via `instance.publicDecrypt` | Reveal a value to all observers (e.g. a payout amount the contract needs to settle in ETH). |

## 3. Propagation rule (or rather: there is no propagation)

ACL entries do **not** propagate from inputs to outputs. After each `FHE.add` / `FHE.sub` / `FHE.select`, the resulting handle has an empty ACL. You must re-issue the grants:

```solidity
// even though `balance[user]` was already allowed,
// the new handle from FHE.add is a fresh handle with its own ACL.
balance[user] = FHE.add(balance[user], amount);
FHE.allowThis(balance[user]);
FHE.allow(balance[user], user);
```

Forgetting this is the #1 cause of "the next call reverts even though the first one succeeded" bugs.

## 4. Cross-contract calls

When you pass an encrypted handle to a sibling contract, that sibling must be on the ACL of the handle for it to compute on the value. Use `allowTransient` in the same tx:

```solidity
euint64 amount = FHE.fromExternal(amountInput, inputProof);
FHE.allowTransient(amount, address(token));
uint256 received = token.confidentialTransferFrom(msg.sender, address(this), amount);
```

Permanent `allow` is wasteful here because the sibling never needs the handle again after this tx.

## 5. Public decryption

`FHE.makePubliclyDecryptable(handle)` flags a handle as publicly decryptable so that **any** caller can fetch its cleartext via `instance.publicDecrypt([handle])` (no per-user EIP-712 signature needed). The contract typically still needs the cleartext too, in which case the dApp self-relays it:

```solidity
FHE.makePubliclyDecryptable(actualToPay);
FHE.allowThis(actualToPay);
emit PayoutRequested(payoutId, msg.sender, FHE.toBytes32(actualToPay));
```

```ts
// off-chain
const r = await instance.publicDecrypt([amountHandle]);
await contract.connect(user).settlePayout(payoutId, r.abiEncodedClearValues, r.decryptionProof);
```

```solidity
// on-chain settlement
function settlePayout(uint256 id, bytes calldata cleartext, bytes calldata proof) external {
    bytes32[] memory cts = new bytes32[](1);
    cts[0] = FHE.toBytes32(_pending[id].actualEnc);
    FHE.checkSignatures(cts, cleartext, proof); // reverts on bad proof
    uint64 amount = abi.decode(cleartext, (uint64));
    /* ...release ETH or trigger logic with `amount`... */
}
```

## 6. Common ACL bugs

| Symptom | Cause | Fix |
|---------|-------|-----|
| `userDecrypt` silently returns nothing | `allowThis` was never called for the new handle | Add `FHE.allowThis(handle)` after every assignment |
| `userDecrypt` rejects with permission error | `allow(handle, user)` not called | Add `FHE.allow(handle, recipient)` |
| Next state-mutating call reverts inside `FHE.add` | Old handle no longer on ACL because state var was overwritten | Re-grant after re-assignment (always, every time) |
| Cross-contract call reverts inside the sibling | Sibling not on the handle's ACL | Use `FHE.allowTransient(handle, address(sibling))` before the call |
| `FHE.checkSignatures` reverts | Cleartext was decrypted via a different code path (handle not flagged `makePubliclyDecryptable`) | Call `FHE.makePubliclyDecryptable(handle)` on-chain before the user runs `instance.publicDecrypt` |

## 7. Query helpers

```solidity
FHE.isAllowed(handle, account);        // bool
FHE.isSenderAllowed(handle);            // bool, == isAllowed(handle, msg.sender)
FHE.isUserDecryptable(handle, user, contractAddress);
FHE.isPubliclyDecryptable(handle);
```

These are `view` and useful for early-exit checks. They do **not** replace the actual `allow*` calls — they only query state already written.

# Decryption patterns (`@fhevm/solidity ^0.11` + `@zama-fhe/relayer-sdk ^0.4`)

There are exactly **two** decryption patterns in v0.11. The legacy `Gateway.requestDecryption` / `FHE.requestDecryption` oracle-callback API is gone — use the patterns below instead. If you find AI-suggested code that imports `IGateway` or calls `requestDecryption`, reject it as out-of-date.

## Pattern A — User decryption (EIP-712, off-chain)

Use when **one specific user** should view *their own* value (their balance, their bid, their share). The cleartext never appears on-chain.

### A.1 On-chain (just the ACL grants)

```solidity
balances[user] = FHE.add(balances[user], amount);
FHE.allowThis(balances[user]);
FHE.allow(balances[user], user);
```

### A.2 Off-chain (relayer SDK)

```ts
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";

await initSDK();
const instance = await createInstance({ ...SepoliaConfig, network: window.ethereum });

const handle = await contract.getSalary(user.address);   // bytes32 handle

const keypair = instance.generateKeypair();
// `createEIP712` and `userDecrypt` enforce `typeof startTimestamp === "number"`
// and `typeof durationDays === "number"` at runtime — passing strings throws
// `InvalidTypeError`. Use plain numbers.
const startTimeStamp = Math.floor(Date.now() / 1000);
const durationDays = 10;
const eip712 = instance.createEIP712(
  keypair.publicKey,
  [contractAddress],
  startTimeStamp,
  durationDays,
);

const signature = await signer.signTypedData(
  eip712.domain,
  { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
  eip712.message,
);

const result = await instance.userDecrypt(
  [{ handle, contractAddress }],
  keypair.privateKey,
  keypair.publicKey,
  signature,
  [contractAddress],
  signer.address,        // MUST be the address that produced the EIP-712 signature above
  startTimeStamp,
  durationDays,
);

const cleartext = result[handle];   // bigint | boolean | hex string
```

### A.3 In Hardhat tests (mock mode)

The plugin gives you a one-liner:

```ts
const cleartext = await fhevm.userDecryptEuint(
  FhevmType.euint64,    // type tag
  handle,
  contractAddress,
  signerThatHasAllowGrant,
);
```

If `allowThis` or `allow(handle, signer)` was missing, this rejects.

## Pattern B — Self-relayed public decryption

Use when **anyone** should be able to read the value, or when the **contract itself** needs to know the cleartext to release ETH/tokens.

### B.1 On-chain — request

```solidity
function requestPayout(externalEuint64 requested, bytes calldata inputProof) external returns (uint256 payoutId) {
    euint64 req = FHE.fromExternal(requested, inputProof);
    euint64 actual = FHE.min(req, balances[msg.sender]);

    balances[msg.sender] = FHE.sub(balances[msg.sender], actual);
    FHE.allowThis(balances[msg.sender]);
    FHE.allow(balances[msg.sender], msg.sender);

    FHE.makePubliclyDecryptable(actual);
    FHE.allowThis(actual);

    payoutId = nextPayoutId++;
    pending[payoutId] = PendingPayout({employee: msg.sender, actualEnc: actual, settled: false});
    emit PayoutRequested(payoutId, msg.sender, FHE.toBytes32(actual));
}
```

### B.2 Off-chain — fetch the cleartext + KMS proof

```ts
const r = await instance.publicDecrypt([amountHandle]);
// r = {
//   clearValues: { [handle]: bigint | boolean | hex },
//   abiEncodedClearValues: "0x...",
//   decryptionProof: "0x...",
// }
```

### B.3 On-chain — settle

```solidity
function settlePayout(
    uint256 payoutId,
    bytes calldata abiEncodedCleartext,
    bytes calldata decryptionProof
) external {
    PendingPayout storage p = pending[payoutId];
    require(!p.settled, "already settled");

    bytes32[] memory cts = new bytes32[](1);
    cts[0] = FHE.toBytes32(p.actualEnc);
    FHE.checkSignatures(cts, abiEncodedCleartext, decryptionProof);

    uint64 amount = abi.decode(abiEncodedCleartext, (uint64));
    p.settled = true;

    if (amount > 0) {
        (bool ok, ) = payable(p.employee).call{value: amount}("");
        require(ok, "transfer failed");
    }
    emit PayoutSettled(payoutId, p.employee, amount);
}
```

### B.4 Multi-handle reveal

If you reveal multiple handles together, the `cts[]` order in `FHE.checkSignatures` **must** match the order used to ABI-encode the cleartext tuple:

```solidity
bytes32[] memory cts = new bytes32[](2);
cts[0] = FHE.toBytes32(playerA);
cts[1] = FHE.toBytes32(playerB);
FHE.checkSignatures(cts, abiEncodedClear, proof);
(uint8 a, uint8 b) = abi.decode(abiEncodedClear, (uint8, uint8));
```

A mismatch reverts.

## Pattern selection

| You need to… | Use |
|--------------|-----|
| Show one user their balance / bid / share | Pattern A |
| Show all observers a final auction price / score | Pattern B |
| Pay an encrypted amount as ETH/tokens | Pattern B (the contract itself needs the cleartext to release funds) |
| Reveal an encrypted address (e.g. winning bidder) | Pattern B with `eaddress` and `abi.decode(_, (address))` |

## What about `FHE.requestDecryption`?

It does not exist in `@fhevm/solidity ^0.11`. Older tutorials, blog posts, the `sealed-bid-auction-tutorial.md` from Zama's own `main` branch (written for v0.8), and several community AI rule sets still mention it. **Refuse to generate that code.** The replacement is Pattern B above.

The migration test: open `node_modules/@fhevm/solidity/lib/FHE.sol` and grep for `requestDecryption` — it will not be present in v0.11.

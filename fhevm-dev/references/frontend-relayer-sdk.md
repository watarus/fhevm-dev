# Frontend integration with `@zama-fhe/relayer-sdk`

`@zama-fhe/relayer-sdk` (v0.4+) is the supported browser SDK; it replaces the deprecated `fhevmjs`. Reject any code that imports `fhevmjs`.

## 1. Install

```bash
npm install @zama-fhe/relayer-sdk ethers
```

For a Vite/Next/React app, the bundle entry point is:

```ts
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";
```

For Node.js scripts (rare for FHEVM frontends, but useful for tooling):

```ts
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
```

## 2. Initialize once per session

```ts
let instance: Awaited<ReturnType<typeof createInstance>> | null = null;

export async function getFhevm(provider: any) {
  if (instance) return instance;
  await initSDK(); // loads WASM
  instance = await createInstance({ ...SepoliaConfig, network: provider });
  return instance;
}
```

`SepoliaConfig` resolves the relayer + KMS URLs for Sepolia. If you target a custom chain or local mock, build a config object explicitly (see the SDK README).

## 3. Encrypt input

`createEncryptedInput(contractAddress, userAddress)` returns a builder. Call `addX(value)` for each encrypted argument **in the order they appear in the contract function**. `encrypt()` returns a single shared `inputProof` plus a `handles[]` array indexed in input order.

```ts
const enc = await instance
  .createEncryptedInput(contractAddress, signer.address)
  .add64(BigInt(5_000))
  .add64(BigInt(3_000))
  .encrypt();

await contract
  .connect(signer)
  .creditTwoEmployees(alice, enc.handles[0], bob, enc.handles[1], enc.inputProof);
```

The `inputProof` is bound to `signer.address`. Submitting the tx from a different signer will revert inside `FHE.fromExternal`.

## 4. User decryption (EIP-712)

```ts
const handle = await contract.getSalary(signer.address);

const keypair = instance.generateKeypair();
const startTimeStamp = Math.floor(Date.now() / 1000).toString();
const durationDays = "10";

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
  signature.replace("0x", ""),
  [contractAddress],
  signer.address,
  startTimeStamp,
  durationDays,
);

const cleartextSalary = result[handle];   // bigint
```

## 5. Public decryption (self-relayed)

```ts
const r = await instance.publicDecrypt([amountHandle]);
// r.clearValues:           { [handle]: bigint | boolean | hex }
// r.abiEncodedClearValues:  "0x..."  // ABI-encoded tuple of cleartext values
// r.decryptionProof:        "0x..."  // KMS signatures + metadata

// Submit back on-chain so the contract can run FHE.checkSignatures(...)
await contract.connect(signer).settlePayout(payoutId, r.abiEncodedClearValues, r.decryptionProof);
```

## 6. Common frontend mistakes

| Mistake | Fix |
|---------|-----|
| Using `fhevmjs` | Replace with `@zama-fhe/relayer-sdk`. The APIs differ (`createEncryptedInput` is similar; `userDecrypt` and EIP-712 are different). |
| Calling `createEncryptedInput` with a different `userAddress` than the signer that submits the tx | Either change the encryptor to match the submitter, or vice versa. The proof is bound to one specific `userAddress`. |
| Re-using a single `inputProof` across two unrelated transactions | Don't. The proof is single-use against the encrypted handles in that one transaction. |
| Forgetting to call `instance.userDecrypt` after the contract has only granted `allow(handle, user)` (without `allowThis`) | The decryption call returns nothing. Fix the contract to also call `FHE.allowThis(handle)`. |
| `add32(...)` for a `euint64` argument | Use `add64`. The width must match the contract argument type exactly. |

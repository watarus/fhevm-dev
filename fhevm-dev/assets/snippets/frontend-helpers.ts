// Drop-in helper module for FHEVM v0.11 frontends using `@zama-fhe/relayer-sdk`.
//
// Usage:
//   import { getFhevm, encryptUint64, userDecryptUint64, publicDecryptAndSettle } from "./frontend-helpers";
//
//   const instance = await getFhevm(window.ethereum);
//   const enc = await encryptUint64(instance, contractAddress, await signer.getAddress(), 5_000n);
//   await contract.connect(signer).deposit(enc.handle, enc.proof);
//
//   const handle = await contract.balanceOf(await signer.getAddress());
//   const balance = await userDecryptUint64(instance, signer, handle, contractAddress);

import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";
import type { Signer } from "ethers";

export type FhevmInstance = Awaited<ReturnType<typeof createInstance>>;

// Cache instances per provider object so a wallet/network switch does not
// silently reuse an instance bound to the wrong KMS endpoint. WeakMap allows
// the previous instance to be garbage-collected when the provider is dropped.
const instanceCache = new WeakMap<object, FhevmInstance>();

export async function getFhevm(provider: object): Promise<FhevmInstance> {
  const hit = instanceCache.get(provider);
  if (hit) return hit;
  await initSDK();
  const instance = await createInstance({ ...SepoliaConfig, network: provider as never });
  instanceCache.set(provider, instance);
  return instance;
}

export async function encryptUint64(
  instance: FhevmInstance,
  contractAddress: string,
  userAddress: string,
  value: bigint,
): Promise<{ handle: string; proof: string }> {
  const enc = await instance
    .createEncryptedInput(contractAddress, userAddress)
    .add64(value)
    .encrypt();
  const handle = enc.handles[0];
  if (typeof handle !== "string") {
    throw new Error(
      `encryptUint64: relayer SDK returned no handle (got ${typeof handle}). ` +
        `Verify the contract address and user address are correct.`,
    );
  }
  const proof = enc.inputProof;
  if (typeof proof !== "string") {
    throw new Error(`encryptUint64: relayer SDK returned no inputProof (got ${typeof proof}).`);
  }
  return { handle, proof };
}

export async function userDecryptUint64(
  instance: FhevmInstance,
  signer: Signer,
  handle: string,
  contractAddress: string,
): Promise<bigint> {
  const keypair = instance.generateKeypair();
  // The relayer SDK's createEIP712 / userDecrypt require numeric timestamps
  // and durations (the runtime asserts `typeof === "number"` — passing
  // strings throws an InvalidTypeError).
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
  const userAddress = await signer.getAddress();
  // The 6th argument MUST be the address that produced the EIP-712 signature
  // above; the relayer cross-checks it against the recovered signer.
  const result = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature,
    [contractAddress],
    userAddress,
    startTimeStamp,
    durationDays,
  );
  const raw = result[handle];
  if (raw == null) {
    throw new Error(
      `userDecryptUint64: relayer returned no value for handle ${handle}. ` +
        `Check that FHE.allowThis(handle) and FHE.allow(handle, ${userAddress}) were issued in the contract, ` +
        `and that the EIP-712 signer matches the userAddress argument.`,
    );
  }
  return BigInt(raw as string | bigint | number);
}

export async function publicDecryptAndSettle(
  instance: FhevmInstance,
  contract: { connect(s: Signer): { settle(id: bigint | number, clear: string, proof: string): Promise<unknown> } },
  signer: Signer,
  payoutId: bigint | number,
  amountHandle: string,
): Promise<unknown> {
  const r = await instance.publicDecrypt([amountHandle]);
  return contract.connect(signer).settle(payoutId, r.abiEncodedClearValues, r.decryptionProof);
}

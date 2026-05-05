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

let cached: FhevmInstance | null = null;

export async function getFhevm(provider: unknown): Promise<FhevmInstance> {
  if (cached) return cached;
  await initSDK();
  cached = await createInstance({ ...SepoliaConfig, network: provider as never });
  return cached;
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
  return { handle: enc.handles[0] as string, proof: enc.inputProof as string };
}

export async function userDecryptUint64(
  instance: FhevmInstance,
  signer: Signer,
  handle: string,
  contractAddress: string,
): Promise<bigint> {
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
    await signer.getAddress(),
    startTimeStamp,
    durationDays,
  );
  return BigInt(result[handle] as string | bigint | number);
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

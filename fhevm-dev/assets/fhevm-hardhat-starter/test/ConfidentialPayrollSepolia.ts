import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { ConfidentialPayroll } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

// End-to-end Sepolia test for the ConfidentialPayroll headline contract.
//
// Skips on the Hardhat mock chain so it does not pollute `npm test`. Run with:
//
//   npx hardhat vars set MNEMONIC
//   npx hardhat vars set INFURA_API_KEY
//   npx hardhat deploy --network sepolia
//   npx hardhat test --network sepolia test/ConfidentialPayrollSepolia.ts
//
// The test exercises the full self-relayed public-decryption flow that the
// SKILL.md and `references/decryption-patterns.md` document as Pattern B:
//
//   1. owner.addEmployee(employee)
//   2. owner.creditSalary(employee, encryptedAmount, inputProof)
//   3. employee.requestPayout(encryptedRequested, inputProof)
//      → contract clamps via FHE.min, deducts, makePubliclyDecryptable(actual),
//        emits PayoutRequested(payoutId, employee, amountHandle)
//   4. off-chain: fhevm.publicDecrypt([amountHandle])
//      → relayer SDK returns { abiEncodedClearValues, decryptionProof }
//   5. employee.settlePayout(payoutId, abiEncodedClear, proof)
//      → on-chain FHE.checkSignatures verifies, abi.decode produces uint64,
//        contract transfers ETH to employee
//   6. assert: employee's ETH balance increased by the cleartext amount.
//
// Funding note: the contract must hold enough ETH to cover the payout, and the
// employee account must have enough ETH to pay tx gas.

type Signers = {
  owner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
};

describe("ConfidentialPayrollSepolia", function () {
  let signers: Signers;
  let contract: ConfidentialPayroll;
  let address: string;
  let step: number;
  let steps: number;

  function progress(message: string) {
    console.log(`  ${++step}/${steps} ${message}`);
  }

  before(async function () {
    if (fhevm.isMock) {
      console.warn("ConfidentialPayrollSepolia is a live-network suite; skipping on mock.");
      this.skip();
    }

    try {
      const dep = await deployments.get("ConfidentialPayroll");
      address = dep.address;
      contract = (await ethers.getContractAt("ConfidentialPayroll", dep.address)) as unknown as ConfidentialPayroll;
    } catch (e) {
      (e as Error).message += ". Run `npx hardhat deploy --network sepolia` first.";
      throw e;
    }

    const ethSigners = await ethers.getSigners();
    signers = { owner: ethSigners[0], alice: ethSigners[1] };

    // Verify deployer is the contract owner — the test depends on it.
    const onChainOwner = await contract.owner();
    if (onChainOwner.toLowerCase() !== signers.owner.address.toLowerCase()) {
      console.warn(
        `Deployed ConfidentialPayroll owner is ${onChainOwner}, but signers.owner is ${signers.owner.address}. ` +
          "Skipping test. Re-deploy from the same MNEMONIC.",
      );
      this.skip();
    }
  });

  beforeEach(() => {
    step = 0;
    steps = 0;
  });

  it("end-to-end: credit → requestPayout → publicDecrypt → settlePayout → ETH transfer", async function () {
    this.timeout(15 * 60_000);

    const SALARY = 1_000_000n; // 1_000_000 wei = a tiny payout to keep the test cheap
    const REQUEST = 600_000n; // alice withdraws part of it
    steps = 12;

    progress("Ensuring alice is registered as an employee...");
    if (!(await contract.isEmployee(signers.alice.address))) {
      const tx = await contract.connect(signers.owner).addEmployee(signers.alice.address);
      await tx.wait();
    }

    progress("Funding the payroll contract with ETH for the payout...");
    const fundingTx = await signers.owner.sendTransaction({ to: address, value: SALARY });
    await fundingTx.wait();

    progress(`Encrypting salary credit (${SALARY} wei)...`);
    const credit = await fhevm.createEncryptedInput(address, signers.owner.address).add64(SALARY).encrypt();

    progress("Submitting creditSalary...");
    const creditTx = await contract
      .connect(signers.owner)
      .creditSalary(signers.alice.address, credit.handles[0], credit.inputProof);
    await creditTx.wait();

    progress(`Encrypting payout request (${REQUEST} wei)...`);
    const reqEnc = await fhevm.createEncryptedInput(address, signers.alice.address).add64(REQUEST).encrypt();

    progress("Submitting requestPayout...");
    const reqTx = await contract.connect(signers.alice).requestPayout(reqEnc.handles[0], reqEnc.inputProof);
    const reqReceipt = await reqTx.wait();

    progress("Reading payoutId + amount handle from PayoutRequested event...");
    let payoutId: bigint | undefined;
    let amountHandle: string | undefined;
    for (const log of reqReceipt!.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed && parsed.name === "PayoutRequested") {
          payoutId = parsed.args[0] as bigint;
          amountHandle = parsed.args[2] as string;
          break;
        }
      } catch {
        // ignore logs from other contracts
      }
    }
    expect(payoutId, "PayoutRequested event missing").to.not.be.undefined;
    expect(amountHandle, "amount handle missing in event").to.not.be.undefined;
    progress(`payoutId=${payoutId}, amountHandle=${amountHandle}`);

    progress("Public-decrypting the clamped amount via the relayer SDK...");
    const r = await fhevm.publicDecrypt([amountHandle as string]);

    progress(`Cleartext clamped amount (should equal min(REQUEST, SALARY) = ${REQUEST}) = ${JSON.stringify(r.clearValues)}`);

    progress("Recording alice's ETH balance pre-settlement...");
    const ethBefore = await ethers.provider.getBalance(signers.alice.address);

    progress("Submitting settlePayout...");
    const settleTx = await contract
      .connect(signers.alice)
      .settlePayout(payoutId as bigint, r.abiEncodedClearValues, r.decryptionProof);
    const settleReceipt = await settleTx.wait();
    const gasCost = (settleReceipt!.gasUsed) * (settleTx.gasPrice ?? 0n);

    progress("Recording alice's ETH balance post-settlement...");
    const ethAfter = await ethers.provider.getBalance(signers.alice.address);

    progress(`ΔETH = ${ethAfter - ethBefore + gasCost} (should equal ${REQUEST})`);
    expect(ethAfter - ethBefore + gasCost).to.eq(REQUEST);

    progress("Verifying the pending payout is now marked settled...");
    const pending = await contract.getPendingPayout(payoutId as bigint);
    expect(pending.settled).to.eq(true);
    expect(pending.employee).to.eq(signers.alice.address);
  });
});

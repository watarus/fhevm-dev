import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";
import { ethers, fhevm } from "hardhat";

import { ConfidentialPayroll, ConfidentialPayroll__factory } from "../types";

type Signers = {
  owner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
  outsider: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("ConfidentialPayroll")) as ConfidentialPayroll__factory;
  const contract = (await factory.deploy()) as ConfidentialPayroll;
  const address = await contract.getAddress();
  return { contract, address };
}

describe("ConfidentialPayroll", function () {
  let signers: Signers;
  let contract: ConfidentialPayroll;
  let address: string;

  before(async function () {
    const all = await ethers.getSigners();
    signers = {
      owner: all[0],
      alice: all[1],
      bob: all[2],
      carol: all[3],
      outsider: all[4],
    };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      this.skip();
    }
    ({ contract, address } = await deployFixture());

    await contract.connect(signers.owner).addEmployee(signers.alice.address);
    await contract.connect(signers.owner).addEmployee(signers.bob.address);
    await contract.connect(signers.owner).addEmployee(signers.carol.address);
  });

  async function encryptedAmount(sender: HardhatEthersSigner, amount: bigint) {
    return fhevm.createEncryptedInput(address, sender.address).add64(amount).encrypt();
  }

  it("only the owner can credit salaries", async function () {
    const enc = await encryptedAmount(signers.outsider, 1000n);
    await expect(
      contract.connect(signers.outsider).creditSalary(signers.alice.address, enc.handles[0], enc.inputProof),
    ).to.be.revertedWithCustomError(contract, "NotOwner");
  });

  it("crediting a non-employee reverts", async function () {
    const enc = await encryptedAmount(signers.owner, 1000n);
    await expect(
      contract.connect(signers.owner).creditSalary(signers.outsider.address, enc.handles[0], enc.inputProof),
    ).to.be.revertedWithCustomError(contract, "NotEmployee");
  });

  it("credits salary so the employee and the owner can decrypt the balance, but a third party cannot", async function () {
    const enc = await encryptedAmount(signers.owner, 5_000n);
    await contract.connect(signers.owner).creditSalary(signers.alice.address, enc.handles[0], enc.inputProof);

    const aliceHandle = await contract.getSalary(signers.alice.address);
    expect(aliceHandle).to.not.eq(ethers.ZeroHash);

    const aliceClear = await fhevm.userDecryptEuint(FhevmType.euint64, aliceHandle, address, signers.alice);
    expect(aliceClear).to.eq(5_000n);

    const ownerClear = await fhevm.userDecryptEuint(FhevmType.euint64, aliceHandle, address, signers.owner);
    expect(ownerClear).to.eq(5_000n);

    // bob is allow-listed only for his own salary handle; this should fail.
    await expect(fhevm.userDecryptEuint(FhevmType.euint64, aliceHandle, address, signers.bob)).to.be.rejected;
  });

  it("aggregates the encrypted total payroll, decryptable by the owner only", async function () {
    for (const [emp, amt] of [
      [signers.alice, 5_000n],
      [signers.bob, 3_000n],
      [signers.carol, 7_000n],
    ] as const) {
      const enc = await encryptedAmount(signers.owner, amt);
      await contract.connect(signers.owner).creditSalary(emp.address, enc.handles[0], enc.inputProof);
    }

    const totalHandle = await contract.getTotalPayroll();
    const ownerSawTotal = await fhevm.userDecryptEuint(FhevmType.euint64, totalHandle, address, signers.owner);
    expect(ownerSawTotal).to.eq(15_000n);

    await expect(fhevm.userDecryptEuint(FhevmType.euint64, totalHandle, address, signers.alice)).to.be.rejected;
  });

  it("requestPayout clamps the requested amount via FHE.min so balance never underflows", async function () {
    const enc = await encryptedAmount(signers.owner, 5_000n);
    await contract.connect(signers.owner).creditSalary(signers.alice.address, enc.handles[0], enc.inputProof);

    // Alice asks for more than her balance — should clamp to 5_000.
    const aliceReq = await encryptedAmount(signers.alice, 9_000n);
    const tx = await contract.connect(signers.alice).requestPayout(aliceReq.handles[0], aliceReq.inputProof);
    const receipt = await tx.wait();
    expect(receipt!.status).to.eq(1);

    // Balance after the clamp must be 0, not (-4_000).
    const balanceHandle = await contract.getSalary(signers.alice.address);
    const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balanceHandle, address, signers.alice);
    expect(aliceBalance).to.eq(0n);

    // Total payroll must drop by 5_000 (the clamped amount), not 9_000.
    const totalHandle = await contract.getTotalPayroll();
    const total = await fhevm.userDecryptEuint(FhevmType.euint64, totalHandle, address, signers.owner);
    expect(total).to.eq(0n);
  });

  it("emits PayoutRequested with a publicly-decryptable amount handle", async function () {
    const credit = await encryptedAmount(signers.owner, 4_000n);
    await contract.connect(signers.owner).creditSalary(signers.alice.address, credit.handles[0], credit.inputProof);

    const req = await encryptedAmount(signers.alice, 1_500n);
    const tx = await contract.connect(signers.alice).requestPayout(req.handles[0], req.inputProof);
    const receipt = await tx.wait();
    const event = receipt!.logs
      .map((log) => {
        try {
          return contract.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "PayoutRequested");
    expect(event).to.not.be.null;
    const handle = event!.args[2] as string;
    expect(handle).to.not.eq(ethers.ZeroHash);

    // The pending payout slot must record the right employee and not be settled.
    const pending = await contract.getPendingPayout(0);
    expect(pending.employee).to.eq(signers.alice.address);
    expect(pending.settled).to.eq(false);

    // Balance after withdrawal request must be 4_000 - 1_500 = 2_500.
    const balanceHandle = await contract.getSalary(signers.alice.address);
    const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balanceHandle, address, signers.alice);
    expect(aliceBalance).to.eq(2_500n);
  });
});

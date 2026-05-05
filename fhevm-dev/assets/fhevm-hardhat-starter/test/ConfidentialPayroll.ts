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
        } catch (err) {
          // parseLog throws on logs from contracts other than this one — that
          // is expected. Anything else is a real ABI mismatch and should bubble.
          if (err instanceof Error && /no matching event|unknown topic/i.test(err.message)) {
            return null;
          }
          throw err;
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

  // ─── Authorization / revert path coverage ─────────────────────────────

  it("addEmployee(0x0) reverts NotEmployee", async function () {
    await expect(contract.connect(signers.owner).addEmployee(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      contract,
      "NotEmployee",
    );
  });

  it("addEmployee twice for the same address reverts AlreadyEmployee", async function () {
    await expect(contract.connect(signers.owner).addEmployee(signers.alice.address)).to.be.revertedWithCustomError(
      contract,
      "AlreadyEmployee",
    );
  });

  it("removeEmployee of a non-employee reverts NotEmployee", async function () {
    await expect(contract.connect(signers.owner).removeEmployee(signers.outsider.address)).to.be.revertedWithCustomError(
      contract,
      "NotEmployee",
    );
  });

  it("only the owner can add or remove employees", async function () {
    await expect(
      contract.connect(signers.alice).addEmployee(signers.outsider.address),
    ).to.be.revertedWithCustomError(contract, "NotOwner");
    await expect(contract.connect(signers.alice).removeEmployee(signers.bob.address)).to.be.revertedWithCustomError(
      contract,
      "NotOwner",
    );
  });

  it("requestPayout from a non-employee reverts NotEmployee", async function () {
    const enc = await encryptedAmount(signers.outsider, 100n);
    await expect(
      contract.connect(signers.outsider).requestPayout(enc.handles[0], enc.inputProof),
    ).to.be.revertedWithCustomError(contract, "NotEmployee");
  });

  it("requestPayout from a removed employee reverts even if their balance was non-zero", async function () {
    const credit = await encryptedAmount(signers.owner, 5_000n);
    await contract.connect(signers.owner).creditSalary(signers.alice.address, credit.handles[0], credit.inputProof);
    await contract.connect(signers.owner).removeEmployee(signers.alice.address);
    const req = await encryptedAmount(signers.alice, 1_000n);
    await expect(contract.connect(signers.alice).requestPayout(req.handles[0], req.inputProof)).to.be.revertedWithCustomError(
      contract,
      "NotEmployee",
    );
  });

  it("re-adding a removed employee does not create a duplicate _employees[] entry (swap-and-pop fix)", async function () {
    // Starting state: alice + bob + carol added in beforeEach => count == 3.
    expect(await contract.employeeCount()).to.eq(3n);

    await contract.connect(signers.owner).removeEmployee(signers.alice.address);
    expect(await contract.employeeCount()).to.eq(2n);

    await contract.connect(signers.owner).addEmployee(signers.alice.address);
    expect(await contract.employeeCount()).to.eq(3n);

    // Confirm no duplicate — every address appears at most once.
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const addr = await contract.employeeAt(i);
      expect(seen.has(addr.toLowerCase())).to.eq(false);
      seen.add(addr.toLowerCase());
    }
  });

  // ─── Settlement revert paths (cleartext + proof not produced; we only
  //     exercise the cheap reverts) ──────────────────────────────────────

  it("settlePayout for an unknown payoutId reverts UnknownPayout", async function () {
    await expect(
      contract.connect(signers.alice).settlePayout(999, "0x", "0x"),
    ).to.be.revertedWithCustomError(contract, "UnknownPayout");
  });

  it("settlePayout from a different employee reverts PayoutSenderMismatch", async function () {
    const credit = await encryptedAmount(signers.owner, 1_000n);
    await contract.connect(signers.owner).creditSalary(signers.alice.address, credit.handles[0], credit.inputProof);
    const req = await encryptedAmount(signers.alice, 500n);
    await contract.connect(signers.alice).requestPayout(req.handles[0], req.inputProof);

    await expect(
      contract.connect(signers.bob).settlePayout(0, "0x", "0x"),
    ).to.be.revertedWithCustomError(contract, "PayoutSenderMismatch");
  });

  // ─── State invariants ──────────────────────────────────────────────────

  it("preserves sum(balances) == totalPayroll across mixed credit/payout activity", async function () {
    for (const [emp, amt] of [
      [signers.alice, 5_000n],
      [signers.bob, 3_000n],
      [signers.carol, 7_000n],
    ] as const) {
      const enc = await encryptedAmount(signers.owner, amt);
      await contract.connect(signers.owner).creditSalary(emp.address, enc.handles[0], enc.inputProof);
    }

    // Alice partial withdrawal.
    const aliceReq = await encryptedAmount(signers.alice, 2_000n);
    await contract.connect(signers.alice).requestPayout(aliceReq.handles[0], aliceReq.inputProof);

    // Top-up bob.
    const bobTop = await encryptedAmount(signers.owner, 1_000n);
    await contract.connect(signers.owner).creditSalary(signers.bob.address, bobTop.handles[0], bobTop.inputProof);

    const aliceBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await contract.getSalary(signers.alice.address),
      address,
      signers.alice,
    );
    const bobBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await contract.getSalary(signers.bob.address),
      address,
      signers.bob,
    );
    const carolBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await contract.getSalary(signers.carol.address),
      address,
      signers.carol,
    );
    const totalDecoded = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await contract.getTotalPayroll(),
      address,
      signers.owner,
    );

    expect(aliceBalance + bobBalance + carolBalance).to.eq(totalDecoded);
    expect(totalDecoded).to.eq(5_000n + 3_000n + 7_000n - 2_000n + 1_000n); // 14_000
  });

  it("requestPayout on a never-credited employee does not revert and clamps to zero (uninitialized handle path)", async function () {
    // Alice was added in beforeEach but never credited. _totalPayroll is also
    // uninitialized at this point. The contract must guard both handles.
    const req = await encryptedAmount(signers.alice, 1_000n);
    const tx = await contract.connect(signers.alice).requestPayout(req.handles[0], req.inputProof);
    const receipt = await tx.wait();
    expect(receipt!.status).to.eq(1);

    const balanceHandle = await contract.getSalary(signers.alice.address);
    const aliceBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balanceHandle, address, signers.alice);
    expect(aliceBalance).to.eq(0n);

    const totalHandle = await contract.getTotalPayroll();
    const total = await fhevm.userDecryptEuint(FhevmType.euint64, totalHandle, address, signers.owner);
    expect(total).to.eq(0n);
  });
});

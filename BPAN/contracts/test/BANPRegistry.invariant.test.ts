import { expect } from "chai";
import { ethers } from "hardhat";
import { BANPRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Focused suite for the "one BPAN per address" invariant (security review #5).
// Self-contained: deploys with a fee within MAX_REGISTRATION_FEE so it runs
// independently of the older V1 test file (which is stale against V2).
describe("BANPRegistry — one-number-per-address invariant", function () {
  let registry: BANPRegistry;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const FEE = 0n; // free registration keeps these tests focused on the invariant
  const NUM_A = 48290173462n;
  const NUM_B = 55555555555n;

  beforeEach(async function () {
    [, user1, user2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BANPRegistry");
    registry = await Factory.deploy(FEE);
    await registry.waitForDeployment();
  });

  it("reverts when the same address registers a second number", async function () {
    await registry.connect(user1).registerNumber(NUM_A, { value: FEE });
    await expect(
      registry.connect(user1).registerNumber(NUM_B, { value: FEE })
    ).to.be.revertedWithCustomError(registry, "AlreadyOwnsNumber");
  });

  it("reverts when transferring a BPAN to an address that already owns one", async function () {
    await registry.connect(user1).registerNumber(NUM_A, { value: FEE });
    await registry.connect(user2).registerNumber(NUM_B, { value: FEE });

    // user1 tries to push their BPAN onto user2, who already holds one
    await expect(
      registry.connect(user1).transferFrom(user1.address, user2.address, NUM_A)
    ).to.be.revertedWithCustomError(registry, "AlreadyOwnsNumber");

    // Ownership unchanged after the revert
    expect(await registry.ownerOf(NUM_A)).to.equal(user1.address);
    expect(await registry.balanceOf(user2.address)).to.equal(1);
  });

  it("allows transferring a BPAN to an address that owns none", async function () {
    await registry.connect(user1).registerNumber(NUM_A, { value: FEE });

    await registry.connect(user1).transferFrom(user1.address, user2.address, NUM_A);

    expect(await registry.ownerOf(NUM_A)).to.equal(user2.address);
    expect(await registry.balanceOf(user1.address)).to.equal(0);
    expect(await registry.balanceOf(user2.address)).to.equal(1);
  });

  it("still clears the previous owner's mappings on a successful transfer", async function () {
    await registry.connect(user1).registerNumber(NUM_A, { value: FEE });
    await registry.connect(user1).setWalletMapping(NUM_A, "ethereum", "0xETH");
    await registry.connect(user1).setWalletMapping(NUM_A, "solana", "SOL_ADDR");

    await expect(
      registry.connect(user1).transferFrom(user1.address, user2.address, NUM_A)
    )
      .to.emit(registry, "AllMappingsCleared")
      .withArgs(NUM_A, user1.address, user2.address);

    expect(await registry.getWalletMapping(NUM_A, "ethereum")).to.equal("");
    expect(await registry.getWalletMapping(NUM_A, "solana")).to.equal("");
    expect(await registry.getChains(NUM_A)).to.have.lengthOf(0);
  });
});

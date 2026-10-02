import { expect } from "chai";
import { ethers } from "hardhat";
import { BANPRegistryV3 } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

// Suite for the ready-to-deploy V3 registry. V3 is NOT yet deployed; these
// tests pin the two behaviour changes over the live V2 contract:
//   1. multi-BPAN-per-owner (the one-per-address restriction is removed), and
//   2. a hardened migrateFromV1 (per-id range check + per-record length revert).
describe("BANPRegistryV3", function () {
  let registry: BANPRegistryV3;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;

  const FEE = 0n;
  const NUM_A = 48290173462n;
  const NUM_B = 55555555555n;
  const NUM_C = 12345678901n;

  beforeEach(async function () {
    [owner, user1, user2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("BANPRegistryV3");
    registry = await Factory.deploy(FEE);
    await registry.waitForDeployment();
  });

  // ── Multi-BPAN per owner (#5) ───────────────────────────────────────────────
  describe("multi-BPAN per owner", function () {
    it("lets the same address register more than one number", async function () {
      await registry.connect(user1).registerNumber(NUM_A, { value: FEE });
      await registry.connect(user1).registerNumber(NUM_B, { value: FEE });

      expect(await registry.balanceOf(user1.address)).to.equal(2);
      expect(await registry.ownerOf(NUM_A)).to.equal(user1.address);
      expect(await registry.ownerOf(NUM_B)).to.equal(user1.address);
    });

    it("lets an address receive a transfer even if it already owns a BPAN", async function () {
      await registry.connect(user1).registerNumber(NUM_A, { value: FEE });
      await registry.connect(user2).registerNumber(NUM_B, { value: FEE });

      await registry.connect(user1).transferFrom(user1.address, user2.address, NUM_A);

      expect(await registry.ownerOf(NUM_A)).to.equal(user2.address);
      expect(await registry.balanceOf(user2.address)).to.equal(2);
    });

    it("still rejects registering an already-registered number", async function () {
      await registry.connect(user1).registerNumber(NUM_A, { value: FEE });
      await expect(
        registry.connect(user2).registerNumber(NUM_A, { value: FEE })
      ).to.be.revertedWithCustomError(registry, "NumberAlreadyRegistered");
    });

    it("still clears the previous owner's mappings on transfer", async function () {
      await registry.connect(user1).registerNumber(NUM_A, { value: FEE });
      await registry.connect(user1).setWalletMapping(NUM_A, "ethereum", "0xETH");
      await registry.connect(user1).setWalletMapping(NUM_A, "solana", "SOL_ADDR");

      await expect(
        registry.connect(user1).transferFrom(user1.address, user2.address, NUM_A)
      )
        .to.emit(registry, "AllMappingsCleared")
        .withArgs(NUM_A, user1.address, user2.address);

      expect(await registry.getWalletMapping(NUM_A, "ethereum")).to.equal("");
      expect(await registry.getChains(NUM_A)).to.have.lengthOf(0);
    });
  });

  // ── Hardened migrateFromV1 ──────────────────────────────────────────────────
  describe("migrateFromV1 hardening", function () {
    it("migrates a record with its mappings", async function () {
      await registry.migrateFromV1(
        [NUM_A],
        [user1.address],
        [["ethereum", "solana"]],
        [["0xETH", "SOL_ADDR"]]
      );
      expect(await registry.ownerOf(NUM_A)).to.equal(user1.address);
      expect(await registry.getWalletMapping(NUM_A, "ethereum")).to.equal("0xETH");
      expect(await registry.getWalletMapping(NUM_A, "solana")).to.equal("SOL_ADDR");
    });

    it("reverts (CONTRACT-5.1) when a migrated id is out of range", async function () {
      await expect(
        registry.migrateFromV1([9_999_999_999n], [user1.address], [[]], [[]])
      ).to.be.revertedWithCustomError(registry, "InvalidNumber");
    });

    it("reverts (CONTRACT-5.2) when a record's chains/wallets lengths differ", async function () {
      await expect(
        registry.migrateFromV1(
          [NUM_A],
          [user1.address],
          [["ethereum", "solana"]],
          [["0xETH"]] // one wallet for two chains
        )
      ).to.be.revertedWithCustomError(registry, "MigrationLengthMismatch");
    });

    it("reverts on a top-level array length mismatch", async function () {
      await expect(
        registry.migrateFromV1([NUM_A, NUM_B], [user1.address], [[]], [[]])
      ).to.be.revertedWithCustomError(registry, "MigrationLengthMismatch");
    });

    it("is idempotent: re-running skips numbers already present", async function () {
      await registry.migrateFromV1([NUM_C], [user1.address], [["ethereum"]], [["0xETH"]]);
      // Second run with a different owner must NOT overwrite ownership.
      await registry.migrateFromV1([NUM_C], [user2.address], [["ethereum"]], [["0xNEW"]]);
      expect(await registry.ownerOf(NUM_C)).to.equal(user1.address);
      expect(await registry.getWalletMapping(NUM_C, "ethereum")).to.equal("0xETH");
    });

    it("enforces MAX_CHAIN_MAPPINGS during migration", async function () {
      const chains: string[] = [];
      const wallets: string[] = [];
      for (let i = 0; i < 51; i++) { chains.push(`chain${i}`); wallets.push(`w${i}`); }
      await expect(
        registry.migrateFromV1([NUM_A], [user1.address], [chains], [wallets])
      ).to.be.revertedWithCustomError(registry, "TooManyChainMappings");
    });

    it("only the owner can migrate", async function () {
      await expect(
        registry.connect(user1).migrateFromV1([NUM_A], [user1.address], [[]], [[]])
      ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
    });

    it("closeMigration permanently disables migration", async function () {
      await expect(registry.closeMigration()).to.emit(registry, "MigrationWindowClosed");
      expect(await registry.migrationOpen()).to.equal(false);
      await expect(
        registry.migrateFromV1([NUM_A], [user1.address], [[]], [[]])
      ).to.be.revertedWithCustomError(registry, "MigrationAlreadyClosed");
    });
  });
});

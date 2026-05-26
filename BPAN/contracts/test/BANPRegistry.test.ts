import { expect } from "chai";
import { ethers } from "hardhat";
import { BANPRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("BANPRegistry", function () {
  let registry: BANPRegistry;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  const REGISTRATION_FEE = ethers.parseEther("0.01");
  const VALID_NUMBER = 48290173462n;
  const VALID_NUMBER_2 = 10000000000n; // smallest valid
  const VALID_NUMBER_3 = 99999999999n; // largest valid
  const VALID_NUMBER_4 = 55555555555n;
  const INVALID_NUMBER_ZERO = 0n;
  const INVALID_NUMBER_ONE = 1n;
  const INVALID_NUMBER_LOW = 9999999999n; // 10 digits
  const INVALID_NUMBER_HIGH = 100000000000n; // 12 digits

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();
    const BANPRegistry = await ethers.getContractFactory("BANPRegistry");
    registry = await BANPRegistry.deploy(REGISTRATION_FEE);
    await registry.waitForDeployment();
  });

  // ═══════════════════════════════════════════════
  //  DEPLOYMENT
  // ═══════════════════════════════════════════════

  describe("Deployment", function () {
    it("should set the correct name and symbol", async function () {
      expect(await registry.name()).to.equal("Blockchain Account Number");
      expect(await registry.symbol()).to.equal("BANP");
    });

    it("should set the deployer as owner", async function () {
      expect(await registry.owner()).to.equal(owner.address);
    });

    it("should set the initial registration fee", async function () {
      expect(await registry.registrationFee()).to.equal(REGISTRATION_FEE);
    });

    it("should start with zero total registered", async function () {
      expect(await registry.totalRegistered()).to.equal(0);
    });

    it("should deploy with zero registration fee", async function () {
      const BANPRegistry = await ethers.getContractFactory("BANPRegistry");
      const freeRegistry = await BANPRegistry.deploy(0);
      await freeRegistry.waitForDeployment();
      expect(await freeRegistry.registrationFee()).to.equal(0);
    });
  });

  // ═══════════════════════════════════════════════
  //  REGISTRATION
  // ═══════════════════════════════════════════════

  describe("registerNumber", function () {
    it("should register a valid 11-digit number and mint NFT", async function () {
      await expect(
        registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE })
      )
        .to.emit(registry, "NumberRegistered")
        .withArgs(VALID_NUMBER, user1.address);

      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user1.address);
      expect(await registry.totalRegistered()).to.equal(1);
      expect(await registry.balanceOf(user1.address)).to.equal(1);
    });

    it("should register the smallest valid number (10000000000)", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });
      expect(await registry.ownerOf(VALID_NUMBER_2)).to.equal(user1.address);
    });

    it("should register the largest valid number (99999999999)", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER_3, { value: REGISTRATION_FEE });
      expect(await registry.ownerOf(VALID_NUMBER_3)).to.equal(user1.address);
    });

    it("should allow multiple users to register different numbers", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await registry.connect(user2).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });
      await registry.connect(user3).registerNumber(VALID_NUMBER_3, { value: REGISTRATION_FEE });

      expect(await registry.totalRegistered()).to.equal(3);
      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user1.address);
      expect(await registry.ownerOf(VALID_NUMBER_2)).to.equal(user2.address);
      expect(await registry.ownerOf(VALID_NUMBER_3)).to.equal(user3.address);
    });

    it("should allow one user to register multiple numbers", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await registry.connect(user1).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });

      expect(await registry.balanceOf(user1.address)).to.equal(2);
      expect(await registry.totalRegistered()).to.equal(2);
    });

    it("should accept overpayment without reverting", async function () {
      const overFee = ethers.parseEther("1.0");
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: overFee });
      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user1.address);
    });

    it("should accept exact fee", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user1.address);
    });

    it("should succeed with zero fee when fee is set to 0", async function () {
      const BANPRegistry = await ethers.getContractFactory("BANPRegistry");
      const freeRegistry = await BANPRegistry.deploy(0);
      await freeRegistry.waitForDeployment();

      await freeRegistry.connect(user1).registerNumber(VALID_NUMBER);
      expect(await freeRegistry.ownerOf(VALID_NUMBER)).to.equal(user1.address);
    });

    it("should accumulate contract balance from fees", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await registry.connect(user2).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });

      const contractBalance = await ethers.provider.getBalance(await registry.getAddress());
      expect(contractBalance).to.equal(REGISTRATION_FEE * 2n);
    });

    // --- Revert cases ---

    it("should revert for number 0", async function () {
      await expect(
        registry.connect(user1).registerNumber(INVALID_NUMBER_ZERO, { value: REGISTRATION_FEE })
      ).to.be.revertedWithCustomError(registry, "InvalidNumber");
    });

    it("should revert for number 1", async function () {
      await expect(
        registry.connect(user1).registerNumber(INVALID_NUMBER_ONE, { value: REGISTRATION_FEE })
      ).to.be.revertedWithCustomError(registry, "InvalidNumber");
    });

    it("should revert for a 10-digit number (9999999999)", async function () {
      await expect(
        registry.connect(user1).registerNumber(INVALID_NUMBER_LOW, { value: REGISTRATION_FEE })
      ).to.be.revertedWithCustomError(registry, "InvalidNumber");
    });

    it("should revert for a 12-digit number (100000000000)", async function () {
      await expect(
        registry.connect(user1).registerNumber(INVALID_NUMBER_HIGH, { value: REGISTRATION_FEE })
      ).to.be.revertedWithCustomError(registry, "InvalidNumber");
    });

    it("should revert if the number is already registered", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await expect(
        registry.connect(user2).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE })
      ).to.be.revertedWithCustomError(registry, "NumberAlreadyRegistered");
    });

    it("should revert if the same user tries to register the same number twice", async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await expect(
        registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE })
      ).to.be.revertedWithCustomError(registry, "NumberAlreadyRegistered");
    });

    it("should revert if insufficient fee is sent", async function () {
      const lowFee = ethers.parseEther("0.005");
      await expect(
        registry.connect(user1).registerNumber(VALID_NUMBER, { value: lowFee })
      ).to.be.revertedWithCustomError(registry, "InsufficientFee");
    });

    it("should revert if zero value sent when fee is non-zero", async function () {
      await expect(
        registry.connect(user1).registerNumber(VALID_NUMBER, { value: 0 })
      ).to.be.revertedWithCustomError(registry, "InsufficientFee");
    });
  });

  // ═══════════════════════════════════════════════
  //  SET WALLET MAPPING
  // ═══════════════════════════════════════════════

  describe("setWalletMapping", function () {
    beforeEach(async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
    });

    it("should set a wallet mapping for a chain and emit event", async function () {
      const ethWallet = "0x92A1b2F3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9";
      await expect(
        registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", ethWallet)
      )
        .to.emit(registry, "WalletMappingSet")
        .withArgs(VALID_NUMBER, "ethereum", ethWallet);

      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal(ethWallet);
    });

    it("should set mappings for multiple chains", async function () {
      const ethWallet = "0x92A1b2F3c4D5e6F7a8B9c0D1e2F3a4B5c6D7e8F9";
      const solWallet = "6HJ2kXfgBm9RqpVw3NzTyDMAjQ8eLsphZfKUik1P3v5M";
      const suiWallet = "0xF8A9b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9";
      const btcWallet = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
      const aptosWallet = "0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";

      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", ethWallet);
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "solana", solWallet);
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "sui", suiWallet);
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "bitcoin", btcWallet);
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "aptos", aptosWallet);

      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal(ethWallet);
      expect(await registry.getWalletMapping(VALID_NUMBER, "solana")).to.equal(solWallet);
      expect(await registry.getWalletMapping(VALID_NUMBER, "sui")).to.equal(suiWallet);
      expect(await registry.getWalletMapping(VALID_NUMBER, "bitcoin")).to.equal(btcWallet);
      expect(await registry.getWalletMapping(VALID_NUMBER, "aptos")).to.equal(aptosWallet);

      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(5);
    });

    it("should overwrite an existing mapping without duplicating the chain key", async function () {
      const oldWallet = "0xOLD_WALLET";
      const newWallet = "0xNEW_WALLET";

      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", oldWallet);
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", newWallet);

      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal(newWallet);
      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(1);
      expect(chains[0]).to.equal("ethereum");
    });

    it("should handle chains with special characters in name", async function () {
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "polygon-zkevm", "0xPOLY");
      expect(await registry.getWalletMapping(VALID_NUMBER, "polygon-zkevm")).to.equal("0xPOLY");
    });

    it("should handle very long wallet addresses", async function () {
      const longAddr = "0x" + "a".repeat(200);
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", longAddr);
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal(longAddr);
    });

    // --- Revert cases ---

    it("should revert if caller is not the number owner", async function () {
      await expect(
        registry.connect(user2).setWalletMapping(VALID_NUMBER, "ethereum", "0xABC")
      ).to.be.revertedWithCustomError(registry, "NotNumberOwner");
    });

    it("should revert if chain name is empty", async function () {
      await expect(
        registry.connect(user1).setWalletMapping(VALID_NUMBER, "", "0xABC")
      ).to.be.revertedWithCustomError(registry, "EmptyChainName");
    });

    it("should revert if wallet address is empty", async function () {
      await expect(
        registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "")
      ).to.be.revertedWithCustomError(registry, "EmptyWalletAddress");
    });
  });

  // ═══════════════════════════════════════════════
  //  REMOVE WALLET MAPPING
  // ═══════════════════════════════════════════════

  describe("removeWalletMapping", function () {
    beforeEach(async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xETH");
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "solana", "SOL_ADDR");
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "sui", "0xSUI");
    });

    it("should remove a mapping and emit event", async function () {
      await expect(
        registry.connect(user1).removeWalletMapping(VALID_NUMBER, "solana")
      )
        .to.emit(registry, "WalletMappingRemoved")
        .withArgs(VALID_NUMBER, "solana");

      expect(await registry.getWalletMapping(VALID_NUMBER, "solana")).to.equal("");
      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(2);
    });

    it("should remove the first element correctly (swap-and-pop)", async function () {
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "ethereum");

      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(2);
      // After removing the first element, the last element swaps in
      expect(chains).to.include("solana");
      expect(chains).to.include("sui");
      expect(chains).to.not.include("ethereum");

      // Remaining mappings should still resolve correctly
      expect(await registry.getWalletMapping(VALID_NUMBER, "solana")).to.equal("SOL_ADDR");
      expect(await registry.getWalletMapping(VALID_NUMBER, "sui")).to.equal("0xSUI");
    });

    it("should remove the last element correctly", async function () {
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "sui");

      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(2);
      expect(chains).to.deep.equal(["ethereum", "solana"]);
    });

    it("should remove the middle element correctly", async function () {
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "solana");

      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(2);
      expect(chains).to.include("ethereum");
      expect(chains).to.include("sui");
    });

    it("should allow removing all mappings one by one", async function () {
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "ethereum");
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "solana");
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "sui");

      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(0);
    });

    it("should allow re-adding a mapping after removal", async function () {
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "solana");
      expect(await registry.getWalletMapping(VALID_NUMBER, "solana")).to.equal("");

      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "solana", "NEW_SOL_ADDR");
      expect(await registry.getWalletMapping(VALID_NUMBER, "solana")).to.equal("NEW_SOL_ADDR");

      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(3);
    });

    it("should handle remove → re-add → remove cycle correctly", async function () {
      // Remove
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "ethereum");
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("");

      // Re-add
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xETH_V2");
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("0xETH_V2");

      // Remove again
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "ethereum");
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("");

      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(2);
      expect(chains).to.not.include("ethereum");
    });

    // --- Revert cases ---

    it("should revert when removing a non-existent mapping", async function () {
      await expect(
        registry.connect(user1).removeWalletMapping(VALID_NUMBER, "bitcoin")
      ).to.be.revertedWithCustomError(registry, "MappingNotFound");
    });

    it("should revert when removing an already-removed mapping", async function () {
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "solana");
      await expect(
        registry.connect(user1).removeWalletMapping(VALID_NUMBER, "solana")
      ).to.be.revertedWithCustomError(registry, "MappingNotFound");
    });

    it("should revert if caller is not the number owner", async function () {
      await expect(
        registry.connect(user2).removeWalletMapping(VALID_NUMBER, "ethereum")
      ).to.be.revertedWithCustomError(registry, "NotNumberOwner");
    });
  });

  // ═══════════════════════════════════════════════
  //  VIEW / QUERY FUNCTIONS
  // ═══════════════════════════════════════════════

  describe("Query functions", function () {
    beforeEach(async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xETH");
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "solana", "SOL_ADDR");
    });

    describe("getWalletMapping", function () {
      it("should return the correct wallet for a mapped chain", async function () {
        expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("0xETH");
      });

      it("should return empty string for an unmapped chain", async function () {
        expect(await registry.getWalletMapping(VALID_NUMBER, "bitcoin")).to.equal("");
      });

      it("should return empty string for an unregistered number", async function () {
        expect(await registry.getWalletMapping(VALID_NUMBER_4, "ethereum")).to.equal("");
      });
    });

    describe("getChains", function () {
      it("should return all mapped chain keys in insertion order", async function () {
        const chains = await registry.getChains(VALID_NUMBER);
        expect(chains).to.deep.equal(["ethereum", "solana"]);
      });

      it("should return empty array for an account with no mappings", async function () {
        await registry.connect(user2).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });
        const chains = await registry.getChains(VALID_NUMBER_2);
        expect(chains).to.have.lengthOf(0);
      });

      it("should return empty array for an unregistered number", async function () {
        const chains = await registry.getChains(VALID_NUMBER_4);
        expect(chains).to.have.lengthOf(0);
      });
    });

    describe("getAllMappings", function () {
      it("should return parallel arrays of chains and wallets", async function () {
        const [chains, wallets] = await registry.getAllMappings(VALID_NUMBER);
        expect(chains).to.deep.equal(["ethereum", "solana"]);
        expect(wallets).to.deep.equal(["0xETH", "SOL_ADDR"]);
      });

      it("should return empty arrays for number with no mappings", async function () {
        await registry.connect(user2).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });
        const [chains, wallets] = await registry.getAllMappings(VALID_NUMBER_2);
        expect(chains).to.have.lengthOf(0);
        expect(wallets).to.have.lengthOf(0);
      });

      it("should reflect updates after mapping changes", async function () {
        await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xETH_V2");
        const [chains, wallets] = await registry.getAllMappings(VALID_NUMBER);
        expect(chains).to.deep.equal(["ethereum", "solana"]);
        expect(wallets).to.deep.equal(["0xETH_V2", "SOL_ADDR"]);
      });
    });

    describe("isRegistered", function () {
      it("should return true for a registered number", async function () {
        expect(await registry.isRegistered(VALID_NUMBER)).to.be.true;
      });

      it("should return false for an unregistered number", async function () {
        expect(await registry.isRegistered(11111111111n)).to.be.false;
      });

      it("should return false for the boundary valid numbers if not registered", async function () {
        expect(await registry.isRegistered(VALID_NUMBER_2)).to.be.false;
        expect(await registry.isRegistered(VALID_NUMBER_3)).to.be.false;
      });
    });
  });

  // ═══════════════════════════════════════════════
  //  ERC-721 TRANSFERS
  // ═══════════════════════════════════════════════

  describe("NFT Transfer", function () {
    beforeEach(async function () {
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xETH");
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "solana", "SOL_ADDR");
    });

    it("should transfer ownership via transferFrom", async function () {
      await registry
        .connect(user1)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user2.address);
      expect(await registry.balanceOf(user1.address)).to.equal(0);
      expect(await registry.balanceOf(user2.address)).to.equal(1);
    });

    it("new owner can update mappings after transfer", async function () {
      await registry
        .connect(user1)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      await registry.connect(user2).setWalletMapping(VALID_NUMBER, "ethereum", "0xNEW");
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("0xNEW");
    });

    it("new owner can add new chain mappings after transfer", async function () {
      await registry
        .connect(user1)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      await registry.connect(user2).setWalletMapping(VALID_NUMBER, "sui", "0xSUI_NEW");
      expect(await registry.getWalletMapping(VALID_NUMBER, "sui")).to.equal("0xSUI_NEW");
      const chains = await registry.getChains(VALID_NUMBER);
      expect(chains).to.have.lengthOf(3);
    });

    it("new owner can remove existing mappings after transfer", async function () {
      await registry
        .connect(user1)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      await registry.connect(user2).removeWalletMapping(VALID_NUMBER, "ethereum");
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("");
    });

    it("previous owner cannot update mappings after transfer", async function () {
      await registry
        .connect(user1)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      await expect(
        registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xHACK")
      ).to.be.revertedWithCustomError(registry, "NotNumberOwner");
    });

    it("previous owner cannot remove mappings after transfer", async function () {
      await registry
        .connect(user1)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      await expect(
        registry.connect(user1).removeWalletMapping(VALID_NUMBER, "ethereum")
      ).to.be.revertedWithCustomError(registry, "NotNumberOwner");
    });

    it("existing wallet mappings persist after transfer", async function () {
      await registry
        .connect(user1)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      // Mappings set by previous owner should still be readable
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("0xETH");
      expect(await registry.getWalletMapping(VALID_NUMBER, "solana")).to.equal("SOL_ADDR");
    });

    it("should support safeTransferFrom", async function () {
      await registry
        .connect(user1)
        ["safeTransferFrom(address,address,uint256)"](
          user1.address,
          user2.address,
          VALID_NUMBER
        );

      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user2.address);
    });

    it("should support approve + transferFrom flow", async function () {
      await registry.connect(user1).approve(user2.address, VALID_NUMBER);
      await registry
        .connect(user2)
        .transferFrom(user1.address, user2.address, VALID_NUMBER);

      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user2.address);
    });
  });

  // ═══════════════════════════════════════════════
  //  ADMIN FUNCTIONS
  // ═══════════════════════════════════════════════

  describe("Admin functions", function () {
    describe("setRegistrationFee", function () {
      it("owner can update the registration fee", async function () {
        const newFee = ethers.parseEther("0.05");
        await expect(registry.connect(owner).setRegistrationFee(newFee))
          .to.emit(registry, "RegistrationFeeUpdated")
          .withArgs(REGISTRATION_FEE, newFee);

        expect(await registry.registrationFee()).to.equal(newFee);
      });

      it("new fee applies to subsequent registrations", async function () {
        const newFee = ethers.parseEther("0.05");
        await registry.connect(owner).setRegistrationFee(newFee);

        // Old fee should fail
        await expect(
          registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE })
        ).to.be.revertedWithCustomError(registry, "InsufficientFee");

        // New fee should succeed
        await registry.connect(user1).registerNumber(VALID_NUMBER, { value: newFee });
        expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user1.address);
      });

      it("owner can set fee to zero", async function () {
        await registry.connect(owner).setRegistrationFee(0);
        expect(await registry.registrationFee()).to.equal(0);

        // Should register without sending value
        await registry.connect(user1).registerNumber(VALID_NUMBER);
        expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user1.address);
      });

      it("non-owner cannot update the registration fee", async function () {
        await expect(
          registry.connect(user1).setRegistrationFee(0)
        ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      });
    });

    describe("withdrawFees", function () {
      it("owner can withdraw accumulated fees", async function () {
        await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
        await registry.connect(user2).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });

        const totalFees = REGISTRATION_FEE * 2n;
        const balanceBefore = await ethers.provider.getBalance(owner.address);
        const tx = await registry.connect(owner).withdrawFees(owner.address);
        const receipt = await tx.wait();
        const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
        const balanceAfter = await ethers.provider.getBalance(owner.address);

        expect(balanceAfter + gasUsed - balanceBefore).to.equal(totalFees);
      });

      it("owner can withdraw to a different address", async function () {
        await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });

        const balanceBefore = await ethers.provider.getBalance(user3.address);
        await registry.connect(owner).withdrawFees(user3.address);
        const balanceAfter = await ethers.provider.getBalance(user3.address);

        expect(balanceAfter - balanceBefore).to.equal(REGISTRATION_FEE);
      });

      it("withdraw with zero balance should succeed (sends 0)", async function () {
        // No registrations, balance is 0 — should not revert
        await registry.connect(owner).withdrawFees(owner.address);
      });

      it("non-owner cannot withdraw fees", async function () {
        await expect(
          registry.connect(user1).withdrawFees(user1.address)
        ).to.be.revertedWithCustomError(registry, "OwnableUnauthorizedAccount");
      });
    });
  });

  // ═══════════════════════════════════════════════
  //  CONSTANTS
  // ═══════════════════════════════════════════════

  describe("Constants", function () {
    it("MIN_NUMBER is 10000000000", async function () {
      expect(await registry.MIN_NUMBER()).to.equal(10_000_000_000n);
    });

    it("MAX_NUMBER is 99999999999", async function () {
      expect(await registry.MAX_NUMBER()).to.equal(99_999_999_999n);
    });
  });

  // ═══════════════════════════════════════════════
  //  END-TO-END SCENARIOS
  // ═══════════════════════════════════════════════

  describe("End-to-end scenarios", function () {
    it("full lifecycle: register → map → resolve → update → remove → transfer", async function () {
      // 1. Register
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      expect(await registry.isRegistered(VALID_NUMBER)).to.be.true;

      // 2. Map wallets
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xETH_ORIG");
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "solana", "SOL_ORIG");

      // 3. Resolve
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("0xETH_ORIG");
      const [chains, wallets] = await registry.getAllMappings(VALID_NUMBER);
      expect(chains).to.have.lengthOf(2);

      // 4. Update
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xETH_V2");
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("0xETH_V2");

      // 5. Remove one
      await registry.connect(user1).removeWalletMapping(VALID_NUMBER, "solana");
      expect(await registry.getWalletMapping(VALID_NUMBER, "solana")).to.equal("");

      // 6. Transfer to user2
      await registry.connect(user1).transferFrom(user1.address, user2.address, VALID_NUMBER);
      expect(await registry.ownerOf(VALID_NUMBER)).to.equal(user2.address);

      // 7. New owner adds mapping
      await registry.connect(user2).setWalletMapping(VALID_NUMBER, "sui", "0xSUI_NEW");
      const [chainsAfter, walletsAfter] = await registry.getAllMappings(VALID_NUMBER);
      expect(chainsAfter).to.have.lengthOf(2);
      expect(chainsAfter).to.include("ethereum");
      expect(chainsAfter).to.include("sui");
    });

    it("multiple users with independent number spaces", async function () {
      // User1 registers and maps
      await registry.connect(user1).registerNumber(VALID_NUMBER, { value: REGISTRATION_FEE });
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xUSER1_ETH");

      // User2 registers a different number and maps
      await registry.connect(user2).registerNumber(VALID_NUMBER_2, { value: REGISTRATION_FEE });
      await registry.connect(user2).setWalletMapping(VALID_NUMBER_2, "ethereum", "0xUSER2_ETH");

      // Verify independence
      expect(await registry.getWalletMapping(VALID_NUMBER, "ethereum")).to.equal("0xUSER1_ETH");
      expect(await registry.getWalletMapping(VALID_NUMBER_2, "ethereum")).to.equal("0xUSER2_ETH");

      // User1 changes do not affect user2
      await registry.connect(user1).setWalletMapping(VALID_NUMBER, "ethereum", "0xUSER1_ETH_V2");
      expect(await registry.getWalletMapping(VALID_NUMBER_2, "ethereum")).to.equal("0xUSER2_ETH");
    });
  });
});

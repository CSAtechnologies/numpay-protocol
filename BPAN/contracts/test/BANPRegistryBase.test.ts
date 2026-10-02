import { expect } from "chai";
import { ethers } from "hardhat";
import type { BANPRegistryBase } from "../typechain-types";

describe("BANPRegistryBase fresh zero-fee registry", function () {
  async function fixture() {
    const [admin, alice, bob, stranger] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory("BANPRegistryBase")).deploy() as unknown as BANPRegistryBase;
    return { registry, admin, alice, bob, stranger };
  }

  it("starts empty, costs zero protocol fee, and cannot import Ethereum state", async function () {
    const { registry, alice } = await fixture();
    expect(await registry.registrationFee()).to.equal(0);
    expect(await registry.totalRegistered()).to.equal(0);
    expect(registry.interface.hasFunction("migrateFromV1")).to.equal(false);
    expect(registry.interface.hasFunction("closeMigration")).to.equal(false);
    expect(registry.interface.hasFunction("migrationOpen")).to.equal(false);
    await registry.connect(alice).registerNumber(12345678901n);
    expect(await registry.ownerOf(12345678901n)).to.equal(alice.address);
    expect(await registry.getOwnedNumbers(alice.address, 0, 100)).to.deep.equal([12345678901n]);
  });

  it("supports bounded pagination, empty wallets and multiple numbers", async function () {
    const { registry, alice, bob } = await fixture();
    const numbers = [12345678901n, 12345678902n, 12345678903n];
    for (const number of numbers) await registry.connect(alice).registerNumber(number);
    expect(await registry.getOwnedNumbers(alice.address, 0, 2)).to.deep.equal(numbers.slice(0, 2));
    expect(await registry.getOwnedNumbers(alice.address, 2, 2)).to.deep.equal(numbers.slice(2));
    expect(await registry.getOwnedNumbers(alice.address, ethers.MaxUint256, 1)).to.deep.equal([]);
    expect(await registry.getOwnedNumbers(bob.address, 0, 100)).to.deep.equal([]);
    await expect(registry.getOwnedNumbers(alice.address, 0, 0)).to.be.revertedWithCustomError(registry, "InvalidPageSize");
    await expect(registry.getOwnedNumbers(alice.address, 0, 101)).to.be.revertedWithCustomError(registry, "InvalidPageSize");
  });

  it("moves ownership indexes and clears old destinations on transfer", async function () {
    const { registry, alice, bob, stranger } = await fixture();
    const a = 12345678901n, b = 12345678902n, c = 12345678903n;
    for (const n of [a, b, c]) await registry.connect(alice).registerNumber(n);
    await registry.connect(alice).setWalletMapping(b, "evm", alice.address);
    await registry.connect(alice).transferFrom(alice.address, bob.address, b);
    expect(await registry.getOwnedNumbers(alice.address, 0, 100)).to.deep.equal([a, c]);
    expect(await registry.getOwnedNumbers(bob.address, 0, 100)).to.deep.equal([b]);
    expect(await registry.getWalletMapping(b, "evm")).to.equal("");
    await expect(registry.connect(alice).setWalletMapping(b, "evm", stranger.address))
      .to.be.revertedWithCustomError(registry, "NotNumberOwner");
    await registry.connect(bob).setWalletMapping(b, "evm", bob.address);
    await registry.connect(alice).transferFrom(alice.address, bob.address, c);
    await registry.connect(alice).transferFrom(alice.address, bob.address, a);
    expect(await registry.getOwnedNumbers(alice.address, 0, 100)).to.deep.equal([]);
    expect(await registry.getOwnedNumbers(bob.address, 0, 100)).to.deep.equal([b, c, a]);
    await registry.connect(bob).transferFrom(bob.address, bob.address, b);
    expect(await registry.getOwnedNumbers(bob.address, 0, 100)).to.deep.equal([b, c, a]);
    expect(await registry.getWalletMapping(b, "evm")).to.equal(bob.address);
    await registry.connect(bob).transferFrom(bob.address, alice.address, c);
    expect(await registry.getOwnedNumbers(bob.address, 0, 100)).to.deep.equal([b, a]);
    expect(await registry.getOwnedNumbers(alice.address, 0, 100)).to.deep.equal([c]);
    await expect(registry.connect(stranger).transferFrom(alice.address, bob.address, c)).to.be.reverted;
    expect(await registry.balanceOf(alice.address)).to.equal(1);
    expect(await registry.balanceOf(bob.address)).to.equal(2);
  });

  it("keeps registration and mapping validation, and restricts future fee changes", async function () {
    const { registry, alice } = await fixture();
    await expect(registry.connect(alice).registerNumber(1n)).to.be.revertedWithCustomError(registry, "InvalidNumber");
    await registry.connect(alice).registerNumber(12345678901n);
    await expect(registry.connect(alice).registerNumber(12345678901n)).to.be.revertedWithCustomError(registry, "NumberAlreadyRegistered");
    await expect(registry.connect(alice).setRegistrationFee(1n)).to.be.reverted;
    await registry.setRegistrationFee(1n);
    await expect(registry.connect(alice).registerNumber(12345678902n)).to.be.revertedWithCustomError(registry, "InsufficientFee");
    await registry.setRegistrationFee(0n);
    await registry.connect(alice).registerNumber(12345678902n);
  });

  it("registers both range boundaries and refunds excess ETH", async function () {
    const { registry, alice } = await fixture();
    await expect(registry.connect(alice).registerNumber(10_000_000_000n, { value: 100n }))
      .to.changeEtherBalances([alice, registry], [0n, 0n]);
    await registry.connect(alice).registerNumber(99_999_999_999n);
    expect(await registry.totalRegistered()).to.equal(2n);
    expect(await registry.symbol()).to.equal("BPAN");
    await expect(registry.connect(alice).registerNumber(100_000_000_000n))
      .to.be.revertedWithCustomError(registry, "InvalidNumber");
  });

  it("validates mapping keys and values and enforces ownership", async function () {
    const { registry, alice, stranger } = await fixture();
    const number = 12_345_678_901n;
    await registry.connect(alice).registerNumber(number);
    for (const chain of ["Base", "base mainnet", "a".repeat(33)]) {
      await expect(registry.connect(alice).setWalletMapping(number, chain, alice.address))
        .to.be.revertedWithCustomError(registry, "InvalidChainName");
    }
    await expect(registry.connect(alice).setWalletMapping(number, "", alice.address))
      .to.be.revertedWithCustomError(registry, "EmptyChainName");
    await expect(registry.connect(alice).setWalletMapping(number, "base", ""))
      .to.be.revertedWithCustomError(registry, "EmptyWalletAddress");
    await expect(registry.connect(alice).setWalletMapping(number, "base", "a".repeat(129)))
      .to.be.revertedWithCustomError(registry, "WalletAddressTooLong");
    await expect(registry.connect(stranger).setWalletMapping(number, "base", stranger.address))
      .to.be.revertedWithCustomError(registry, "NotNumberOwner");
    await registry.connect(alice).setWalletMapping(number, "base", "a".repeat(128));
    expect(await registry.getWalletMapping(number, "base")).to.equal("a".repeat(128));
  });

  it("bounds mapping storage while allowing updates and reuse after removal", async function () {
    const { registry, alice, bob } = await fixture();
    const number = 12_345_678_901n;
    await registry.connect(alice).registerNumber(number);
    for (let i = 0; i < 50; i++) {
      await registry.connect(alice).setWalletMapping(number, `chain-${i}`, alice.address);
    }
    await expect(registry.connect(alice).setWalletMapping(number, "chain-50", alice.address))
      .to.be.revertedWithCustomError(registry, "TooManyChainMappings");
    await registry.connect(alice).setWalletMapping(number, "chain-0", bob.address);
    expect((await registry.getChains(number)).length).to.equal(50);
    await expect(registry.connect(bob).removeWalletMapping(number, "chain-0"))
      .to.be.revertedWithCustomError(registry, "NotNumberOwner");
    await registry.connect(alice).removeWalletMapping(number, "chain-0");
    expect(await registry.getWalletMapping(number, "chain-0")).to.equal("");
    await registry.connect(alice).setWalletMapping(number, "chain-50", alice.address);
    await registry.connect(alice).transferFrom(alice.address, bob.address, number);
    expect(await registry.getChains(number)).to.deep.equal([]);
    expect(await registry.getWalletMapping(number, "chain-50")).to.equal("");
    await registry.connect(bob).setWalletMapping(number, "base", bob.address);
    expect(await registry.getAllMappings(number)).to.deep.equal([["base"], [bob.address]]);
  });

  it("caps future fees and restricts withdrawal to the registry owner", async function () {
    const { registry, admin, alice } = await fixture();
    await expect(registry.setRegistrationFee((await registry.MAX_REGISTRATION_FEE()) + 1n))
      .to.be.revertedWithCustomError(registry, "FeeTooHigh");
    await registry.setRegistrationFee(10n);
    await registry.connect(alice).registerNumber(12_345_678_901n, { value: 10n });
    await expect(registry.connect(alice).withdrawFees(alice.address)).to.be.reverted;
    await expect(registry.withdrawFees(ethers.ZeroAddress))
      .to.be.revertedWithCustomError(registry, "ZeroAddress");
    await expect(registry.withdrawFees(admin.address)).to.changeEtherBalances([registry, admin], [-10n, 10n]);
  });
});

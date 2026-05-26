import { ethers } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log("Owner:", owner.address);

  const contract = await ethers.getContractAt(
    "BANPRegistry",
    "0x563356958fe3522b7be869666432594fa194a711",
    owner
  );

  // Check accumulated fees
  const balance = await ethers.provider.getBalance(await contract.getAddress());
  console.log("Contract balance:", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    console.log("No fees to withdraw.");
    return;
  }

  // Withdraw to owner address (change this to any address you want)
  const withdrawTo = owner.address;
  console.log("Withdrawing to:", withdrawTo);

  const tx = await contract.withdrawFees(withdrawTo);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("Fees withdrawn successfully!");

  const newBalance = await ethers.provider.getBalance(await contract.getAddress());
  console.log("Contract balance after:", ethers.formatEther(newBalance), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

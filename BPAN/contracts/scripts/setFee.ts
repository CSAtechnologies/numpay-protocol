import { ethers } from "hardhat";

async function main() {
  const [owner] = await ethers.getSigners();
  console.log("Owner:", owner.address);

  const contract = await ethers.getContractAt(
    "BANPRegistry",
    "0x563356958fe3522b7be869666432594fa194a711",
    owner
  );

  const oldFee = await contract.registrationFee();
  console.log("Current fee:", ethers.formatEther(oldFee), "ETH");

  // ~$3 at ETH ~$2029
  const newFee = ethers.parseEther("0.0015");
  console.log("Setting new fee:", ethers.formatEther(newFee), "ETH");

  const tx = await contract.setRegistrationFee(newFee);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("Fee updated successfully!");

  const updatedFee = await contract.registrationFee();
  console.log("New fee:", ethers.formatEther(updatedFee), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

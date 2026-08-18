import { ethers } from "hardhat";

const DEFAULT_RECIPIENT = "0xe2ECbBa8FC313bcD779A358dbE91a255A8bc071b";

async function main() {
  const tokenAddress = process.env.TEST_TOKEN_ADDRESS?.trim();
  if (!tokenAddress) {
    throw new Error("TEST_TOKEN_ADDRESS is missing in .env");
  }

  const to = ethers.getAddress(process.env.MINT_TO || DEFAULT_RECIPIENT);
  const humanAmount = process.env.MINT_AMOUNT || "1000";
  const amount = ethers.parseUnits(humanAmount, 18);

  const [signer] = await ethers.getSigners();
  const token = await ethers.getContractAt("TestToken", tokenAddress);

  const owner = await token.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not owner ${owner}. Use the owner private key.`,
    );
  }

  const tx = await token.mint(to, amount);
  console.log("mint tx:", tx.hash);
  await tx.wait();

  const balance = await token.balanceOf(to);
  const supply = await token.totalSupply();
  console.log("Minted", humanAmount, "TTK to", to);
  console.log("Recipient balance:", ethers.formatUnits(balance, 18), "TTK");
  console.log("Total supply:", ethers.formatUnits(supply, 18), "TTK");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

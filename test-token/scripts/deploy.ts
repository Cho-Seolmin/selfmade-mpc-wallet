import { ethers } from "hardhat";

const DEFAULT_RECIPIENT = "0xe2ECbBa8FC313bcD779A358dbE91a255A8bc071b";

async function main() {
  const recipient = ethers.getAddress(
    process.env.RECIPIENT_ADDRESS || DEFAULT_RECIPIENT,
  );
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log("Network:", network.name, `(chainId ${network.chainId})`);
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("Recipient / owner:", recipient);

  if (deployer.address.toLowerCase() !== recipient.toLowerCase()) {
    console.warn(
      "Deployer is not the recipient. Tokens and owner role go to the recipient address.",
    );
  }

  if (balance === 0n) {
    throw new Error("Deployer Sepolia ETH balance is 0. Get faucet ETH first.");
  }

  const TestToken = await ethers.getContractFactory("TestToken");
  const token = await TestToken.deploy(recipient);
  await token.waitForDeployment();

  const address = await token.getAddress();
  const supply = await token.totalSupply();
  const owned = await token.balanceOf(recipient);

  console.log("TestToken deployed:", address);
  console.log("Total supply:", ethers.formatUnits(supply, 18), "TTK");
  console.log("Recipient balance:", ethers.formatUnits(owned, 18), "TTK");
  console.log("");
  console.log("Paste into test-token/.env:");
  console.log(`TEST_TOKEN_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

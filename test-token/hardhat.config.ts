import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, ".env") });

const privateKeyRaw = process.env.PRIVATE_KEY?.trim();
const privateKey = privateKeyRaw
  ? privateKeyRaw.startsWith("0x")
    ? privateKeyRaw
    : `0x${privateKeyRaw}`
  : undefined;

const config: HardhatUserConfig = {
  solidity: "0.8.26",
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: privateKey ? [privateKey] : [],
    },
  },
};

export default config;

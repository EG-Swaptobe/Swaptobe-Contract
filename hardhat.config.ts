import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import "hardhat-deploy";
import "hardhat-deploy-ethers";

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        }
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 1000,
          },
        }
      }
    ]
  },
  defaultNetwork: "hardhat",
  networks: {
    tobechain: {
      url: "https://rpc.tobescan.com",
      chainId: 4080,
      accounts: [PRIVATE_KEY]
    },
  },
  // hardhat-deploy named account system
  namedAccounts: {
    deployer: {
      default: 0, 
    },
  },
  etherscan: {
    apiKey: {
      tobechain: "6TSSEDBBMEQ4KW8HVB9HHBWHZRA3JN7GSN"
    },
    customChains: [
      {
        network: "tobechain",
        chainId: 4080,
        urls: {
          apiURL: "https://tobescan.com/api",
          browserURL: "https://tobescan.com"
        }
      },
    ]
  },
};

export default config;

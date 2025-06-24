import { DeployFunction } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { blockConfirmation, developmentChains } from "../../helper-hardhat-config";
import { verify } from "../../scripts/utils/verify";
import { ethers } from "hardhat";
import { SwaptobeFactory } from "../../typechain-types";

const deploySwaptobeFactory: DeployFunction = async function(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log("Deploying SwaptobeFactory and waiting for confirmations...");
  const SwaptobeFactory = await deploy("SwaptobeFactory", {
    from: deployer,
    args: [deployer],
    log: true,
    // we need to wait if on a live network so we can verify properly
    waitConfirmations: blockConfirmation[network.name] || 1,
  });

  const SwaptobeFactoryContract = await ethers.getContract('SwaptobeFactory', deployer) as SwaptobeFactory;
  log(`\nCODE HASH: ${await SwaptobeFactoryContract.INIT_CODE_PAIR_HASH()}\n`);

  // verify if not on a local chain
  if (!developmentChains.includes(network.name)) {
    console.log("Wait before verifying");
    await verify(SwaptobeFactory.address, [deployer]);
  }
};

export default deploySwaptobeFactory;
deploySwaptobeFactory.tags = ["all", "core", "Factory", "SwaptobeFactory"];
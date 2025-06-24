import { DeployFunction } from "hardhat-deploy/dist/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { blockConfirmation, developmentChains } from "../../helper-hardhat-config";
import { verify } from "../../scripts/utils/verify";
import { ethers } from "hardhat";

const deploySwaptobeRouter: DeployFunction = async function(
  hre: HardhatRuntimeEnvironment
) {
  const { getNamedAccounts, deployments, network } = hre;
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();

  log("----------------------------------------------------");
  log("Deploying SwaptobeRouter and waiting for confirmations...");

  // Change this manually if you want to modify the addresses used by the router
  const factoryAddress = await (await ethers.getContract("SwaptobeFactory")).getAddress();
  const wtobeAddress = await (await ethers.getContract("WTOBE")).getAddress();
  // const wtobeAddress = "wtobe_address";
  const SwaptobeRouter = await deploy("SwaptobeRouter", {
    from: deployer,
    args: [
        factoryAddress, // factory
        wtobeAddress // wtobe
    ],
    log: true,
    // we need to wait if on a live network so we can verify properly
    waitConfirmations: blockConfirmation[network.name] || 1,
  });

  // verify if not on a local chain
  if (!developmentChains.includes(network.name)) {
    console.log("Wait before verifying");
    await verify(SwaptobeRouter.address, [factoryAddress, wtobeAddress]);
  }
};

export default deploySwaptobeRouter;
deploySwaptobeRouter.tags = ["all", "periphery", "SwaptobeRouter"];
deploySwaptobeRouter.dependencies = ["SwaptobeFactory", "WTOBE"]; // remove "WTOBE" if you want to deploy the Router without deploying a WTOBE contract
deploySwaptobeRouter.runAtTheEnd = true;
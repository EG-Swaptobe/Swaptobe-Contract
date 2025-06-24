import { deployments, ethers, network } from "hardhat";
import { expect } from "chai";
import { TBRC20, SwaptobeFactory } from "../../typechain-types";
import { developmentChains } from "../../helper-hardhat-config";
import { expandTo18Decimals } from "../shared/utilities";

const setup = deployments.createFixture(async ({deployments, getNamedAccounts, ethers}, options) => {
  if (developmentChains.includes(network.name))
    await deployments.fixture(["SwaptobePair"]); // ensure you start from a fresh deployments
  const { deployer } = await getNamedAccounts();
  const swaptobeFactory = await ethers.getContract('SwaptobeFactory', deployer) as SwaptobeFactory;
  const tokenA = await ethers.getContract('TokenA', deployer) as TBRC20;
  const tokenB = await ethers.getContract('TokenB', deployer) as TBRC20;
  const swaptobePairAddress = await swaptobeFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
  const swaptobePair = await ethers.getContractAt("contracts/core/interfaces/ISwaptobePair.sol:ISwaptobePair", swaptobePairAddress);
  const token0Address = await swaptobePair.token0();
  const token0 = await tokenA.getAddress() === token0Address ? tokenA : tokenB;
  const token1 = await tokenA.getAddress() === token0Address ? tokenB : tokenA;

  console.log("swaptobePair address:", await swaptobePair.getAddress());
  return { deployer, swaptobeFactory, swaptobePair, token0, token1 };
});

const MINIMUM_LIQUIDITY = 10n ** 3n;

// Only use for local tests to assure the good of the core
if (!developmentChains.includes(network.name)) {
  console.log("Test are setup only for local tests...");
} else {
  describe('SwaptobePair', () => {
    it("mint", async function () {
      const { deployer, swaptobeFactory, swaptobePair, token0, token1 } = await setup();

      const token0Amount = expandTo18Decimals(1n);
      const token1Amount = expandTo18Decimals(4n);
      await token0.transfer(await swaptobePair.getAddress(), token0Amount);
      await token1.transfer(await swaptobePair.getAddress(), token1Amount);

      const expectedLiquidity = expandTo18Decimals(2n);
      await expect(swaptobePair.mint(deployer))
        .to.emit(swaptobePair, 'Transfer')
        .withArgs(ethers.ZeroAddress, ethers.ZeroAddress, MINIMUM_LIQUIDITY)
        .to.emit(swaptobePair, 'Transfer')
        .withArgs(ethers.ZeroAddress, deployer, expectedLiquidity - MINIMUM_LIQUIDITY)
        .to.emit(swaptobePair, 'Sync')
        .withArgs(token0Amount, token1Amount)
        .to.emit(swaptobePair, 'Mint')
        .withArgs(deployer, token0Amount, token1Amount);

      expect(await swaptobePair.totalSupply()).to.eq(expectedLiquidity);
      expect(await swaptobePair.balanceOf(deployer)).to.eq(expectedLiquidity - MINIMUM_LIQUIDITY);
      expect(await token0.balanceOf(await swaptobePair.getAddress())).to.eq(token0Amount);
      expect(await token1.balanceOf(await swaptobePair.getAddress())).to.eq(token1Amount);
      const reserves = await swaptobePair.getReserves();
      expect(reserves[0]).to.eq(token0Amount);
      expect(reserves[1]).to.eq(token1Amount);
    }).timeout(100000);
  });
}
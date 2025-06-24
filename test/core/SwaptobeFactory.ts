import { deployments, ethers, network } from "hardhat";
import { expect } from "chai";
import { SwaptobeFactory } from "../../typechain-types";
import { developmentChains } from "../../helper-hardhat-config";
import SwaptobePair from "../../artifacts/contracts/core/SwaptobePair.sol/SwaptobePair.json";
import { getCreate2Address } from "../shared/utilities";
import { Contract } from "ethers";

const setup = deployments.createFixture(async ({deployments, getNamedAccounts, ethers}, options) => {
  if (developmentChains.includes(network.name))
    await deployments.fixture(["SwaptobeFactory"]); // ensure you start from a fresh deployments
  const { deployer } = await getNamedAccounts();
  const swaptobeFactory = await ethers.getContract('SwaptobeFactory', deployer) as SwaptobeFactory;

  return { deployer, swaptobeFactory };
});

const TEST_ADDRESSES: [string, string] = [
  '0x1000000000000000000000000000000000000000',
  '0x2000000000000000000000000000000000000000'
]

// Only use for local tests to assure the good of the core
if (!developmentChains.includes(network.name)) {
  console.log("Test are setup only for local tests...");
} else {
  describe('SwaptobeFactory', () => {
    describe("Init", function () {
      it("feeTo, feeToSetter, allPairsLength", async function () {
        const { deployer, swaptobeFactory } = await setup();
  
        expect(await swaptobeFactory.feeTo()).to.eq(ethers.ZeroAddress);
        expect(await swaptobeFactory.feeToSetter()).to.eq(deployer);
        expect(await swaptobeFactory.allPairsLength()).to.eq(0);
    
      });
    });
    describe("Pair", function () {
      async function createPair(tokens: [string, string], swaptobeFactory: SwaptobeFactory) {
        const bytecode = SwaptobePair.bytecode;
        const create2Address = getCreate2Address(await swaptobeFactory.getAddress(), tokens, bytecode);
        await expect(swaptobeFactory.createPair(...tokens))
          .to.emit(swaptobeFactory, 'PairCreated')
          .withArgs(TEST_ADDRESSES[0], TEST_ADDRESSES[1], create2Address, 1n);
    
        await expect(swaptobeFactory.createPair(...tokens)).to.be.reverted; // Swaptobe: PAIR_EXISTS
        await expect(swaptobeFactory.createPair(...tokens.slice().reverse() as any)).to.be.reverted; // Swaptobe: PAIR_EXISTS
        expect(await swaptobeFactory.getPair(...tokens)).to.eq(create2Address);
        expect(await swaptobeFactory.getPair(...tokens.slice().reverse() as any)).to.eq(create2Address);
        expect(await swaptobeFactory.allPairs(0)).to.eq(create2Address);
        expect(await swaptobeFactory.allPairsLength()).to.eq(1);
    
        const pair = new Contract(create2Address, JSON.stringify(SwaptobePair.abi), ethers.provider);
        expect(await pair.factory()).to.eq(await swaptobeFactory.getAddress());
        expect(await pair.token0()).to.eq(TEST_ADDRESSES[0]);
        expect(await pair.token1()).to.eq(TEST_ADDRESSES[1]);
      }
  
      it("createPair", async function () {
        const { swaptobeFactory } = await setup();
  
        await createPair(TEST_ADDRESSES, swaptobeFactory);
      });
      it("createPair:reverse", async function () {
        const { swaptobeFactory } = await setup();
  
        await createPair(TEST_ADDRESSES.slice().reverse() as [string, string], swaptobeFactory);
      });
      it("createPair:gas", async function () {
        const { swaptobeFactory } = await setup();
  
        const tx = await swaptobeFactory.createPair(...TEST_ADDRESSES);
        const receipt = await tx.wait();
        if (receipt)
          expect(receipt.gasUsed).to.be.below(4000000); // non-optimized
        else
          throw new Error("Error in the gas prediction");
      });    
      it("setFeeTo", async function () {
        const { swaptobeFactory } = await setup();
        const [owner, account2] = await ethers.getSigners();
  
        await expect(swaptobeFactory.connect(account2).setFeeTo(account2.address)).to.be.revertedWith('Swaptobe: FORBIDDEN');
        await swaptobeFactory.setFeeTo(owner.address);
        expect(await swaptobeFactory.feeTo()).to.eq(owner.address);
      });
      it("setFeeToSetter", async function () {
        const { swaptobeFactory } = await setup();
        const [owner, account2] = await ethers.getSigners();
  
        await expect(swaptobeFactory.connect(account2).setFeeToSetter(account2.address)).to.be.revertedWith('Swaptobe: FORBIDDEN');
        await swaptobeFactory.setFeeToSetter(account2.address);
        expect(await swaptobeFactory.feeToSetter()).to.eq(account2.address);
        await expect(swaptobeFactory.setFeeToSetter(owner.address)).to.be.revertedWith('Swaptobe: FORBIDDEN');
      });
    });
  });
}


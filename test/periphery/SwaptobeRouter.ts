import { deployments, ethers, network } from "hardhat";
import { expect } from "chai";
import { TBRC20, SwaptobeFactory, SwaptobePair, SwaptobeRouter } from "../../typechain-types";
import { developmentChains } from "../../helper-hardhat-config";
import { expandTo18Decimals, getCreate2Address } from "../shared/utilities";
import { ZeroAddress } from "ethers";

const setup = deployments.createFixture(async ({deployments, getNamedAccounts, ethers}, isSpecialTest = false) => {
  if (developmentChains.includes(network.name))
    await deployments.fixture(["SwaptobePair", "SwaptobeRouter", "Tokens"]); // ensure you start from a fresh deployments
  const { deployer } = await getNamedAccounts();
  const swaptobeFactory = await ethers.getContract('SwaptobeFactory', deployer) as SwaptobeFactory;
  const tokenA = await ethers.getContract('TokenA', deployer) as TBRC20;
  const tokenB = await ethers.getContract('TokenB', deployer) as TBRC20;
  const swaptobePairAddress = await swaptobeFactory.getPair(await tokenA.getAddress(), await tokenB.getAddress());
  const swaptobePair = (await ethers.getContractAt("contracts/core/interfaces/ISwaptobePair.sol:ISwaptobePair", swaptobePairAddress)) as unknown as SwaptobePair;
  const token0Address = await swaptobePair.token0();
  const token0 = await tokenA.getAddress() === token0Address ? tokenA : tokenB;
  const token1 = await tokenA.getAddress() === token0Address ? tokenB : tokenA;
  const SwaptobeRouter = await ethers.getContract('SwaptobeRouter', deployer) as SwaptobeRouter;

  if (isSpecialTest) {
    const tokenC = await ethers.getContract('TokenC', deployer) as TBRC20;
    const tokenD = await ethers.getContract('TokenD', deployer) as TBRC20;

    return { deployer, swaptobeFactory, swaptobePair, token0, token1, SwaptobeRouter, tokenC, tokenD };
  }

  return { deployer, swaptobeFactory, swaptobePair, token0, token1, SwaptobeRouter };
});

// Tests both local and on-chain
describe('SwaptobeRouter', () => {
  // Swap token0 for token1 from the pool
  it("swapTokensForExactTokens", async function () {
    const { deployer, swaptobePair, token0, token1, SwaptobeRouter } = await setup();
    const pairAddress = await swaptobePair.getAddress();
    let token0PairBalance = await token0.balanceOf(pairAddress);
    let token1PairBalance = await token1.balanceOf(pairAddress);
    const token0AmountNeeded = expandTo18Decimals(5n); // amount of token 0 in the pool
    const token1AmountNeeded = expandTo18Decimals(10n); // amount of token 1 in the pool
    const outputAmount = expandTo18Decimals(1n); // amount of token 1 asked by the user

    // add liquidity if needed
    if (token0PairBalance < token0AmountNeeded && token1PairBalance < token1AmountNeeded) {
      await (await token0.transfer(pairAddress, token0AmountNeeded - token0PairBalance)).wait();
      await (await token1.transfer(pairAddress, token1AmountNeeded - token1PairBalance)).wait();
      await (await swaptobePair.mint(deployer)).wait(); // mint LP tokens
      token0PairBalance = await token0.balanceOf(pairAddress);
      token1PairBalance = await token1.balanceOf(pairAddress);
    }

    // amount of token 0 user will need to send
    const expectedSwapAmount = await SwaptobeRouter.getAmountIn(outputAmount, await token0.balanceOf(pairAddress), await token1.balanceOf(pairAddress));

    // snapshot user balance before executions
    const userBalance0AtStart = await token0.balanceOf(deployer);
    const userBalance1AtStart = await token1.balanceOf(deployer);
    const pairBalance0AtStart = await token0.balanceOf(pairAddress);
    const pairBalance1AtStart = await token1.balanceOf(pairAddress);

    // Approve router to transfer funds
    await (await token0.approve(await SwaptobeRouter.getAddress(), ethers.MaxUint256)).wait();

    // Swap tokens for exact tokens
    const receipt = await (await SwaptobeRouter.swapTokensForExactTokens(
      outputAmount, // amount out
      ethers.MaxUint256, // amount in max
      [await token0.getAddress(), await token1.getAddress()], // path
      deployer, // to
      ethers.MaxUint256, // deadline
    )).wait();

    // Check events
    // token0 transfer from user to the pool
    const token0TransferEvent = (await token0.queryFilter(token0.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(token0TransferEvent.args[0]).to.equal(deployer);
    expect(token0TransferEvent.args[1]).to.equal(pairAddress);
    expect(token0TransferEvent.args[2]).to.equal(expectedSwapAmount);
    // token1 transfer from pool to user
    const token1TransferEvent = (await token1.queryFilter(token1.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(token1TransferEvent.args[0]).to.equal(pairAddress);
    expect(token1TransferEvent.args[1]).to.equal(deployer);
    expect(token1TransferEvent.args[2]).to.equal(outputAmount);
    // sync balance of token0 and token1
    const syncEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Sync, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(syncEvent.args[0]).to.equal(token0PairBalance + expectedSwapAmount);
    expect(syncEvent.args[1]).to.equal(token1PairBalance - outputAmount);
    // swap event
    const swapEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Swap, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(swapEvent.args[0]).to.equal(await SwaptobeRouter.getAddress());
    expect(swapEvent.args[1]).to.equal(expectedSwapAmount);
    expect(swapEvent.args[2]).to.equal(0);
    expect(swapEvent.args[3]).to.equal(0);
    expect(swapEvent.args[4]).to.equal(outputAmount);
    expect(swapEvent.args[5]).to.equal(deployer);

    // Check the balances after swap for user
    expect(await token0.balanceOf(deployer)).to.equal(userBalance0AtStart - expectedSwapAmount);
    expect(await token1.balanceOf(deployer)).to.equal(userBalance1AtStart + outputAmount);
    // Check the balances after swap for pair
    expect(await token0.balanceOf(pairAddress)).to.equal(pairBalance0AtStart + expectedSwapAmount);
    expect(await token1.balanceOf(pairAddress)).to.equal(pairBalance1AtStart - outputAmount);

    // remove liquidity
    const lpBalance = await swaptobePair.balanceOf(deployer);
    if (lpBalance > 0) {
      await (await swaptobePair.transfer(pairAddress, lpBalance)).wait();
      await (await swaptobePair.burn(deployer)).wait(); // burn LP tokens
    }
  }).timeout(100000);

  // Add liquidity for token0 token1 in the pool
  it("addLiquidity", async function () {
    const { deployer, swaptobePair, token0, token1, SwaptobeRouter } = await setup();
    // Setup
    const token0Amount = expandTo18Decimals(5n);
    const token1Amount = expandTo18Decimals(10n);
    const pairAddress = await swaptobePair.getAddress();
    const pairBalance0AtStart = await token0.balanceOf(pairAddress);
    const pairBalance1AtStart = await token1.balanceOf(pairAddress);
    const lpBalanceAtStart = await swaptobePair.balanceOf(deployer);

    // Calculate the amount of token 1 optimised keep by the pool during the add liquidity
    const pairReservesBefore = await swaptobePair.getReserves();
    const token1Optimised = pairReservesBefore[0] > 0n ? await SwaptobeRouter.quote(token0Amount, pairReservesBefore[0], pairReservesBefore[1]) : token1Amount;

    // Approve router to transfer funds
    await (await token0.approve(await SwaptobeRouter.getAddress(), ethers.MaxUint256)).wait();
    await (await token1.approve(await SwaptobeRouter.getAddress(), ethers.MaxUint256)).wait();

    // Add liquidity in the pool
    const receipt = await (await SwaptobeRouter.addLiquidity(
      await token0.getAddress(),
      await token1.getAddress(),
      token0Amount,
      token1Amount,
      0,
      0,
      deployer,
      ethers.MaxUint256,
    )).wait();

    // Check events
    // token0 transfer from user to the Router
    const token0TransferEvent = (await token0.queryFilter(token0.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(token0TransferEvent.args[0]).to.equal(deployer);
    expect(token0TransferEvent.args[1]).to.equal(pairAddress);
    expect(token0TransferEvent.args[2]).to.equal(token0Amount);
    // token1 transfer from user to the Router
    const token1TransferEvent = (await token1.queryFilter(token1.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(token1TransferEvent.args[0]).to.equal(deployer);
    expect(token1TransferEvent.args[1]).to.equal(pairAddress);
    expect(token1TransferEvent.args[2]).to.equal(token1Optimised);
    // sync balance of token0 and token1
    const syncEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Sync, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(syncEvent.args[0]).to.equal(pairBalance0AtStart + token0Amount);
    expect(syncEvent.args[1]).to.equal(pairBalance1AtStart + token1Optimised);
    // pair mint lp tokens for the user
    const mintEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Mint, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(mintEvent.args[0]).to.equal(await SwaptobeRouter.getAddress());
    expect(mintEvent.args[1]).to.equal(token0Amount);
    expect(mintEvent.args[2]).to.equal(token1Optimised);

    // Check user have more lp than before
    expect(await swaptobePair.balanceOf(deployer)).to.be.greaterThan(lpBalanceAtStart); 

    // Remove liquidity
    const lpBalance = await swaptobePair.balanceOf(deployer);
    if (lpBalance > 0) {
      await (await swaptobePair.transfer(pairAddress, lpBalance)).wait();
      await (await swaptobePair.burn(deployer)).wait(); // burn LP tokens
    }
  }).timeout(100000);

  // Remove liquidity for token0 token1 in the pool
  it("removeLiquidity", async function () {
    const { deployer, swaptobePair, token0, token1, SwaptobeRouter } = await setup();
    const pairAddress = await swaptobePair.getAddress();
    let lpBalanceAtStart = await swaptobePair.balanceOf(deployer);
    // Check if you have LP Tokens, add liquidity if you don't
    if (lpBalanceAtStart < 1) {
      await (await token0.transfer(pairAddress, expandTo18Decimals(5n))).wait();
      await (await token1.transfer(pairAddress, expandTo18Decimals(10n))).wait();
      await (await swaptobePair.mint(deployer)).wait(); // mint LP tokens
      lpBalanceAtStart = await swaptobePair.balanceOf(deployer);
    }
    const userToken0Balance = await token0.balanceOf(deployer);
    const userToken1Balance = await token1.balanceOf(deployer);
    const pairToken0Balance = await token0.balanceOf(pairAddress);
    const pairToken1Balance = await token1.balanceOf(pairAddress);
    const liquidity = lpBalanceAtStart; // same as lp balance because I will send all my lp to the pair
    const totalSupply = await swaptobePair.totalSupply();
    const amountToken0Received = liquidity * pairToken0Balance / totalSupply;
    const amountToken1Received = liquidity * pairToken1Balance / totalSupply;

    // Approve router to transfer LP tokens
    await (await swaptobePair.approve(await SwaptobeRouter.getAddress(), ethers.MaxUint256)).wait();
    
    // Remove liquidity in the pool
    const receipt = await (await SwaptobeRouter.removeLiquidity(
      await token0.getAddress(),
      await token1.getAddress(),
      lpBalanceAtStart,
      0,
      0,
      deployer,
      ethers.MaxUint256,
    )).wait();

    // Check events
    // lp tokens transfer from user to pair
    const lpTokenTransferEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(lpTokenTransferEvent.args[0]).to.equal(deployer);
    expect(lpTokenTransferEvent.args[1]).to.equal(pairAddress);
    expect(lpTokenTransferEvent.args[2]).to.equal(lpBalanceAtStart);
    // lp tokens transfer from pair to address zero -> burn
    const lpTokenBurnEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[1];
    expect(lpTokenBurnEvent.args[0]).to.equal(pairAddress);
    expect(lpTokenBurnEvent.args[1]).to.equal(ethers.ZeroAddress);
    expect(lpTokenBurnEvent.args[2]).to.equal(lpBalanceAtStart);
    // token0 transfer from pair to the user
    const token0TransferEvent = (await token0.queryFilter(token0.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(token0TransferEvent.args[0]).to.equal(pairAddress);
    expect(token0TransferEvent.args[1]).to.equal(deployer);
    expect(token0TransferEvent.args[2]).to.equal(amountToken0Received);
    // token1 transfer from pair to the user
    const token1TransferEvent = (await token1.queryFilter(token1.filters.Transfer, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(token1TransferEvent.args[0]).to.equal(pairAddress);
    expect(token1TransferEvent.args[1]).to.equal(deployer);
    expect(token1TransferEvent.args[2]).to.equal(amountToken1Received);
    // sync balance of token0 and token1
    const pairSyncEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Sync, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(pairSyncEvent.args[0]).to.equal(pairToken0Balance - amountToken0Received);
    expect(pairSyncEvent.args[1]).to.equal(pairToken1Balance - amountToken1Received);
    // burn event emitted by the router
    const pairBurnEvent = (await swaptobePair.queryFilter(swaptobePair.filters.Burn, receipt?.blockNumber, receipt?.blockNumber))[0];
    expect(pairBurnEvent.args[0]).to.equal(await SwaptobeRouter.getAddress());
    expect(pairBurnEvent.args[1]).to.equal(amountToken0Received);
    expect(pairBurnEvent.args[2]).to.equal(amountToken1Received);
    expect(pairBurnEvent.args[3]).to.equal(deployer);

    // User's lp balance should be empty
    expect(await swaptobePair.balanceOf(deployer)).to.eq(0);
    // User's tokens balance should be increased
    expect(await token0.balanceOf(deployer)).to.eq(userToken0Balance + amountToken0Received);
    expect(await token1.balanceOf(deployer)).to.eq(userToken1Balance + amountToken1Received);
  });

  // This test has been add to test the call to addLiquidity on the router
  // to both create the pair and add liquidity in the same transactions
  it("SPECIAL TEST addLiquidity: create pair + add liquidity in same tx", async function () {
    const { deployer, swaptobeFactory, tokenC, tokenD, SwaptobeRouter } = await setup(true);
    // Setup
    if (tokenC == undefined || tokenD == undefined)
      throw new Error("Deploy token C and Token D before running this test");
    const token0Amount = expandTo18Decimals(5n);
    const token1Amount = expandTo18Decimals(10n);
    const pairAddress = await swaptobeFactory.getPair(await tokenC.getAddress(), await tokenD.getAddress());
    if (pairAddress != ZeroAddress) {
      // Pair already created
      console.log("WARNING: if you want to run this test again, you need to redeploy tokenC and tokenD");
      this.skip();
    }

    // approve the router to move tokens
    await (await tokenC.approve(await SwaptobeRouter.getAddress(), ethers.MaxUint256)).wait();
    await (await tokenD.approve(await SwaptobeRouter.getAddress(), ethers.MaxUint256)).wait();

    // Create + add liquidity in the pair
    await (await SwaptobeRouter.addLiquidity(
      await tokenC.getAddress(),
      await tokenD.getAddress(),
      token0Amount,
      token1Amount,
      0,
      0,
      deployer,
      ethers.MaxUint256,
    )).wait();

    // Check pair is created
    const tokens: [string, string] = [await tokenC.getAddress(), await tokenD.getAddress()];
    const pairBytecode = (await ethers.getContractFactory("SwaptobePair")).bytecode;
    const expectedPairAddress = getCreate2Address(await swaptobeFactory.getAddress(), tokens, pairBytecode);
    const newPair = await swaptobeFactory.getPair(await tokenC.getAddress(), await tokenD.getAddress());
    expect(newPair).to.equal(expectedPairAddress);

    // Check liquidity
    const swaptobePair = (await ethers.getContractAt("contracts/core/interfaces/ISwaptobePair.sol:ISwaptobePair", newPair)) as unknown as SwaptobePair;
    const [reserve0, reserve1, blockTimestampLast] = await swaptobePair.getReserves();
    expect(reserve0 + reserve1).to.equal(token0Amount + token1Amount);
  }).timeout(100000);
});
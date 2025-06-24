// SPDX-License-Identifier: MIT
pragma solidity =0.6.6;

import '../core/interfaces/ISwaptobeFactory.sol';
import '../lib/libraries/TransferHelper.sol';

import './interfaces/ISwaptobeRouter.sol';
import './libraries/SwaptobeLibrary.sol';
import './libraries/SafeMath.sol';
import './interfaces/ITBRC20.sol';
import './interfaces/IWTOBE.sol';

contract SwaptobeRouter is ISwaptobeRouter {
    using SafeMath for uint;

    address public immutable override factory;
    address public immutable override WTOBE;

    modifier ensure(uint deadline) {
        require(deadline >= block.timestamp, 'SwaptobeRouter: EXPIRED');
        _;
    }

    constructor(address _factory, address _WTOBE) public {
        factory = _factory;
        WTOBE = _WTOBE;
    }

    receive() external payable {
        assert(msg.sender == WTOBE); // only accept TOBE via fallback from the WTOBE contract
    }

    // **** ADD LIQUIDITY ****
    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin
    ) internal virtual returns (uint amountA, uint amountB) {
        // create the pair if it doesn't exist yet
        if (ISwaptobeFactory(factory).getPair(tokenA, tokenB) == address(0)) {
            ISwaptobeFactory(factory).createPair(tokenA, tokenB);
        }
        (uint reserveA, uint reserveB) = SwaptobeLibrary.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint amountBOptimal = SwaptobeLibrary.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                require(amountBOptimal >= amountBMin, 'SwaptobeRouter: INSUFFICIENT_B_AMOUNT');
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint amountAOptimal = SwaptobeLibrary.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                require(amountAOptimal >= amountAMin, 'SwaptobeRouter: INSUFFICIENT_A_AMOUNT');
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint amountADesired,
        uint amountBDesired,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint amountA, uint amountB, uint liquidity) {
        (amountA, amountB) = _addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin);
        address pair = SwaptobeLibrary.pairFor(factory, tokenA, tokenB);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = ISwaptobePair(pair).mint(to);
    }
    function addLiquidityTOBE(
        address token,
        uint amountTokenDesired,
        uint amountTokenMin,
        uint amountTOBEMin,
        address to,
        uint deadline
    ) external virtual override payable ensure(deadline) returns (uint amountToken, uint amountTOBE, uint liquidity) {
        (amountToken, amountTOBE) = _addLiquidity(
            token,
            WTOBE,
            amountTokenDesired,
            msg.value,
            amountTokenMin,
            amountTOBEMin
        );
        address pair = SwaptobeLibrary.pairFor(factory, token, WTOBE);
        TransferHelper.safeTransferFrom(token, msg.sender, pair, amountToken);
        IWTOBE(WTOBE).deposit{value: amountTOBE}();
        assert(IWTOBE(WTOBE).transfer(pair, amountTOBE));
        liquidity = ISwaptobePair(pair).mint(to);
        // refund dust eth, if any
        if (msg.value > amountTOBE) TransferHelper.safeTransferTOBE(msg.sender, msg.value - amountTOBE);
    }

    // **** REMOVE LIQUIDITY ****
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountA, uint amountB) {
        address pair = SwaptobeLibrary.pairFor(factory, tokenA, tokenB);
        ISwaptobePair(pair).transferFrom(msg.sender, pair, liquidity); // send liquidity to pair
        (uint amount0, uint amount1) = ISwaptobePair(pair).burn(to);
        (address token0,) = SwaptobeLibrary.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);
        require(amountA >= amountAMin, 'SwaptobeRouter: INSUFFICIENT_A_AMOUNT');
        require(amountB >= amountBMin, 'SwaptobeRouter: INSUFFICIENT_B_AMOUNT');
    }
    function removeLiquidityTOBE(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTOBEMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountToken, uint amountTOBE) {
        (amountToken, amountTOBE) = removeLiquidity(
            token,
            WTOBE,
            liquidity,
            amountTokenMin,
            amountTOBEMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, amountToken);
        IWTOBE(WTOBE).withdraw(amountTOBE);
        TransferHelper.safeTransferTOBE(to, amountTOBE);
    }
    function removeLiquidityWithPermit(
        address tokenA,
        address tokenB,
        uint liquidity,
        uint amountAMin,
        uint amountBMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountA, uint amountB) {
        address pair = SwaptobeLibrary.pairFor(factory, tokenA, tokenB);
        uint value = approveMax ? uint(-1) : liquidity;
        ISwaptobePair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountA, amountB) = removeLiquidity(tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline);
    }
    function removeLiquidityTOBEWithPermit(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTOBEMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountToken, uint amountTOBE) {
        address pair = SwaptobeLibrary.pairFor(factory, token, WTOBE);
        uint value = approveMax ? uint(-1) : liquidity;
        ISwaptobePair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        (amountToken, amountTOBE) = removeLiquidityTOBE(token, liquidity, amountTokenMin, amountTOBEMin, to, deadline);
    }

    // **** REMOVE LIQUIDITY (supporting fee-on-transfer tokens) ****
    function removeLiquidityTOBESupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTOBEMin,
        address to,
        uint deadline
    ) public virtual override ensure(deadline) returns (uint amountTOBE) {
        (, amountTOBE) = removeLiquidity(
            token,
            WTOBE,
            liquidity,
            amountTokenMin,
            amountTOBEMin,
            address(this),
            deadline
        );
        TransferHelper.safeTransfer(token, to, ITBRC20(token).balanceOf(address(this)));
        IWTOBE(WTOBE).withdraw(amountTOBE);
        TransferHelper.safeTransferTOBE(to, amountTOBE);
    }
    function removeLiquidityTOBEWithPermitSupportingFeeOnTransferTokens(
        address token,
        uint liquidity,
        uint amountTokenMin,
        uint amountTOBEMin,
        address to,
        uint deadline,
        bool approveMax, uint8 v, bytes32 r, bytes32 s
    ) external virtual override returns (uint amountTOBE) {
        address pair = SwaptobeLibrary.pairFor(factory, token, WTOBE);
        uint value = approveMax ? uint(-1) : liquidity;
        ISwaptobePair(pair).permit(msg.sender, address(this), value, deadline, v, r, s);
        amountTOBE = removeLiquidityTOBESupportingFeeOnTransferTokens(
            token, liquidity, amountTokenMin, amountTOBEMin, to, deadline
        );
    }

    // **** SWAP ****
    // requires the initial amount to have already been sent to the first pair
    function _swap(uint[] memory amounts, address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = SwaptobeLibrary.sortTokens(input, output);
            uint amountOut = amounts[i + 1];
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOut) : (amountOut, uint(0));
            address to = i < path.length - 2 ? SwaptobeLibrary.pairFor(factory, output, path[i + 2]) : _to;
            ISwaptobePair(SwaptobeLibrary.pairFor(factory, input, output)).swap(
                amount0Out, amount1Out, to, new bytes(0)
            );
        }
    }
    function swapExactTokensForTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint[] memory amounts) {
        amounts = SwaptobeLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'SwaptobeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, SwaptobeLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }
    function swapTokensForExactTokens(
        uint amountOut,
        uint amountInMax,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) returns (uint[] memory amounts) {
        amounts = SwaptobeLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'SwaptobeRouter: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, SwaptobeLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }
    function swapExactTOBEForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == WTOBE, 'SwaptobeRouter: INVALID_PATH');
        amounts = SwaptobeLibrary.getAmountsOut(factory, msg.value, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'SwaptobeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IWTOBE(WTOBE).deposit{value: amounts[0]}();
        assert(IWTOBE(WTOBE).transfer(SwaptobeLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
    }
    function swapTokensForExactTOBE(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WTOBE, 'SwaptobeRouter: INVALID_PATH');
        amounts = SwaptobeLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= amountInMax, 'SwaptobeRouter: EXCESSIVE_INPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, SwaptobeLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this));
        IWTOBE(WTOBE).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferTOBE(to, amounts[amounts.length - 1]);
    }
    function swapExactTokensForTOBE(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[path.length - 1] == WTOBE, 'SwaptobeRouter: INVALID_PATH');
        amounts = SwaptobeLibrary.getAmountsOut(factory, amountIn, path);
        require(amounts[amounts.length - 1] >= amountOutMin, 'SwaptobeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, SwaptobeLibrary.pairFor(factory, path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, address(this));
        IWTOBE(WTOBE).withdraw(amounts[amounts.length - 1]);
        TransferHelper.safeTransferTOBE(to, amounts[amounts.length - 1]);
    }
    function swapTOBEForExactTokens(uint amountOut, address[] calldata path, address to, uint deadline)
        external
        virtual
        override
        payable
        ensure(deadline)
        returns (uint[] memory amounts)
    {
        require(path[0] == WTOBE, 'SwaptobeRouter: INVALID_PATH');
        amounts = SwaptobeLibrary.getAmountsIn(factory, amountOut, path);
        require(amounts[0] <= msg.value, 'SwaptobeRouter: EXCESSIVE_INPUT_AMOUNT');
        IWTOBE(WTOBE).deposit{value: amounts[0]}();
        assert(IWTOBE(WTOBE).transfer(SwaptobeLibrary.pairFor(factory, path[0], path[1]), amounts[0]));
        _swap(amounts, path, to);
        // refund dust eth, if any
        if (msg.value > amounts[0]) TransferHelper.safeTransferTOBE(msg.sender, msg.value - amounts[0]);
    }

    // **** SWAP (supporting fee-on-transfer tokens) ****
    // requires the initial amount to have already been sent to the first pair
    function _swapSupportingFeeOnTransferTokens(address[] memory path, address _to) internal virtual {
        for (uint i; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = SwaptobeLibrary.sortTokens(input, output);
            ISwaptobePair pair = ISwaptobePair(SwaptobeLibrary.pairFor(factory, input, output));
            uint amountInput;
            uint amountOutput;
            { // scope to avoid stack too deep errors
            (uint reserve0, uint reserve1,) = pair.getReserves();
            (uint reserveInput, uint reserveOutput) = input == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
            amountInput = ITBRC20(input).balanceOf(address(pair)).sub(reserveInput);
            amountOutput = SwaptobeLibrary.getAmountOut(amountInput, reserveInput, reserveOutput);
            }
            (uint amount0Out, uint amount1Out) = input == token0 ? (uint(0), amountOutput) : (amountOutput, uint(0));
            address to = i < path.length - 2 ? SwaptobeLibrary.pairFor(factory, output, path[i + 2]) : _to;
            pair.swap(amount0Out, amount1Out, to, new bytes(0));
        }
    }
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    ) external virtual override ensure(deadline) {
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, SwaptobeLibrary.pairFor(factory, path[0], path[1]), amountIn
        );
        uint balanceBefore = ITBRC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            ITBRC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'SwaptobeRouter: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactTOBEForTokensSupportingFeeOnTransferTokens(
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        payable
        ensure(deadline)
    {
        require(path[0] == WTOBE, 'SwaptobeRouter: INVALID_PATH');
        uint amountIn = msg.value;
        IWTOBE(WTOBE).deposit{value: amountIn}();
        assert(IWTOBE(WTOBE).transfer(SwaptobeLibrary.pairFor(factory, path[0], path[1]), amountIn));
        uint balanceBefore = ITBRC20(path[path.length - 1]).balanceOf(to);
        _swapSupportingFeeOnTransferTokens(path, to);
        require(
            ITBRC20(path[path.length - 1]).balanceOf(to).sub(balanceBefore) >= amountOutMin,
            'SwaptobeRouter: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    }
    function swapExactTokensForTOBESupportingFeeOnTransferTokens(
        uint amountIn,
        uint amountOutMin,
        address[] calldata path,
        address to,
        uint deadline
    )
        external
        virtual
        override
        ensure(deadline)
    {
        require(path[path.length - 1] == WTOBE, 'SwaptobeRouter: INVALID_PATH');
        TransferHelper.safeTransferFrom(
            path[0], msg.sender, SwaptobeLibrary.pairFor(factory, path[0], path[1]), amountIn
        );
        _swapSupportingFeeOnTransferTokens(path, address(this));
        uint amountOut = ITBRC20(WTOBE).balanceOf(address(this));
        require(amountOut >= amountOutMin, 'SwaptobeRouter: INSUFFICIENT_OUTPUT_AMOUNT');
        IWTOBE(WTOBE).withdraw(amountOut);
        TransferHelper.safeTransferTOBE(to, amountOut);
    }

    // **** LIBRARY FUNCTIONS ****
    function quote(uint amountA, uint reserveA, uint reserveB) public pure virtual override returns (uint amountB) {
        return SwaptobeLibrary.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint amountIn, uint reserveIn, uint reserveOut)
        public
        pure
        virtual
        override
        returns (uint amountOut)
    {
        return SwaptobeLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut)
        public
        pure
        virtual
        override
        returns (uint amountIn)
    {
        return SwaptobeLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint amountIn, address[] memory path)
        public
        view
        virtual
        override
        returns (uint[] memory amounts)
    {
        return SwaptobeLibrary.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint amountOut, address[] memory path)
        public
        view
        virtual
        override
        returns (uint[] memory amounts)
    {
        return SwaptobeLibrary.getAmountsIn(factory, amountOut, path);
    }
}

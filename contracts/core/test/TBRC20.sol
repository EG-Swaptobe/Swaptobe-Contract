// SPDX-License-Identifier: MIT
pragma solidity =0.5.16;

import '../SwaptobeTBRC20.sol';

contract TBRC20 is SwaptobeTBRC20 {
    constructor(uint _totalSupply) public {
        _mint(msg.sender, _totalSupply);
    }
}

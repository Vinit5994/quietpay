// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Temporary file so `forge build` has something to compile. Replaced by QuietPay.sol in A3.
contract Placeholder {
    IERC20 public immutable usdt;

    constructor(IERC20 usdt_) {
        usdt = usdt_;
    }
}

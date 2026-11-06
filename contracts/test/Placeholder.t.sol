// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Placeholder} from "../src/Placeholder.sol";

contract PlaceholderTest is Test {
    function test_stores_usdt() public {
        Placeholder p = new Placeholder(IERC20(address(0xBEEF)));
        assertEq(address(p.usdt()), address(0xBEEF));
    }
}

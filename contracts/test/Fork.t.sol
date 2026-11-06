// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console} from "forge-std/console.sol";
import {QuietPay} from "../src/QuietPay.sol";
import {ITetherV2} from "../src/interfaces/ITetherV2.sol";
import {SigHelpers} from "./Base.t.sol";

/// @notice One real `pay` against the official Whitechain Sepolia USDT (TetherTokenV2) on a fork.
/// @dev Runs only when WHITECHAIN_SEPOLIA_RPC_URL is set:
///      WHITECHAIN_SEPOLIA_RPC_URL=https://rpc.testnet.whitechain.io forge test --match-path test/Fork.t.sol -vv
contract ForkTest is SigHelpers {
    ITetherV2 constant USDT = ITetherV2(0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7);
    bytes32 constant USDT_DOMAIN_SEPARATOR = 0xcdcfacb6b15c8238b4e5fbb47bdb83b7f83f50a531d264bf9763d2bd1d3d2a25;
    uint256 constant PAYER_PK = 0xC0FFEE;
    uint256 constant SIGNER_PK = 0xB0B;
    uint256 constant AMOUNT = 1e6; // 1.00 USDT
    bytes32 constant ORDER_ID = keccak256("sess_fork");

    address payer = vm.addr(PAYER_PK);
    address payout = makeAddr("payout");
    QuietPay qp;
    uint256 merchantId;

    function test_fork_payWithRealUsdt() public {
        string memory rpc = vm.envOr("WHITECHAIN_SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            console.log("SKIP: set WHITECHAIN_SEPOLIA_RPC_URL to run the fork test");
            vm.skip(true);
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 1874, "not Whitechain Sepolia");
        assertEq(_tokenDomain(USDT), USDT_DOMAIN_SEPARATOR, "USDT domain separator changed");

        try this.dealUsdt(payer, 10e6) {}
        catch {
            console.log("SKIP: deal() could not set a USDT balance on the proxy");
            vm.skip(true);
        }
        assertEq(USDT.balanceOf(payer), 10e6);

        qp = new QuietPay(address(USDT), address(this));
        qp.setOperator(address(this), true);
        merchantId = qp.registerMerchant(payout, vm.addr(SIGNER_PK));

        _pay();

        assertEq(USDT.balanceOf(payout), AMOUNT);
        assertEq(USDT.balanceOf(payer), 10e6 - AMOUNT);
        assertEq(USDT.balanceOf(address(qp)), 0);
        assertTrue(USDT.authorizationState(payer, qp.paymentNonce(merchantId, ORDER_ID)), "nonce marked used");
    }

    function _pay() internal {
        uint256 exp = block.timestamp + 1800;
        bytes memory mSig = _signInvoice(qp, SIGNER_PK, merchantId, ORDER_ID, AMOUNT, exp);
        bytes memory pSig =
            _signReceive(USDT, PAYER_PK, address(qp), AMOUNT, 0, exp, qp.paymentNonce(merchantId, ORDER_ID));
        qp.pay(merchantId, ORDER_ID, AMOUNT, exp, mSig, payer, 0, exp, pSig);
    }

    /// @dev External so a failing `deal` can be caught.
    function dealUsdt(address to, uint256 amount) external {
        deal(address(USDT), to, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {QuietPay} from "../src/QuietPay.sol";
import {ITetherV2} from "../src/interfaces/ITetherV2.sol";

/// @dev EIP-712 signing helpers shared by the unit and fork tests. Every signature is a real `vm.sign`.
abstract contract SigHelpers is Test {
    bytes32 internal constant RECEIVE_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    function _sig(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _digest(bytes32 domainSeparator, bytes32 structHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
    }

    function _signReceive(
        ITetherV2 token,
        uint256 pk,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(RECEIVE_TYPEHASH, vm.addr(pk), to, value, validAfter, validBefore, nonce)
        );
        return _sig(pk, _digest(_tokenDomain(token), structHash));
    }

    function _signPermit(ITetherV2 token, uint256 pk, address spender, uint256 value, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        address owner = vm.addr(pk);
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, token.nonces(owner), deadline));
        return _sig(pk, _digest(_tokenDomain(token), structHash));
    }

    function _signInvoice(QuietPay qp, uint256 pk, uint256 merchantId, bytes32 orderId, uint256 amount, uint256 exp)
        internal
        view
        returns (bytes memory)
    {
        return _sig(pk, qp.invoiceDigest(merchantId, orderId, amount, exp));
    }

    function _signSubscribe(QuietPay qp, uint256 pk, uint256 planId, uint256 maxAmount, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        address subscriber = vm.addr(pk);
        bytes32 structHash = keccak256(
            abi.encode(qp.SUBSCRIBE_TYPEHASH(), planId, subscriber, maxAmount, qp.sigNonces(subscriber), deadline)
        );
        return _sig(pk, _digest(qp.domainSeparator(), structHash));
    }

    function _signCancel(QuietPay qp, uint256 pk, uint256 subId, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(qp.CANCEL_SUBSCRIPTION_TYPEHASH(), subId, qp.sigNonces(vm.addr(pk)), deadline)
        );
        return _sig(pk, _digest(qp.domainSeparator(), structHash));
    }

    /// @dev DOMAIN_SEPARATOR() exists on both TetherTokenV2 and OZ ERC20Permit.
    function _tokenDomain(ITetherV2 token) internal view returns (bytes32) {
        (bool ok, bytes memory data) = address(token).staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        require(ok, "no DOMAIN_SEPARATOR");
        return abi.decode(data, (bytes32));
    }
}

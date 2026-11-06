// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice The parts of TetherTokenV2 (Whitechain Sepolia USDT) that QuietPay uses.
/// @dev Uses the `bytes signature` overloads (EIP-2612 permit and EIP-3009 receiveWithAuthorization).
interface ITetherV2 is IERC20 {
    function permit(address owner, address spender, uint256 value, uint256 deadline, bytes calldata signature) external;

    /// @dev Reverts unless `msg.sender == to`, so only the recipient contract can redeem the authorization.
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external;

    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);

    function nonces(address owner) external view returns (uint256);

    function isBlocked(address account) external view returns (bool);
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {QuietPay} from "../src/QuietPay.sol";

/// @notice Deploys QuietPay, adds the relayer operators and writes deployments/<network>.json.
///
/// Env:
///   USDT       token address (default: official Whitechain Sepolia USDT)
///   OWNER      final owner (default: the deployer). If it differs from the deployer, ownership is
///              handed over with Ownable2Step and OWNER must call acceptOwnership().
///   RELAYER_A  Person A's API relayer (required)
///   RELAYER_B  Person B's API relayer (optional; add later with setOperator)
///
/// Run (keys stay in your shell):
///   forge script script/Deploy.s.sol:Deploy --rpc-url whitechain_sepolia --private-key $DEPLOYER_PK --broadcast
contract Deploy is Script {
    address constant WHITECHAIN_SEPOLIA_USDT = 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7;

    function run() external returns (QuietPay qp) {
        address usdt = vm.envOr("USDT", WHITECHAIN_SEPOLIA_USDT);
        address relayerA = vm.envAddress("RELAYER_A");
        address relayerB = vm.envOr("RELAYER_B", address(0));

        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        address owner = vm.envOr("OWNER", deployer);

        console.log("chainId   ", block.chainid);
        console.log("deployer  ", deployer);
        console.log("owner     ", owner);
        console.log("usdt      ", usdt);
        console.log("relayer A ", relayerA);
        console.log("relayer B ", relayerB);

        // The deployer owns the contract while it sets operators, then hands over if OWNER differs.
        console.log("-> deploy QuietPay(usdt, deployer)");
        qp = new QuietPay(usdt, deployer);
        console.log("-> QuietPay.setOperator(relayerA, true) on", address(qp));
        qp.setOperator(relayerA, true);
        if (relayerB != address(0)) {
            console.log("-> QuietPay.setOperator(relayerB, true) on", address(qp));
            qp.setOperator(relayerB, true);
        }
        if (owner != deployer) {
            console.log("-> QuietPay.transferOwnership(owner); OWNER must call acceptOwnership()");
            qp.transferOwnership(owner);
        }
        vm.stopBroadcast();

        // Start block for the indexer. Scripts simulate on the latest block, so the real deploy block is >= this.
        uint256 deployBlock = block.number;
        string memory json = "deployment";
        vm.serializeAddress(json, "QuietPay", address(qp));
        vm.serializeAddress(json, "usdt", usdt);
        vm.serializeUint(json, "chainId", block.chainid);
        string memory out = vm.serializeUint(json, "deployBlock", deployBlock);

        string memory path = block.chainid == 1874
            ? "deployments/whitechain-sepolia.json"
            : string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);

        console.log("QuietPay  ", address(qp));
        console.log("block     ", deployBlock);
        console.log("written   ", path);
    }
}

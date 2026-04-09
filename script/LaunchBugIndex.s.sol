// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { CheapBugsBugIndex } from "../contracts/CheapBugsBugIndex.sol";

contract LaunchBugIndex is Script {
    function run() external returns (CheapBugsBugIndex deployed) {
        uint256 deployerPrivateKey = vm.envUint("BUG_INDEX_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("BUG_INDEX_OWNER", deployer);
        string memory reviewersCsv = vm.envOr("BUG_INDEX_INITIAL_REVIEWERS", string(""));
        address[] memory initialReviewers =
            bytes(reviewersCsv).length == 0 ? new address[](0) : vm.envAddress("BUG_INDEX_INITIAL_REVIEWERS", ",");

        vm.startBroadcast(deployerPrivateKey);
        deployed = new CheapBugsBugIndex(owner, initialReviewers);
        vm.stopBroadcast();

        console2.log("CheapBugsBugIndex deployed:");
        console2.logAddress(address(deployed));
        console2.log("Owner:");
        console2.logAddress(owner);
        console2.log("Initial reviewer count:");
        console2.logUint(initialReviewers.length);
    }
}

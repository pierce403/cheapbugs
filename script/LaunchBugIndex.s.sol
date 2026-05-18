// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { CheapBugsBugIndex, IBondVault, ITreasuryVault } from "../contracts/CheapBugsBugIndex.sol";

contract LaunchBugIndex is Script {
    function run() external returns (CheapBugsBugIndex deployed) {
        uint256 deployerPrivateKey = vm.envUint("BUG_INDEX_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("BUG_INDEX_OWNER", deployer);
        address bondVault = vm.envAddress("BUG_INDEX_BOND_VAULT_ADDRESS");
        address treasuryVault = vm.envAddress("BUG_INDEX_TREASURY_VAULT_ADDRESS");
        string memory brokersCsv = vm.envOr("BUG_INDEX_INITIAL_BROKERS", string(""));
        address[] memory initialBrokers =
            bytes(brokersCsv).length == 0 ? new address[](0) : vm.envAddress("BUG_INDEX_INITIAL_BROKERS", ",");
        string memory adminsCsv = vm.envOr("BUG_INDEX_INITIAL_ADMINS", string(""));
        address[] memory initialAdmins =
            bytes(adminsCsv).length == 0 ? new address[](0) : vm.envAddress("BUG_INDEX_INITIAL_ADMINS", ",");

        vm.startBroadcast(deployerPrivateKey);
        deployed =
            new CheapBugsBugIndex(owner, IBondVault(bondVault), ITreasuryVault(treasuryVault), initialBrokers, initialAdmins);
        vm.stopBroadcast();

        console2.log("CheapBugsBugIndex deployed:");
        console2.logAddress(address(deployed));
        console2.log("Owner:");
        console2.logAddress(owner);
        console2.log("Bond vault:");
        console2.logAddress(bondVault);
        console2.log("Treasury vault:");
        console2.logAddress(treasuryVault);
        console2.log("Initial broker count:");
        console2.logUint(initialBrokers.length);
        console2.log("Initial admin count:");
        console2.logUint(initialAdmins.length);
    }
}

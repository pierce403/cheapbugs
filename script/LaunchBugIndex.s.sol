// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script } from "forge-std/Script.sol";
import { console2 } from "forge-std/console2.sol";

import { CheapBugsBondVault } from "../contracts/CheapBugsBondVault.sol";
import { CheapBugsBugIndex, ICheapBugsBondVault, ICheapBugsTreasuryVault } from "../contracts/CheapBugsBugIndex.sol";
import { CheapBugsTreasuryVault } from "../contracts/CheapBugsTreasuryVault.sol";

contract LaunchBugIndex is Script {
    address private constant DEFAULT_CONTRACT_OWNER = 0x7ab874Eeef0169ADA0d225E9801A3FfFfa26aAC3;

    function run()
        external
        returns (CheapBugsBugIndex index, CheapBugsBondVault bondVault, CheapBugsTreasuryVault treasuryVault)
    {
        string memory deployerKeyValue = vm.envOr("BUG_INDEX_DEPLOYER_PRIVATE_KEY", string(""));
        bool usingBrokerKey = bytes(deployerKeyValue).length == 0;
        uint256 deployerPrivateKey = usingBrokerKey ? vm.envUint("BROKER_KEY") : vm.envUint("BUG_INDEX_DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address owner = vm.envOr("BUG_INDEX_OWNER", DEFAULT_CONTRACT_OWNER);
        string memory brokersCsv = vm.envOr("BUG_INDEX_INITIAL_BROKERS", string(""));
        address[] memory initialBrokers;
        if (bytes(brokersCsv).length == 0) {
            initialBrokers = new address[](usingBrokerKey ? 1 : 0);
            if (usingBrokerKey) {
                initialBrokers[0] = deployer;
            }
        } else {
            initialBrokers = vm.envAddress("BUG_INDEX_INITIAL_BROKERS", ",");
        }
        string memory adminsCsv = vm.envOr("BUG_INDEX_INITIAL_ADMINS", string(""));
        address[] memory initialAdmins =
            bytes(adminsCsv).length == 0 ? new address[](0) : vm.envAddress("BUG_INDEX_INITIAL_ADMINS", ",");
        string memory slashersCsv = vm.envOr("BUG_INDEX_INITIAL_SLASHERS", string(""));
        address[] memory initialSlashers =
            bytes(slashersCsv).length == 0 ? new address[](0) : vm.envAddress("BUG_INDEX_INITIAL_SLASHERS", ",");

        vm.startBroadcast(deployerPrivateKey);
        treasuryVault = new CheapBugsTreasuryVault(deployer);
        bondVault = new CheapBugsBondVault(address(treasuryVault), deployer);
        index = new CheapBugsBugIndex(
            deployer,
            ICheapBugsBondVault(address(bondVault)),
            ICheapBugsTreasuryVault(address(treasuryVault)),
            initialBrokers,
            initialAdmins
        );
        treasuryVault.setIndex(address(index));
        for (uint256 i = 0; i < initialBrokers.length; i++) {
            treasuryVault.setBroker(initialBrokers[i], true);
        }
        for (uint256 i = 0; i < initialSlashers.length; i++) {
            bondVault.setSlasher(initialSlashers[i], true);
        }
        if (owner != deployer) {
            treasuryVault.transferOwnership(owner);
            bondVault.transferOwnership(owner);
            index.transferOwnership(owner);
        }
        vm.stopBroadcast();

        console2.log("CheapBugsBugIndex deployed:");
        console2.logAddress(address(index));
        console2.log("CheapBugsBondVault deployed:");
        console2.logAddress(address(bondVault));
        console2.log("CheapBugsTreasuryVault deployed:");
        console2.logAddress(address(treasuryVault));
        console2.log("Owner:");
        console2.logAddress(owner);
        console2.log("Deployer key source:");
        console2.log(usingBrokerKey ? "BROKER_KEY" : "BUG_INDEX_DEPLOYER_PRIVATE_KEY");
        console2.log("Initial broker count:");
        console2.logUint(initialBrokers.length);
        console2.log("Initial admin count:");
        console2.logUint(initialAdmins.length);
        console2.log("Initial slasher count:");
        console2.logUint(initialSlashers.length);
    }
}

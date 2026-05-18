// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StdInvariant } from "forge-std/StdInvariant.sol";
import { Test } from "forge-std/Test.sol";

import { BondVault } from "../contracts/BondVault.sol";
import { MockBugzToken } from "./MockBugzToken.sol";

contract BondVaultHandler is Test {
    BondVault public immutable vault;
    MockBugzToken public immutable token;
    address public immutable slasher;

    address[] public users;

    constructor(BondVault vault_, MockBugzToken token_, address slasher_, address[] memory users_) {
        vault = vault_;
        token = token_;
        slasher = slasher_;
        users = users_;
    }

    function bond(uint8 userSeed, uint96 rawAmount) external {
        address user = _user(userSeed);
        uint256 amount = bound(uint256(rawAmount), 1, 1_000_000_000 ether);

        token.mint(user, amount);
        vm.startPrank(user);
        token.approve(address(vault), amount);
        vault.bond(amount);
        vm.stopPrank();
    }

    function requestWithdrawal(uint8 userSeed, uint96 rawAmount) external {
        address user = _user(userSeed);
        uint256 active = vault.activeBondOf(user);
        if (active == 0) {
            return;
        }

        uint256 amount = bound(uint256(rawAmount), 1, active);
        vm.prank(user);
        vault.requestWithdrawal(amount);
    }

    function withdraw(uint8 userSeed) external {
        address user = _user(userSeed);
        if (vault.pendingWithdrawalOf(user) == 0) {
            return;
        }

        vm.warp(uint256(vault.withdrawAvailableAt(user)));
        vm.prank(user);
        vault.withdraw();
    }

    function slash(uint8 userSeed, uint16 rawSlashBps) external {
        address user = _user(userSeed);
        uint256 totalBond = vault.bondOf(user);
        if (totalBond == 0) {
            return;
        }

        uint16 slashBps = uint16(bound(rawSlashBps, 1, 10_000));
        if ((totalBond * slashBps) / 10_000 == 0) {
            return;
        }

        vm.prank(slasher);
        vault.slash(user, slashBps);
    }

    function userCount() external view returns (uint256) {
        return users.length;
    }

    function _user(uint8 userSeed) private view returns (address) {
        return users[uint256(userSeed) % users.length];
    }
}

contract BondVaultInvariantTest is StdInvariant, Test {
    MockBugzToken internal token;
    BondVault internal vault;
    BondVaultHandler internal handler;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal slasher = makeAddr("slasher");

    function setUp() public {
        token = new MockBugzToken();
        vault = new BondVault(token, treasury, owner);
        vm.prank(owner);
        vault.setSlasher(slasher, true);

        address[] memory users = new address[](4);
        users[0] = makeAddr("invariant-user-0");
        users[1] = makeAddr("invariant-user-1");
        users[2] = makeAddr("invariant-user-2");
        users[3] = makeAddr("invariant-user-3");

        handler = new BondVaultHandler(vault, token, slasher, users);

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = BondVaultHandler.bond.selector;
        selectors[1] = BondVaultHandler.requestWithdrawal.selector;
        selectors[2] = BondVaultHandler.withdraw.selector;
        selectors[3] = BondVaultHandler.slash.selector;

        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    function invariant_vaultBalanceEqualsListedBondExposure() public view {
        uint256 listedExposure = 0;
        uint256 count = vault.bondedAddressCount();

        for (uint256 i = 0; i < count; i++) {
            address account = vault.bondedAddressAt(i);
            uint256 bond = vault.bondOf(account);
            assertGt(bond, 0);
            listedExposure += bond;

            for (uint256 j = i + 1; j < count; j++) {
                assertNotEq(account, vault.bondedAddressAt(j));
            }
        }

        assertEq(token.balanceOf(address(vault)), listedExposure);
    }
}

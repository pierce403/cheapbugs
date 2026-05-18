// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { BondVault } from "../contracts/BondVault.sol";
import { MockBugzToken } from "./MockBugzToken.sol";

contract BondVaultTest is Test {
    uint256 internal constant BUGZ = 1e18;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal slasher = makeAddr("slasher");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    MockBugzToken internal token;
    BondVault internal vault;

    function setUp() public {
        token = new MockBugzToken();
        vault = new BondVault(token, treasury, owner);
        vm.prank(owner);
        vault.setSlasher(slasher, true);
    }

    function test_bondStoresActiveBondAndEnumeratesBondedAddress() public {
        _bond(alice, 1_000 * BUGZ);

        assertEq(vault.activeBondOf(alice), 1_000 * BUGZ);
        assertEq(vault.pendingWithdrawalOf(alice), 0);
        assertEq(vault.bondOf(alice), 1_000 * BUGZ);
        assertEq(vault.getLevel(alice), 3);
        assertEq(vault.bondedAddressCount(), 1);
        assertEq(vault.bondedAddressAt(0), alice);

        address[] memory page = vault.bondedAddressList(0, 10);
        assertEq(page.length, 1);
        assertEq(page[0], alice);
    }

    function test_requestWithdrawalMovesActiveToPendingAndExcludesPendingFromLevel() public {
        _bond(alice, 1_000 * BUGZ);

        vm.prank(alice);
        vault.requestWithdrawal(991 * BUGZ);

        assertEq(vault.activeBondOf(alice), 9 * BUGZ);
        assertEq(vault.pendingWithdrawalOf(alice), 991 * BUGZ);
        assertEq(vault.bondOf(alice), 1_000 * BUGZ);
        assertEq(vault.getLevel(alice), 0);
        assertEq(vault.withdrawAvailableAt(alice), block.timestamp + 7 days);
        assertEq(vault.bondedAddressCount(), 1);
    }

    function test_newBondCancelsPendingWithdrawal() public {
        _bond(alice, 1_000 * BUGZ);

        vm.prank(alice);
        vault.requestWithdrawal(500 * BUGZ);

        _mintAndApprove(alice, 100 * BUGZ);
        vm.prank(alice);
        vault.bond(100 * BUGZ);

        assertEq(vault.activeBondOf(alice), 1_100 * BUGZ);
        assertEq(vault.pendingWithdrawalOf(alice), 0);
        assertEq(vault.withdrawAvailableAt(alice), 0);
    }

    function test_withdrawRequiresDelayAndRemovesEmptyBondedAddress() public {
        _bond(alice, 100 * BUGZ);

        vm.prank(alice);
        vault.requestWithdrawal(100 * BUGZ);

        vm.expectRevert(abi.encodeWithSelector(BondVault.WithdrawalNotReady.selector, uint64(block.timestamp + 7 days)));
        vm.prank(alice);
        vault.withdraw();

        vm.warp(block.timestamp + 7 days);
        vm.prank(alice);
        vault.withdraw();

        assertEq(token.balanceOf(alice), 100 * BUGZ);
        assertEq(vault.bondOf(alice), 0);
        assertEq(vault.bondedAddressCount(), 0);
    }

    function test_slashIncludesPendingWithdrawalsAndSendsBugzToTreasury() public {
        _bond(alice, 1_000 * BUGZ);
        vm.prank(alice);
        vault.requestWithdrawal(600 * BUGZ);

        vm.prank(slasher);
        uint256 slashed = vault.slash(alice, 5_000);

        assertEq(slashed, 500 * BUGZ);
        assertEq(token.balanceOf(treasury), 500 * BUGZ);
        assertEq(vault.activeBondOf(alice), 400 * BUGZ);
        assertEq(vault.pendingWithdrawalOf(alice), 100 * BUGZ);
        assertEq(vault.bondOf(alice), 500 * BUGZ);
        assertEq(vault.bondedAddressCount(), 1);
    }

    function test_fullSlashRemovesBondedAddress() public {
        _bond(alice, 100 * BUGZ);
        _bond(bob, 200 * BUGZ);

        vm.prank(slasher);
        vault.slash(alice, 10_000);

        assertEq(vault.bondOf(alice), 0);
        assertEq(token.balanceOf(treasury), 100 * BUGZ);
        assertEq(vault.bondedAddressCount(), 1);
        assertEq(vault.bondedAddressAt(0), bob);
    }

    function test_slashRejectsNonSlasherAndBadBps() public {
        _bond(alice, 100 * BUGZ);

        vm.expectRevert(BondVault.NotSlasher.selector);
        vm.prank(bob);
        vault.slash(alice, 1);

        vm.expectRevert(abi.encodeWithSelector(BondVault.InvalidSlashBps.selector, uint16(10_001)));
        vm.prank(slasher);
        vault.slash(alice, 10_001);
    }

    function test_ownerCanRemoveSlasher() public {
        _bond(alice, 100 * BUGZ);

        vm.prank(owner);
        vault.setSlasher(slasher, false);

        assertFalse(vault.slashers(slasher));
        vm.expectRevert(BondVault.NotSlasher.selector);
        vm.prank(slasher);
        vault.slash(alice, 1_000);
    }

    function testFuzz_getLevelUsesOnlyActiveBond(uint256 active, uint256 pending) public {
        active = bound(active, 0, 1_000_000_000 * BUGZ);
        pending = bound(pending, 0, 1_000_000_000 * BUGZ);
        vm.assume(active + pending > 0);

        _bond(alice, active + pending);
        if (pending != 0) {
            vm.prank(alice);
            vault.requestWithdrawal(pending);
        }

        assertEq(vault.getLevel(alice), _log10(active / BUGZ));
    }

    function testFuzz_slashMovesExactPercentageToTreasury(uint256 totalBond, uint16 slashBps) public {
        totalBond = bound(totalBond, 10_000, 1_000_000_000 * BUGZ);
        slashBps = uint16(bound(slashBps, 1, 10_000));
        uint256 expected = (totalBond * slashBps) / 10_000;

        _bond(alice, totalBond);

        vm.prank(slasher);
        uint256 actual = vault.slash(alice, slashBps);

        assertEq(actual, expected);
        assertEq(token.balanceOf(treasury), expected);
        assertEq(vault.bondOf(alice), totalBond - expected);
        assertEq(token.balanceOf(address(vault)), totalBond - expected);
    }

    function _bond(address account, uint256 amount) internal {
        _mintAndApprove(account, amount);
        vm.prank(account);
        vault.bond(amount);
    }

    function _mintAndApprove(address account, uint256 amount) internal {
        token.mint(account, amount);
        vm.prank(account);
        token.approve(address(vault), amount);
    }

    function _log10(uint256 value) internal pure returns (uint8 level) {
        while (value >= 10) {
            value /= 10;
            level++;
        }
    }
}

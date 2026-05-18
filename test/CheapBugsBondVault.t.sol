// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { CheapBugsBondVault } from "../contracts/CheapBugsBondVault.sol";
import { MockBugzToken } from "./MockBugzToken.sol";

contract CheapBugsBondVaultTest is Test {
    address internal constant BUGZ_TOKEN_ADDRESS = 0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07;
    uint256 internal constant BUGZ = 1e18;

    address internal owner = makeAddr("owner");
    address internal treasury = makeAddr("treasury");
    address internal slasher = makeAddr("slasher");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    MockBugzToken internal token;
    CheapBugsBondVault internal vault;

    function setUp() public {
        token = _installMockBugzToken();
        vault = new CheapBugsBondVault(treasury, owner);
        vm.prank(owner);
        vault.setSlasher(slasher, true);
    }

    function test_constructorAndOwnerSettersRejectZeroAddressesAndUnauthorizedCalls() public {
        vm.expectRevert(CheapBugsBondVault.InvalidAddress.selector);
        new CheapBugsBondVault(address(0), owner);

        vm.expectRevert();
        vm.prank(alice);
        vault.setTreasury(alice);

        vm.expectRevert();
        vm.prank(alice);
        vault.setSlasher(alice, true);

        vm.expectRevert(CheapBugsBondVault.InvalidAddress.selector);
        vm.prank(owner);
        vault.setTreasury(address(0));

        vm.expectRevert(CheapBugsBondVault.InvalidAddress.selector);
        vm.prank(owner);
        vault.setSlasher(address(0), true);
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

    function test_rejectsZeroBondZeroWithdrawalOverWithdrawalAndMissingPendingWithdrawal() public {
        vm.expectRevert(CheapBugsBondVault.InvalidAmount.selector);
        vm.prank(alice);
        vault.bond(0);

        _bond(alice, 100 * BUGZ);

        vm.expectRevert(CheapBugsBondVault.InvalidAmount.selector);
        vm.prank(alice);
        vault.requestWithdrawal(0);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBondVault.InsufficientActiveBond.selector, 101 * BUGZ, 100 * BUGZ));
        vm.prank(alice);
        vault.requestWithdrawal(101 * BUGZ);

        vm.expectRevert(CheapBugsBondVault.NoPendingWithdrawal.selector);
        vm.prank(bob);
        vault.withdraw();
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

    function test_newBondCancelsPendingWithdrawalEvenAfterDelayHasElapsed() public {
        _bond(alice, 1_000 * BUGZ);
        vm.prank(alice);
        vault.requestWithdrawal(500 * BUGZ);
        vm.warp(block.timestamp + 7 days);

        _mintAndApprove(alice, 1 * BUGZ);
        vm.prank(alice);
        vault.bond(1 * BUGZ);

        assertEq(vault.activeBondOf(alice), 1_001 * BUGZ);
        assertEq(vault.pendingWithdrawalOf(alice), 0);
        assertEq(vault.withdrawAvailableAt(alice), 0);
    }

    function test_multipleWithdrawalRequestsResetDelayAndKeepPendingSlashable() public {
        _bond(alice, 1_000 * BUGZ);

        vm.prank(alice);
        vault.requestWithdrawal(100 * BUGZ);
        uint64 firstAvailableAt = vault.withdrawAvailableAt(alice);

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        vault.requestWithdrawal(200 * BUGZ);

        assertEq(vault.pendingWithdrawalOf(alice), 300 * BUGZ);
        assertEq(vault.withdrawAvailableAt(alice), firstAvailableAt + 1 days);

        vm.prank(slasher);
        vault.slash(alice, 1_000);

        assertEq(vault.pendingWithdrawalOf(alice), 200 * BUGZ);
        assertEq(vault.activeBondOf(alice), 700 * BUGZ);
        assertEq(token.balanceOf(treasury), 100 * BUGZ);
    }

    function test_withdrawRequiresDelayAndRemovesEmptyBondedAddress() public {
        _bond(alice, 100 * BUGZ);

        vm.prank(alice);
        vault.requestWithdrawal(100 * BUGZ);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBondVault.WithdrawalNotReady.selector, uint64(block.timestamp + 7 days)));
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

    function test_slashCanStillTakeReadyPendingWithdrawalBeforeUserClaims() public {
        _bond(alice, 100 * BUGZ);
        vm.prank(alice);
        vault.requestWithdrawal(100 * BUGZ);
        vm.warp(block.timestamp + 7 days);

        vm.prank(slasher);
        vault.slash(alice, 10_000);

        assertEq(vault.bondOf(alice), 0);
        assertEq(vault.pendingWithdrawalOf(alice), 0);
        assertEq(vault.withdrawAvailableAt(alice), 0);
        assertEq(token.balanceOf(treasury), 100 * BUGZ);

        vm.expectRevert(CheapBugsBondVault.NoPendingWithdrawal.selector);
        vm.prank(alice);
        vault.withdraw();
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

        vm.expectRevert(CheapBugsBondVault.NotSlasher.selector);
        vm.prank(bob);
        vault.slash(alice, 1);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBondVault.InvalidSlashBps.selector, uint16(10_001)));
        vm.prank(slasher);
        vault.slash(alice, 10_001);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBondVault.InvalidSlashBps.selector, uint16(0)));
        vm.prank(slasher);
        vault.slash(alice, 0);

        _bond(bob, 1);
        vm.expectRevert(CheapBugsBondVault.InvalidAmount.selector);
        vm.prank(slasher);
        vault.slash(bob, 1);
    }

    function test_ownerCanRemoveSlasher() public {
        _bond(alice, 100 * BUGZ);

        vm.prank(owner);
        vault.setSlasher(slasher, false);

        assertFalse(vault.slashers(slasher));
        vm.expectRevert(CheapBugsBondVault.NotSlasher.selector);
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

    function _installMockBugzToken() internal returns (MockBugzToken) {
        MockBugzToken implementation = new MockBugzToken();
        vm.etch(BUGZ_TOKEN_ADDRESS, address(implementation).code);
        return MockBugzToken(BUGZ_TOKEN_ADDRESS);
    }

    function _log10(uint256 value) internal pure returns (uint8 level) {
        while (value >= 10) {
            value /= 10;
            level++;
        }
    }
}

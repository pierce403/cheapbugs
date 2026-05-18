// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { TreasuryVault } from "../contracts/TreasuryVault.sol";
import { MockBugzToken } from "./MockBugzToken.sol";

contract TreasuryVaultTest is Test {
    uint256 internal constant BUGZ = 1e18;

    address internal owner = makeAddr("owner");
    address internal broker = makeAddr("broker");
    address internal buyer = makeAddr("buyer");
    address internal recipient = makeAddr("recipient");
    address internal index = address(this);

    MockBugzToken internal token;
    TreasuryVault internal vault;

    function setUp() public {
        token = new MockBugzToken();
        vault = new TreasuryVault(token, owner);

        vm.startPrank(owner);
        vault.setIndex(index);
        vault.setBroker(broker, true);
        vm.stopPrank();
    }

    function test_depositAndDetailKeyPurchaseMoveBugzIntoTreasury() public {
        token.mint(owner, 1_000 * BUGZ);
        vm.startPrank(owner);
        token.approve(address(vault), 1_000 * BUGZ);
        vault.deposit(1_000 * BUGZ);
        vm.stopPrank();

        bytes32 reportHash = keccak256("report");
        token.mint(buyer, 25 * BUGZ);
        vm.startPrank(buyer);
        token.approve(address(vault), 25 * BUGZ);
        vault.purchaseDetailKey(reportHash, 10 * BUGZ);
        vault.purchaseDetailKey(reportHash, 15 * BUGZ);
        vm.stopPrank();

        assertEq(token.balanceOf(address(vault)), 1_025 * BUGZ);
        assertEq(vault.detailKeyPayments(reportHash, buyer), 25 * BUGZ);
        assertEq(vault.detailKeyPurchaseCount(), 2);

        TreasuryVault.DetailKeyPurchase memory purchase = vault.detailKeyPurchaseAt(1);
        assertEq(purchase.reportHash, reportHash);
        assertEq(purchase.buyer, buyer);
        assertEq(purchase.amount, 15 * BUGZ);
        assertEq(purchase.totalPaid, 25 * BUGZ);
        assertEq(purchase.createdAt, block.timestamp);
    }

    function test_ownerCanAddAndRemoveBrokers() public {
        assertTrue(vault.brokers(broker));
        assertEq(vault.brokerCount(), 1);
        assertEq(vault.brokerAt(0), broker);

        vm.prank(owner);
        vault.setBroker(broker, false);

        assertFalse(vault.brokers(broker));
        assertEq(vault.brokerCount(), 0);
    }

    function test_payRewardOnlyIndexAndOnlyTreasuryBroker() public {
        _fundTreasury(100_000 * BUGZ);

        vm.expectRevert(TreasuryVault.NotIndex.selector);
        vm.prank(broker);
        vault.payRewardFromIndex(broker, recipient, 1);

        vm.prank(owner);
        vault.setBroker(broker, false);

        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.NotBroker.selector, broker));
        vault.payRewardFromIndex(broker, recipient, 1);
    }

    function test_payRewardUsesCurrentBalanceDivisorAndMultiplier() public {
        _fundTreasury(100_000 * BUGZ);

        uint256 expected = 300 * BUGZ;
        uint256 paid = vault.payRewardFromIndex(broker, recipient, 3);

        assertEq(paid, expected);
        assertEq(token.balanceOf(recipient), expected);
        assertEq(token.balanceOf(address(vault)), 99_700 * BUGZ);
    }

    function test_ownerCanAdjustPayoutDivisor() public {
        _fundTreasury(100_000 * BUGZ);

        vm.prank(owner);
        vault.setStandardPayoutDivisor(2_000);

        assertEq(vault.calculateRewardAmount(2), 100 * BUGZ);
    }

    function test_rejectsBadMultiplierAndDivisor() public {
        vm.expectRevert(abi.encodeWithSelector(TreasuryVault.InvalidMultiplier.selector, uint8(11)));
        vault.calculateRewardAmount(11);

        vm.expectRevert(TreasuryVault.InvalidPayoutDivisor.selector);
        vm.prank(owner);
        vault.setStandardPayoutDivisor(0);
    }

    function testFuzz_rewardMath(uint256 balance, uint256 divisor, uint8 multiplier) public {
        balance = bound(balance, 0, 1_000_000_000 * BUGZ);
        divisor = bound(divisor, 1, 1_000_000);
        multiplier = uint8(bound(multiplier, 0, 10));

        if (balance != 0) {
            _fundTreasury(balance);
        }
        vm.prank(owner);
        vault.setStandardPayoutDivisor(divisor);

        assertEq(vault.calculateRewardAmount(multiplier), (balance / divisor) * multiplier);
    }

    function _fundTreasury(uint256 amount) internal {
        token.mint(owner, amount);
        vm.startPrank(owner);
        token.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
    }
}

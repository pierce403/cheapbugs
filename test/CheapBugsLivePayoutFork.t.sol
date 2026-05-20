// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";

import { CheapBugsBugIndex } from "../contracts/CheapBugsBugIndex.sol";
import { CheapBugsTreasuryVault } from "../contracts/CheapBugsTreasuryVault.sol";

contract CheapBugsLivePayoutForkTest is Test {
    address internal constant LIVE_INDEX = 0x515FDbc9876aC26870794E26605c7DD04c18679b;
    address internal constant LIVE_TREASURY = 0x4A080668d9848928dc6D48921cbDc4273fe27A9d;
    address internal constant LIVE_BUGZ = 0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07;
    address internal constant DEFAULT_BROKER = 0xEA6995Fc3674E1E94736766F5EEeFB0506e4eF32;

    CheapBugsBugIndex internal index = CheapBugsBugIndex(LIVE_INDEX);
    CheapBugsTreasuryVault internal treasury = CheapBugsTreasuryVault(LIVE_TREASURY);

    function test_liveForkDiagnosesPayoutReadiness() public {
        _selectLiveForkOrSkip();

        uint256 reportCount = index.reportCount();
        uint256 cursor = index.nextPayoutIndex();
        address broker = _configuredBroker();

        console2.log("live index", LIVE_INDEX);
        console2.log("report count", reportCount);
        console2.log("next payout index", cursor);
        console2.log("broker", broker);
        uint256 adminCount = index.adminCount();
        console2.log("index admin count", adminCount);
        console2.log("treasury BUGZ", _bugz().balanceOf(LIVE_TREASURY));

        assertGt(reportCount, cursor, "live index has no unpaid reports to rehearse");
        bool ready = true;
        if (address(index.treasuryVault()) != LIVE_TREASURY) {
            console2.log("problem: index treasuryVault wiring is not the live treasury");
            ready = false;
        }
        if (treasury.index() != LIVE_INDEX) {
            console2.log("problem: treasury index wiring is not the live index");
            ready = false;
        }
        if (!index.brokers(broker)) {
            console2.log("problem: broker needs index broker permission");
            ready = false;
        }
        if (!treasury.brokers(broker)) {
            console2.log("problem: broker needs treasury broker permission");
            ready = false;
        }
        if (adminCount == 0) {
            console2.log("problem: index has no admins; owner must setAdmin before reports can be flagged");
            ready = false;
        }

        for (uint256 i = cursor; i < reportCount; i++) {
            bytes32 reportHash = index.reportHashAt(i);
            CheapBugsBugIndex.Bug memory bug = index.getReport(reportHash);
            console2.log("unpaid report", i);
            console2.logBytes32(reportHash);
            console2.log("report id", bug.reportId);
            console2.log("revealAfter", uint256(bug.revealAfter));
            console2.log("status", uint256(bug.status));
            console2.log("details revealed", bug.detailsKeyRevealed);
            if (bug.status == CheapBugsBugIndex.BugStatus.Unreviewed) {
                console2.log("problem: report must be flagged Valid, Invalid, or Spam before payout");
                ready = false;
            }
        }

        assertTrue(ready, "live payout readiness blockers found; see logs");
    }

    function test_liveForkSimulatesOrderedPayoutsFromSnapshot() public {
        _selectLiveForkOrSkip();

        uint256 reportCount = index.reportCount();
        uint256 cursor = index.nextPayoutIndex();
        uint256 unpaidCount = reportCount - cursor;
        bytes32[] memory detailsKeys = vm.envOr("CHEAPBUGS_LIVE_PAYOUT_DETAIL_KEYS", ",", new bytes32[](0));
        vm.skip(
            detailsKeys.length == 0,
            "set CHEAPBUGS_LIVE_PAYOUT_DETAIL_KEYS to comma-delimited raw bytes32 keys in payout order"
        );
        assertEq(detailsKeys.length, unpaidCount, "details key count must equal unpaid report count");

        uint256 snapshotId = vm.snapshotState();
        address broker = _configuredBroker();
        address admin = vm.envOr("CHEAPBUGS_LIVE_PAYOUT_ADMIN", address(this));
        uint256[] memory statuses = vm.envOr("CHEAPBUGS_LIVE_PAYOUT_STATUSES", ",", new uint256[](0));
        uint256[] memory multipliers = vm.envOr("CHEAPBUGS_LIVE_PAYOUT_MULTIPLIERS", ",", new uint256[](0));
        if (statuses.length != 0) {
            assertEq(statuses.length, unpaidCount, "status count must equal unpaid report count");
        }
        if (multipliers.length != 0) {
            assertEq(multipliers.length, unpaidCount, "multiplier count must equal unpaid report count");
        }

        _ensureForkOnlyPermissions(broker, admin);

        uint64 maxRevealAfter = 0;
        for (uint256 i = 0; i < unpaidCount; i++) {
            bytes32 reportHash = index.reportHashAt(cursor + i);
            CheapBugsBugIndex.Bug memory bug = index.getReport(reportHash);
            if (bug.revealAfter > maxRevealAfter) {
                maxRevealAfter = bug.revealAfter;
            }

            CheapBugsBugIndex.BugStatus status = _statusAt(statuses, i);
            if (bug.status != status) {
                vm.prank(admin);
                index.flagBug(reportHash, status);
            }
        }

        vm.warp(uint256(maxRevealAfter) + 1);

        for (uint256 i = 0; i < unpaidCount; i++) {
            bytes32 reportHash = index.reportHashAt(cursor + i);
            CheapBugsBugIndex.Bug memory bug = index.getReport(reportHash);
            uint8 multiplier = _multiplierAt(multipliers, i, bug.status);
            uint256 reporterBalanceBefore = _bugz().balanceOf(bug.reporter);

            vm.prank(broker);
            index.completePayout(reportHash, multiplier, detailsKeys[i]);

            CheapBugsBugIndex.Bug memory paid = index.getReport(reportHash);
            assertTrue(paid.payoutCompleted, "report payout should complete");
            assertTrue(paid.detailsKeyRevealed, "report key should be revealed");
            assertEq(_bugz().balanceOf(bug.reporter) - reporterBalanceBefore, paid.payoutAmount);
            console2.log("paid report", i);
            console2.logBytes32(reportHash);
            console2.log("multiplier", multiplier);
            console2.log("amount", paid.payoutAmount);
        }

        assertEq(index.nextPayoutIndex(), reportCount, "all unpaid reports should be completed");
        assertTrue(vm.revertToStateAndDelete(snapshotId), "snapshot rollback failed");
        assertEq(index.nextPayoutIndex(), cursor, "snapshot rollback should restore payout cursor");
    }

    function _selectLiveForkOrSkip() private {
        bool enabled = vm.envOr("CHEAPBUGS_LIVE_PAYOUT_FORK", false);
        vm.skip(!enabled, "set CHEAPBUGS_LIVE_PAYOUT_FORK=1 to run the live Base fork payout rehearsal");
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl);
    }

    function _configuredBroker() private view returns (address) {
        return vm.envOr("CHEAPBUGS_LIVE_PAYOUT_BROKER", DEFAULT_BROKER);
    }

    function _ensureForkOnlyPermissions(address broker, address admin) private {
        if (!index.brokers(broker)) {
            vm.prank(index.owner());
            index.setBroker(broker, true);
        }
        if (!treasury.brokers(broker)) {
            vm.prank(treasury.owner());
            treasury.setBroker(broker, true);
        }
        if (!index.admins(admin)) {
            vm.prank(index.owner());
            index.setAdmin(admin, true);
        }
    }

    function _statusAt(uint256[] memory statuses, uint256 indexOffset)
        private
        pure
        returns (CheapBugsBugIndex.BugStatus)
    {
        uint256 raw = statuses.length == 0 ? uint256(CheapBugsBugIndex.BugStatus.Valid) : statuses[indexOffset];
        require(raw >= 1 && raw <= 3, "status must be 1 Valid, 2 Invalid, or 3 Spam");
        return CheapBugsBugIndex.BugStatus(raw);
    }

    function _multiplierAt(uint256[] memory multipliers, uint256 indexOffset, CheapBugsBugIndex.BugStatus status)
        private
        pure
        returns (uint8)
    {
        if (status == CheapBugsBugIndex.BugStatus.Invalid || status == CheapBugsBugIndex.BugStatus.Spam) {
            return 0;
        }

        uint256 raw = multipliers.length == 0 ? 1 : multipliers[indexOffset];
        require(raw <= 10, "multiplier must be 0 through 10");
        return uint8(raw);
    }

    function _bugz() private pure returns (IERC20Like) {
        return IERC20Like(LIVE_BUGZ);
    }
}

interface IERC20Like {
    function balanceOf(address account) external view returns (uint256);
}

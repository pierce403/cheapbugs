// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { BondVault } from "../contracts/BondVault.sol";
import { CheapBugsBugIndex, IBondVault, ITreasuryVault } from "../contracts/CheapBugsBugIndex.sol";
import { TreasuryVault } from "../contracts/TreasuryVault.sol";
import { MockBugzToken } from "./MockBugzToken.sol";

contract CheapBugsBugIndexTest is Test {
    uint256 internal constant BUGZ = 1e18;

    uint256 internal reporterKey = 0xA11CE;
    address internal reporter;
    address internal owner = makeAddr("owner");
    address internal broker = makeAddr("broker");
    address internal brokerTwo = makeAddr("broker-two");
    address internal admin = makeAddr("admin");
    address internal outsider = makeAddr("outsider");
    address internal voter = makeAddr("voter");

    MockBugzToken internal token;
    TreasuryVault internal treasury;
    BondVault internal bondVault;
    CheapBugsBugIndex internal index;

    function setUp() public {
        reporter = vm.addr(reporterKey);
        token = new MockBugzToken();
        treasury = new TreasuryVault(token, owner);
        bondVault = new BondVault(token, address(treasury), owner);

        address[] memory initialBrokers = new address[](1);
        initialBrokers[0] = broker;
        address[] memory initialAdmins = new address[](1);
        initialAdmins[0] = admin;
        index = new CheapBugsBugIndex(
            owner,
            IBondVault(address(bondVault)),
            ITreasuryVault(address(treasury)),
            initialBrokers,
            initialAdmins
        );

        vm.startPrank(owner);
        treasury.setIndex(address(index));
        treasury.setBroker(broker, true);
        vm.stopPrank();
    }

    function test_publishBugStoresSignedBrokerSubmission() public {
        bytes32 detailsKey = keccak256("details-key");
        CheapBugsBugIndex.BugInput memory input = _bugInput("one", detailsKey, uint64(block.timestamp + 7 days));
        bytes memory signature = _sign(input, 0, uint64(block.timestamp + 1 days), broker);

        vm.prank(broker);
        index.publishBug(input, 0, uint64(block.timestamp + 1 days), signature);

        CheapBugsBugIndex.Bug memory stored = index.getReport(input.reportHash);
        assertEq(stored.reportHash, input.reportHash);
        assertEq(stored.reportId, input.reportId);
        assertEq(stored.reporter, reporter);
        assertEq(stored.createdAt, input.createdAt);
        assertEq(uint8(stored.disclosureMode), uint8(input.disclosureMode));
        assertEq(stored.publicSummary, input.publicSummary);
        assertEq(stored.encryptedPayloadCid, input.bugBundleCid);
        assertEq(uint8(stored.targetKind), uint8(input.targetKind));
        assertEq(stored.targetRefHash, input.targetRefHash);
        assertEq(stored.tags, input.tags);
        assertEq(stored.contentHash, input.contentHash);
        assertEq(stored.bugBundleHash, input.bugBundleHash);
        assertEq(stored.encryptedDetailsHash, input.encryptedDetailsHash);
        assertEq(stored.detailsKeyCommitment, input.detailsKeyCommitment);
        assertEq(stored.revealAfter, input.revealAfter);
        assertEq(uint8(stored.status), uint8(CheapBugsBugIndex.BugStatus.Unreviewed));
        assertFalse(stored.detailsKeyRevealed);
        assertFalse(stored.payoutCompleted);
        assertEq(index.reportCount(), 1);
        assertEq(index.reportHashAt(0), input.reportHash);

        bytes32[] memory latest = index.latestReportHashes(5);
        assertEq(latest.length, 1);
        assertEq(latest[0], input.reportHash);
    }

    function test_publishBugRejectsNonBroker() public {
        CheapBugsBugIndex.BugInput memory input =
            _bugInput("non-broker", keccak256("details-key"), uint64(block.timestamp + 7 days));
        bytes memory signature = _sign(input, 0, uint64(block.timestamp + 1 days), broker);

        vm.expectRevert(CheapBugsBugIndex.NotBroker.selector);
        vm.prank(outsider);
        index.publishBug(input, 0, uint64(block.timestamp + 1 days), signature);
    }

    function test_publishBugSignatureBindsBroker() public {
        vm.prank(owner);
        index.setBroker(brokerTwo, true);

        CheapBugsBugIndex.BugInput memory input =
            _bugInput("broker-binding", keccak256("details-key"), uint64(block.timestamp + 7 days));
        bytes memory signature = _sign(input, 0, uint64(block.timestamp + 1 days), broker);

        vm.expectRevert();
        vm.prank(brokerTwo);
        index.publishBug(input, 0, uint64(block.timestamp + 1 days), signature);
    }

    function test_publishBugRejectsExpiredSignature() public {
        CheapBugsBugIndex.BugInput memory input =
            _bugInput("expired", keccak256("details-key"), uint64(block.timestamp + 7 days));
        uint64 deadline = uint64(block.timestamp);
        bytes memory signature = _sign(input, 0, deadline, broker);

        vm.warp(block.timestamp + 1);
        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.SignatureExpired.selector, deadline));
        vm.prank(broker);
        index.publishBug(input, 0, deadline, signature);
    }

    function test_publishBugRejectsNonceReplay() public {
        CheapBugsBugIndex.BugInput memory input =
            _bugInput("nonce-one", keccak256("details-key-1"), uint64(block.timestamp + 7 days));
        CheapBugsBugIndex.BugInput memory replay =
            _bugInput("nonce-two", keccak256("details-key-2"), uint64(block.timestamp + 7 days));
        uint64 deadline = uint64(block.timestamp + 1 days);
        bytes memory firstSignature = _sign(input, 7, deadline, broker);
        bytes memory replaySignature = _sign(replay, 7, deadline, broker);

        vm.prank(broker);
        index.publishBug(input, 7, deadline, firstSignature);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.NonceUsed.selector, reporter, uint256(7)));
        vm.prank(broker);
        index.publishBug(replay, 7, deadline, replaySignature);
    }

    function test_publishBugRejectsRevealWindowUnderSevenDays() public {
        CheapBugsBugIndex.BugInput memory input =
            _bugInput("too-soon", keccak256("details-key"), uint64(block.timestamp + 7 days - 1));
        uint64 deadline = uint64(block.timestamp + 1 days);
        bytes memory signature = _sign(input, 0, deadline, broker);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.InvalidRevealAfter.selector, input.revealAfter));
        vm.prank(broker);
        index.publishBug(input, 0, deadline, signature);
    }

    function test_adminFlagsBugStatus() public {
        bytes32 reportHash = _publish("admin-flag", keccak256("details-key"));

        vm.prank(admin);
        index.flagBug(reportHash, CheapBugsBugIndex.BugStatus.Valid);
        assertEq(uint8(index.getReport(reportHash).status), uint8(CheapBugsBugIndex.BugStatus.Valid));

        vm.expectRevert(CheapBugsBugIndex.NotAdmin.selector);
        vm.prank(outsider);
        index.flagBug(reportHash, CheapBugsBugIndex.BugStatus.Spam);

        vm.expectRevert(
            abi.encodeWithSelector(CheapBugsBugIndex.InvalidStatus.selector, CheapBugsBugIndex.BugStatus.Unreviewed)
        );
        vm.prank(admin);
        index.flagBug(reportHash, CheapBugsBugIndex.BugStatus.Unreviewed);
    }

    function test_ownerCanAddAndRemoveBrokersAndAdmins() public {
        bytes32 detailsKey = keccak256("details-key");
        CheapBugsBugIndex.BugInput memory input =
            _bugInput("new-broker", detailsKey, uint64(block.timestamp + 7 days));
        uint64 deadline = uint64(block.timestamp + 1 days);

        vm.startPrank(owner);
        index.setBroker(brokerTwo, true);
        index.setAdmin(outsider, true);
        vm.stopPrank();

        assertTrue(index.brokers(brokerTwo));
        assertTrue(index.admins(outsider));
        assertEq(index.brokerCount(), 2);
        assertEq(index.adminCount(), 2);

        bytes memory signature = _sign(input, 0, deadline, brokerTwo);
        vm.prank(brokerTwo);
        index.publishBug(input, 0, deadline, signature);

        vm.prank(outsider);
        index.flagBug(input.reportHash, CheapBugsBugIndex.BugStatus.Valid);
        assertEq(uint8(index.getReport(input.reportHash).status), uint8(CheapBugsBugIndex.BugStatus.Valid));

        vm.startPrank(owner);
        index.setBroker(brokerTwo, false);
        index.setAdmin(outsider, false);
        vm.stopPrank();

        assertFalse(index.brokers(brokerTwo));
        assertFalse(index.admins(outsider));
        assertEq(index.brokerCount(), 1);
        assertEq(index.adminCount(), 1);

        CheapBugsBugIndex.BugInput memory blocked =
            _bugInput("removed-broker", detailsKey, uint64(block.timestamp + 7 days));
        bytes memory blockedSignature = _sign(blocked, 1, deadline, brokerTwo);
        vm.expectRevert(CheapBugsBugIndex.NotBroker.selector);
        vm.prank(brokerTwo);
        index.publishBug(blocked, 1, deadline, blockedSignature);
    }

    function test_bondedVoteUsesSnapshotWeightAndCanBeUpdated() public {
        bytes32 reportHash = _publish("vote-snapshot", keccak256("details-key"));
        _bond(voter, 1_000 * BUGZ);

        vm.prank(voter);
        index.submitBondVote(reportHash, true);
        assertEq(index.upVoteWeight(reportHash), 3);
        assertEq(index.downVoteWeight(reportHash), 0);

        vm.prank(voter);
        bondVault.requestWithdrawal(900 * BUGZ);
        assertEq(bondVault.getLevel(voter), 2);
        assertEq(index.upVoteWeight(reportHash), 3);

        vm.prank(voter);
        index.submitBondVote(reportHash, false);
        assertEq(index.upVoteWeight(reportHash), 0);
        assertEq(index.downVoteWeight(reportHash), 2);
        assertEq(index.bondVoteCount(reportHash), 1);
        assertEq(index.bondVoteVoterAt(reportHash, 0), voter);

        CheapBugsBugIndex.BondVote memory vote = index.getBondVote(reportHash, voter);
        assertFalse(vote.support);
        assertEq(vote.weight, 2);
    }

    function test_voteRejectsZeroLevelAfterPendingWithdrawalIsExcluded() public {
        bytes32 reportHash = _publish("vote-no-power", keccak256("details-key"));
        _bond(voter, 1_000 * BUGZ);

        vm.prank(voter);
        bondVault.requestWithdrawal(991 * BUGZ);
        assertEq(bondVault.getLevel(voter), 0);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.NoVotingPower.selector, voter));
        vm.prank(voter);
        index.submitBondVote(reportHash, true);
    }

    function test_voteClosesAtRevealWindow() public {
        bytes32 reportHash = _publish("vote-closed", keccak256("details-key"));
        _bond(voter, 100 * BUGZ);

        vm.warp(index.getReport(reportHash).revealAfter);
        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.VotingClosed.selector, reportHash));
        vm.prank(voter);
        index.submitBondVote(reportHash, true);
    }

    function test_revealDetailsKeyRequiresSevenDaysAndMatchingCommitment() public {
        bytes32 detailsKey = keccak256("details-key");
        bytes32 reportHash = _publish("reveal", detailsKey);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.RevealNotReady.selector, index.getReport(reportHash).revealAfter));
        vm.prank(broker);
        index.revealDetailsKey(reportHash, detailsKey);

        vm.warp(index.getReport(reportHash).revealAfter);

        vm.expectRevert(CheapBugsBugIndex.InvalidDetailsKey.selector);
        vm.prank(broker);
        index.revealDetailsKey(reportHash, keccak256("wrong"));

        vm.prank(broker);
        index.revealDetailsKey(reportHash, detailsKey);

        CheapBugsBugIndex.Bug memory stored = index.getReport(reportHash);
        assertTrue(stored.detailsKeyRevealed);
        assertEq(stored.detailsKey, detailsKey);
    }

    function test_completePayoutEnforcesOrderRevealAdminStatusAndTreasuryPayment() public {
        bytes32 firstKey = keccak256("first-key");
        bytes32 secondKey = keccak256("second-key");
        bytes32 first = _publish("payout-first", firstKey);
        bytes32 second = _publish("payout-second", secondKey);

        token.mint(owner, 100_000 * BUGZ);
        vm.startPrank(owner);
        token.approve(address(treasury), 100_000 * BUGZ);
        treasury.deposit(100_000 * BUGZ);
        vm.stopPrank();

        vm.prank(admin);
        index.flagBug(first, CheapBugsBugIndex.BugStatus.Valid);
        vm.prank(admin);
        index.flagBug(second, CheapBugsBugIndex.BugStatus.Invalid);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.OutOfOrderPayout.selector, first, second));
        vm.prank(broker);
        index.completePayout(second, 0, secondKey);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.RevealNotReady.selector, index.getReport(first).revealAfter));
        vm.prank(broker);
        index.completePayout(first, 3, firstKey);

        vm.warp(index.getReport(first).revealAfter);
        uint256 expectedFirstPayout = (token.balanceOf(address(treasury)) / 1_000) * 3;

        vm.prank(broker);
        index.completePayout(first, 3, firstKey);

        assertEq(token.balanceOf(reporter), expectedFirstPayout);
        assertEq(index.nextPayoutIndex(), 1);
        CheapBugsBugIndex.Bug memory paidFirst = index.getReport(first);
        assertTrue(paidFirst.payoutCompleted);
        assertEq(paidFirst.payoutAmount, expectedFirstPayout);
        assertEq(paidFirst.payoutMultiplier, 3);
        assertEq(paidFirst.detailsKey, firstKey);

        vm.expectRevert(
            abi.encodeWithSelector(
                CheapBugsBugIndex.PayoutRequiresZeroMultiplier.selector,
                CheapBugsBugIndex.BugStatus.Invalid
            )
        );
        vm.prank(broker);
        index.completePayout(second, 1, secondKey);

        vm.prank(broker);
        index.completePayout(second, 0, secondKey);

        assertEq(index.nextPayoutIndex(), 2);
        assertEq(index.getReport(second).payoutAmount, 0);
    }

    function test_completePayoutRequiresAdminStatus() public {
        bytes32 detailsKey = keccak256("details-key");
        bytes32 reportHash = _publish("payout-admin-required", detailsKey);
        vm.warp(index.getReport(reportHash).revealAfter);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.PayoutRequiresAdminStatus.selector, reportHash));
        vm.prank(broker);
        index.completePayout(reportHash, 0, detailsKey);
    }

    function testFuzz_publishRejectsRevealWindowBeforeSevenDays(uint64 offset) public {
        offset = uint64(bound(offset, 0, 7 days - 1));
        CheapBugsBugIndex.BugInput memory input =
            _bugInput("fuzz-reveal", keccak256("details-key"), uint64(block.timestamp + offset));
        uint64 deadline = uint64(block.timestamp + 1 days);
        bytes memory signature = _sign(input, 0, deadline, broker);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.InvalidRevealAfter.selector, input.revealAfter));
        vm.prank(broker);
        index.publishBug(input, 0, deadline, signature);
    }

    function testFuzz_bondVoteWeightMatchesVaultLevel(uint256 wholeTokens) public {
        wholeTokens = bound(wholeTokens, 10, 1_000_000_000);
        bytes32 reportHash = _publish("fuzz-vote-weight", keccak256("details-key"));
        uint256 amount = wholeTokens * BUGZ;
        _bond(voter, amount);

        vm.prank(voter);
        index.submitBondVote(reportHash, true);

        assertEq(index.upVoteWeight(reportHash), _log10(wholeTokens));
    }

    function testFuzz_completePayoutUsesTreasuryMultiplier(uint8 multiplier) public {
        multiplier = uint8(bound(multiplier, 0, 10));
        bytes32 detailsKey = keccak256("details-key");
        bytes32 reportHash = _publish("fuzz-payout", detailsKey);

        token.mint(owner, 1_000_000 * BUGZ);
        vm.startPrank(owner);
        token.approve(address(treasury), 1_000_000 * BUGZ);
        treasury.deposit(1_000_000 * BUGZ);
        vm.stopPrank();

        vm.prank(admin);
        index.flagBug(reportHash, CheapBugsBugIndex.BugStatus.Valid);

        vm.warp(index.getReport(reportHash).revealAfter);
        uint256 expected = (token.balanceOf(address(treasury)) / 1_000) * multiplier;

        vm.prank(broker);
        index.completePayout(reportHash, multiplier, detailsKey);

        assertEq(index.getReport(reportHash).payoutAmount, expected);
        assertEq(token.balanceOf(reporter), expected);
    }

    function _publish(string memory label, bytes32 detailsKey) internal returns (bytes32) {
        CheapBugsBugIndex.BugInput memory input =
            _bugInput(label, detailsKey, uint64(block.timestamp + 7 days));
        uint64 deadline = uint64(block.timestamp + 1 days);
        bytes memory signature = _sign(input, uint256(input.reportHash), deadline, broker);
        vm.prank(broker);
        index.publishBug(input, uint256(input.reportHash), deadline, signature);
        return input.reportHash;
    }

    function _bugInput(string memory label, bytes32 detailsKey, uint64 revealAfter)
        internal
        view
        returns (CheapBugsBugIndex.BugInput memory)
    {
        string memory reportId = string.concat("cb-", label);
        string memory publicSummary = string.concat("Public summary for ", label);
        string memory cid = string.concat("ipfs://", label);
        return CheapBugsBugIndex.BugInput({
            reportHash: keccak256(bytes(label)),
            reportId: reportId,
            reporter: reporter,
            createdAt: uint64(block.timestamp),
            disclosureMode: CheapBugsBugIndex.DisclosureMode.Private,
            publicSummary: publicSummary,
            bugBundleCid: cid,
            targetKind: CheapBugsBugIndex.TargetKind.Other,
            targetRefHash: keccak256("broker triage"),
            tags: "broker,bugbundle",
            contentHash: keccak256(bytes(publicSummary)),
            bugBundleHash: keccak256(bytes(cid)),
            encryptedDetailsHash: keccak256(bytes(string.concat("encrypted-", label))),
            detailsKeyCommitment: sha256(abi.encodePacked(detailsKey)),
            revealAfter: revealAfter
        });
    }

    function _sign(CheapBugsBugIndex.BugInput memory input, uint256 nonce, uint64 deadline, address signingBroker)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = index.publishBugDigest(input, nonce, deadline, signingBroker);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(reporterKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _bond(address account, uint256 amount) internal {
        token.mint(account, amount);
        vm.startPrank(account);
        token.approve(address(bondVault), amount);
        bondVault.bond(amount);
        vm.stopPrank();
    }

    function _log10(uint256 value) internal pure returns (uint256 level) {
        while (value >= 10) {
            value /= 10;
            level++;
        }
    }
}

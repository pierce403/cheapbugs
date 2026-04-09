// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

import { CheapBugsBugIndex } from "../contracts/CheapBugsBugIndex.sol";

contract CheapBugsBugIndexTest is Test {
    address internal owner = makeAddr("owner");
    address internal reporter = makeAddr("reporter");
    address internal reviewerOne = makeAddr("reviewer-one");
    address internal reviewerTwo = makeAddr("reviewer-two");
    address internal outsider = makeAddr("outsider");

    CheapBugsBugIndex internal index;

    function setUp() public {
        address[] memory initialReviewers = new address[](1);
        initialReviewers[0] = reviewerOne;
        index = new CheapBugsBugIndex(owner, initialReviewers);
    }

    function test_submitReportStoresSubmissionAndReporter() public {
        CheapBugsBugIndex.SubmissionInput memory input = _submissionInput(
            keccak256("bug-1"),
            "cb-bug-1",
            1_710_000_000,
            "Summary for bug one",
            "ipfs://encrypted-bug-one"
        );

        vm.prank(reporter);
        index.submitReport(input);

        CheapBugsBugIndex.Submission memory stored = index.getReport(input.reportHash);
        assertEq(stored.reportHash, input.reportHash);
        assertEq(stored.reportId, input.reportId);
        assertEq(stored.reporter, reporter);
        assertEq(stored.createdAt, input.createdAt);
        assertEq(uint8(stored.disclosureMode), uint8(input.disclosureMode));
        assertEq(stored.publicSummary, input.publicSummary);
        assertEq(stored.encryptedPayloadCid, input.encryptedPayloadCid);
        assertEq(uint8(stored.targetKind), uint8(input.targetKind));
        assertEq(stored.targetRefHash, input.targetRefHash);
        assertEq(stored.tags, input.tags);
        assertEq(stored.contentHash, input.contentHash);
        assertEq(index.reportCount(), 1);

        bytes32[] memory latest = index.latestReportHashes(5);
        assertEq(latest.length, 1);
        assertEq(latest[0], input.reportHash);
    }

    function test_submitReportRevertsOnDuplicateHash() public {
        CheapBugsBugIndex.SubmissionInput memory input = _submissionInput(
            keccak256("bug-duplicate"),
            "cb-dup",
            1_710_000_100,
            "Duplicate bug",
            "ipfs://duplicate"
        );

        vm.prank(reporter);
        index.submitReport(input);

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.SubmissionExists.selector, input.reportHash));
        vm.prank(makeAddr("other-reporter"));
        index.submitReport(input);
    }

    function test_submitReportRevertsOnMissingRequiredField() public {
        CheapBugsBugIndex.SubmissionInput memory input = _submissionInput(
            keccak256("bug-missing-field"),
            "",
            1_710_000_200,
            "Missing report id",
            "ipfs://missing-field"
        );

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.EmptyField.selector, "reportId"));
        vm.prank(reporter);
        index.submitReport(input);
    }

    function test_latestReportHashesReturnsNewestFirst() public {
        CheapBugsBugIndex.SubmissionInput memory bugOne = _submissionInput(
            keccak256("latest-1"),
            "cb-latest-1",
            1_710_000_300,
            "Latest bug one",
            "ipfs://latest-one"
        );
        CheapBugsBugIndex.SubmissionInput memory bugTwo = _submissionInput(
            keccak256("latest-2"),
            "cb-latest-2",
            1_710_000_301,
            "Latest bug two",
            "ipfs://latest-two"
        );
        CheapBugsBugIndex.SubmissionInput memory bugThree = _submissionInput(
            keccak256("latest-3"),
            "cb-latest-3",
            1_710_000_302,
            "Latest bug three",
            "ipfs://latest-three"
        );

        vm.startPrank(reporter);
        index.submitReport(bugOne);
        index.submitReport(bugTwo);
        index.submitReport(bugThree);
        vm.stopPrank();

        bytes32[] memory latest = index.latestReportHashes(2);
        assertEq(latest.length, 2);
        assertEq(latest[0], bugThree.reportHash);
        assertEq(latest[1], bugTwo.reportHash);
    }

    function test_submitReviewVoteRevertsForNonReviewer() public {
        CheapBugsBugIndex.SubmissionInput memory bug = _submitBug("vote-non-reviewer");
        CheapBugsBugIndex.ReviewVoteInput memory vote = _voteInput(
            bug.reportHash,
            CheapBugsBugIndex.Validity.Confirmed,
            CheapBugsBugIndex.Impact.High,
            CheapBugsBugIndex.RewardClass.Paid,
            90
        );

        vm.expectRevert(CheapBugsBugIndex.NotReviewer.selector);
        vm.prank(outsider);
        index.submitReviewVote(vote);
    }

    function test_submitReviewVoteRevertsForMissingReport() public {
        CheapBugsBugIndex.ReviewVoteInput memory vote = _voteInput(
            keccak256("missing-report"),
            CheapBugsBugIndex.Validity.Confirmed,
            CheapBugsBugIndex.Impact.High,
            CheapBugsBugIndex.RewardClass.Paid,
            90
        );

        vm.expectRevert(
            abi.encodeWithSelector(CheapBugsBugIndex.MissingReport.selector, keccak256("missing-report"))
        );
        vm.prank(reviewerOne);
        index.submitReviewVote(vote);
    }

    function test_submitReviewVoteRevertsForInvalidConfidence() public {
        CheapBugsBugIndex.SubmissionInput memory bug = _submitBug("vote-invalid-confidence");
        CheapBugsBugIndex.ReviewVoteInput memory vote = _voteInput(
            bug.reportHash,
            CheapBugsBugIndex.Validity.Confirmed,
            CheapBugsBugIndex.Impact.Critical,
            CheapBugsBugIndex.RewardClass.Paid,
            101
        );

        vm.expectRevert(abi.encodeWithSelector(CheapBugsBugIndex.InvalidConfidence.selector, uint8(101)));
        vm.prank(reviewerOne);
        index.submitReviewVote(vote);
    }

    function test_submitReviewVoteStoresVoteAndMakesItQueryable() public {
        CheapBugsBugIndex.SubmissionInput memory bug = _submitBug("vote-store");
        CheapBugsBugIndex.ReviewVoteInput memory vote = _voteInput(
            bug.reportHash,
            CheapBugsBugIndex.Validity.Confirmed,
            CheapBugsBugIndex.Impact.High,
            CheapBugsBugIndex.RewardClass.Points,
            88
        );

        vm.warp(1_720_000_000);
        vm.prank(reviewerOne);
        index.submitReviewVote(vote);

        CheapBugsBugIndex.ReviewVote memory storedVote = index.getReviewVote(bug.reportHash, reviewerOne);
        assertEq(storedVote.reportHash, bug.reportHash);
        assertEq(storedVote.reviewer, reviewerOne);
        assertEq(storedVote.createdAt, 1_720_000_000);
        assertEq(uint8(storedVote.validity), uint8(CheapBugsBugIndex.Validity.Confirmed));
        assertEq(uint8(storedVote.impact), uint8(CheapBugsBugIndex.Impact.High));
        assertEq(uint8(storedVote.rewardClass), uint8(CheapBugsBugIndex.RewardClass.Points));
        assertEq(storedVote.confidence, 88);
        assertTrue(index.hasReviewVote(bug.reportHash, reviewerOne));
        assertEq(index.reviewVoteCount(bug.reportHash), 1);
        assertEq(index.reviewVoteReviewerAt(bug.reportHash, 0), reviewerOne);

        CheapBugsBugIndex.ReviewVote[] memory votes = index.getReviewVotes(bug.reportHash);
        assertEq(votes.length, 1);
        assertEq(votes[0].reviewer, reviewerOne);
    }

    function test_submitReviewVoteUpdatesExistingVoteWithoutDuplicatingReviewerCount() public {
        CheapBugsBugIndex.SubmissionInput memory bug = _submitBug("vote-update");
        CheapBugsBugIndex.ReviewVoteInput memory firstVote = _voteInput(
            bug.reportHash,
            CheapBugsBugIndex.Validity.Unconfirmed,
            CheapBugsBugIndex.Impact.Medium,
            CheapBugsBugIndex.RewardClass.None,
            40
        );
        CheapBugsBugIndex.ReviewVoteInput memory updatedVote = _voteInput(
            bug.reportHash,
            CheapBugsBugIndex.Validity.Confirmed,
            CheapBugsBugIndex.Impact.Critical,
            CheapBugsBugIndex.RewardClass.Paid,
            97
        );

        vm.warp(1_720_000_010);
        vm.prank(reviewerOne);
        index.submitReviewVote(firstVote);

        vm.warp(1_720_000_999);
        vm.prank(reviewerOne);
        index.submitReviewVote(updatedVote);

        CheapBugsBugIndex.ReviewVote memory storedVote = index.getReviewVote(bug.reportHash, reviewerOne);
        assertEq(index.reviewVoteCount(bug.reportHash), 1);
        assertEq(storedVote.createdAt, 1_720_000_999);
        assertEq(uint8(storedVote.validity), uint8(CheapBugsBugIndex.Validity.Confirmed));
        assertEq(uint8(storedVote.impact), uint8(CheapBugsBugIndex.Impact.Critical));
        assertEq(uint8(storedVote.rewardClass), uint8(CheapBugsBugIndex.RewardClass.Paid));
        assertEq(storedVote.confidence, 97);
    }

    function test_ownerCanAuthorizeAdditionalReviewerWhoCanThenVote() public {
        CheapBugsBugIndex.SubmissionInput memory bug = _submitBug("vote-new-reviewer");

        vm.prank(owner);
        index.setReviewer(reviewerTwo, true);

        vm.prank(reviewerTwo);
        index.submitReviewVote(
            _voteInput(
                bug.reportHash,
                CheapBugsBugIndex.Validity.Duplicate,
                CheapBugsBugIndex.Impact.Low,
                CheapBugsBugIndex.RewardClass.None,
                55
            )
        );

        CheapBugsBugIndex.ReviewVote memory storedVote = index.getReviewVote(bug.reportHash, reviewerTwo);
        assertEq(storedVote.reviewer, reviewerTwo);
        assertEq(uint8(storedVote.validity), uint8(CheapBugsBugIndex.Validity.Duplicate));
    }

    function _submitBug(string memory label) internal returns (CheapBugsBugIndex.SubmissionInput memory input) {
        input = _submissionInput(
            keccak256(bytes(label)),
            string.concat("cb-", label),
            1_710_001_000,
            string.concat("Public summary for ", label),
            string.concat("ipfs://", label)
        );

        vm.prank(reporter);
        index.submitReport(input);
    }

    function _submissionInput(
        bytes32 reportHash,
        string memory reportId,
        uint64 createdAt,
        string memory publicSummary,
        string memory encryptedPayloadCid
    ) internal pure returns (CheapBugsBugIndex.SubmissionInput memory) {
        return CheapBugsBugIndex.SubmissionInput({
            reportHash: reportHash,
            reportId: reportId,
            createdAt: createdAt,
            disclosureMode: CheapBugsBugIndex.DisclosureMode.Private,
            publicSummary: publicSummary,
            encryptedPayloadCid: encryptedPayloadCid,
            targetKind: CheapBugsBugIndex.TargetKind.Protocol,
            targetRefHash: keccak256(bytes(reportId)),
            tags: "base,contract",
            contentHash: keccak256(bytes(string.concat(reportId, publicSummary)))
        });
    }

    function _voteInput(
        bytes32 reportHash,
        CheapBugsBugIndex.Validity validity,
        CheapBugsBugIndex.Impact impact,
        CheapBugsBugIndex.RewardClass rewardClass,
        uint8 confidence
    ) internal pure returns (CheapBugsBugIndex.ReviewVoteInput memory) {
        return CheapBugsBugIndex.ReviewVoteInput({
            reportHash: reportHash,
            validity: validity,
            impact: impact,
            rewardClass: rewardClass,
            confidence: confidence
        });
    }
}

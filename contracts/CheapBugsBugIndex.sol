// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract CheapBugsBugIndex {
    enum DisclosureMode {
        Private,
        Embargoed,
        Public
    }

    enum TargetKind {
        Repo,
        Package,
        Domain,
        Contract,
        Protocol,
        Other
    }

    enum Validity {
        Confirmed,
        Unconfirmed,
        Invalid,
        Duplicate,
        Spam
    }

    enum Impact {
        None,
        Low,
        Medium,
        High,
        Critical
    }

    enum RewardClass {
        None,
        Points,
        Paid
    }

    struct Submission {
        bytes32 reportHash;
        string reportId;
        address reporter;
        uint64 createdAt;
        DisclosureMode disclosureMode;
        string publicSummary;
        string encryptedPayloadCid;
        TargetKind targetKind;
        bytes32 targetRefHash;
        string tags;
        bytes32 contentHash;
    }

    struct SubmissionInput {
        bytes32 reportHash;
        string reportId;
        uint64 createdAt;
        DisclosureMode disclosureMode;
        string publicSummary;
        string encryptedPayloadCid;
        TargetKind targetKind;
        bytes32 targetRefHash;
        string tags;
        bytes32 contentHash;
    }

    struct ReviewVote {
        bytes32 reportHash;
        address reviewer;
        uint64 createdAt;
        Validity validity;
        Impact impact;
        RewardClass rewardClass;
        uint8 confidence;
    }

    struct ReviewVoteInput {
        bytes32 reportHash;
        Validity validity;
        Impact impact;
        RewardClass rewardClass;
        uint8 confidence;
    }

    address public owner;

    mapping(bytes32 => Submission) private submissions;
    mapping(bytes32 => bool) public exists;
    mapping(address => bool) public reviewers;
    mapping(bytes32 => mapping(address => ReviewVote)) private reviewVotes;
    mapping(bytes32 => mapping(address => bool)) public hasReviewVote;
    bytes32[] private reportHashes;
    mapping(bytes32 => address[]) private reviewVoteReviewers;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ReviewerSet(address indexed reviewer, bool allowed);
    event ReportSubmitted(
        bytes32 indexed reportHash,
        string reportId,
        address indexed reporter,
        uint64 createdAt,
        DisclosureMode disclosureMode,
        string publicSummary,
        string encryptedPayloadCid,
        TargetKind targetKind,
        bytes32 targetRefHash,
        string tags,
        bytes32 contentHash
    );
    event ReviewVoteSubmitted(
        bytes32 indexed reportHash,
        address indexed reviewer,
        uint64 createdAt,
        Validity validity,
        Impact impact,
        RewardClass rewardClass,
        uint8 confidence
    );

    error NotOwner();
    error NotReviewer();
    error InvalidOwner();
    error SubmissionExists(bytes32 reportHash);
    error MissingReport(bytes32 reportHash);
    error MissingReviewVote(bytes32 reportHash, address reviewer);
    error EmptyField(string field);
    error InvalidConfidence(uint8 confidence);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyReviewer() {
        if (!reviewers[msg.sender]) revert NotReviewer();
        _;
    }

    constructor(address initialOwner, address[] memory initialReviewers) {
        if (initialOwner == address(0)) revert InvalidOwner();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);

        for (uint256 i = 0; i < initialReviewers.length; i++) {
            reviewers[initialReviewers[i]] = true;
            emit ReviewerSet(initialReviewers[i], true);
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidOwner();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setReviewer(address reviewer, bool allowed) external onlyOwner {
        reviewers[reviewer] = allowed;
        emit ReviewerSet(reviewer, allowed);
    }

    function submitReport(SubmissionInput calldata input) external {
        if (exists[input.reportHash]) revert SubmissionExists(input.reportHash);
        if (bytes(input.reportId).length == 0) revert EmptyField("reportId");
        if (bytes(input.publicSummary).length == 0) revert EmptyField("publicSummary");
        if (bytes(input.encryptedPayloadCid).length == 0) revert EmptyField("encryptedPayloadCid");
        if (input.createdAt == 0) revert EmptyField("createdAt");

        Submission memory record = Submission({
            reportHash: input.reportHash,
            reportId: input.reportId,
            reporter: msg.sender,
            createdAt: input.createdAt,
            disclosureMode: input.disclosureMode,
            publicSummary: input.publicSummary,
            encryptedPayloadCid: input.encryptedPayloadCid,
            targetKind: input.targetKind,
            targetRefHash: input.targetRefHash,
            tags: input.tags,
            contentHash: input.contentHash
        });

        submissions[input.reportHash] = record;
        exists[input.reportHash] = true;
        reportHashes.push(input.reportHash);

        emit ReportSubmitted(
            input.reportHash,
            input.reportId,
            msg.sender,
            input.createdAt,
            input.disclosureMode,
            input.publicSummary,
            input.encryptedPayloadCid,
            input.targetKind,
            input.targetRefHash,
            input.tags,
            input.contentHash
        );
    }

    function submitReviewVote(ReviewVoteInput calldata input) external onlyReviewer {
        if (!exists[input.reportHash]) revert MissingReport(input.reportHash);
        if (input.confidence > 100) revert InvalidConfidence(input.confidence);

        if (!hasReviewVote[input.reportHash][msg.sender]) {
            hasReviewVote[input.reportHash][msg.sender] = true;
            reviewVoteReviewers[input.reportHash].push(msg.sender);
        }

        ReviewVote memory vote = ReviewVote({
            reportHash: input.reportHash,
            reviewer: msg.sender,
            createdAt: uint64(block.timestamp),
            validity: input.validity,
            impact: input.impact,
            rewardClass: input.rewardClass,
            confidence: input.confidence
        });

        reviewVotes[input.reportHash][msg.sender] = vote;

        emit ReviewVoteSubmitted(
            input.reportHash,
            msg.sender,
            vote.createdAt,
            input.validity,
            input.impact,
            input.rewardClass,
            input.confidence
        );
    }

    function reportCount() external view returns (uint256) {
        return reportHashes.length;
    }

    function reportHashAt(uint256 index) external view returns (bytes32) {
        return reportHashes[index];
    }

    function latestReportHashes(uint256 limit) external view returns (bytes32[] memory) {
        uint256 total = reportHashes.length;
        if (limit > total) {
            limit = total;
        }

        bytes32[] memory result = new bytes32[](limit);
        for (uint256 i = 0; i < limit; i++) {
            result[i] = reportHashes[total - 1 - i];
        }
        return result;
    }

    function getReport(bytes32 reportHash) external view returns (Submission memory) {
        if (!exists[reportHash]) revert MissingReport(reportHash);
        return submissions[reportHash];
    }

    function reviewVoteCount(bytes32 reportHash) external view returns (uint256) {
        if (!exists[reportHash]) revert MissingReport(reportHash);
        return reviewVoteReviewers[reportHash].length;
    }

    function reviewVoteReviewerAt(bytes32 reportHash, uint256 index) external view returns (address) {
        if (!exists[reportHash]) revert MissingReport(reportHash);
        return reviewVoteReviewers[reportHash][index];
    }

    function getReviewVote(bytes32 reportHash, address reviewer) external view returns (ReviewVote memory) {
        if (!exists[reportHash]) revert MissingReport(reportHash);
        if (!hasReviewVote[reportHash][reviewer]) revert MissingReviewVote(reportHash, reviewer);
        return reviewVotes[reportHash][reviewer];
    }

    function getReviewVotes(bytes32 reportHash) external view returns (ReviewVote[] memory) {
        if (!exists[reportHash]) revert MissingReport(reportHash);

        address[] storage reviewersForReport = reviewVoteReviewers[reportHash];
        ReviewVote[] memory votes = new ReviewVote[](reviewersForReport.length);

        for (uint256 i = 0; i < reviewersForReport.length; i++) {
            votes[i] = reviewVotes[reportHash][reviewersForReport[i]];
        }

        return votes;
    }
}

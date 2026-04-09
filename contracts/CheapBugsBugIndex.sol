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

    address public owner;

    mapping(bytes32 => Submission) private submissions;
    mapping(bytes32 => bool) public exists;
    mapping(address => bool) public reviewers;
    bytes32[] private reportHashes;

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

    error NotOwner();
    error InvalidOwner();
    error SubmissionExists(bytes32 reportHash);
    error MissingReport(bytes32 reportHash);
    error EmptyField(string field);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
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
}

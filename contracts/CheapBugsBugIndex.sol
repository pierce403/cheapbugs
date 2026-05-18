// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IBondVault {
    function getLevel(address account) external view returns (uint8);
}

interface ITreasuryVault {
    function payRewardFromIndex(address broker, address recipient, uint8 multiplier) external returns (uint256);
}

contract CheapBugsBugIndex is Ownable, EIP712 {
    uint256 public constant JUDGMENT_PERIOD = 7 days;
    uint8 public constant MAX_PAYOUT_MULTIPLIER = 10;

    bytes32 private constant PUBLISH_BUG_TYPEHASH = keccak256(
        "PublishBug(bytes32 reportHash,bytes32 reportIdHash,address reporter,uint64 createdAt,uint8 disclosureMode,bytes32 publicSummaryHash,bytes32 bugBundleCidHash,uint8 targetKind,bytes32 targetRefHash,bytes32 tagsHash,bytes32 contentHash,bytes32 bugBundleHash,bytes32 encryptedDetailsHash,bytes32 detailsKeyCommitment,uint64 revealAfter,uint256 nonce,uint64 deadline,address broker)"
    );

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

    enum BugStatus {
        Unreviewed,
        Valid,
        Invalid,
        Spam
    }

    struct Bug {
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
        bytes32 bugBundleHash;
        bytes32 encryptedDetailsHash;
        bytes32 detailsKeyCommitment;
        uint64 revealAfter;
        bytes32 detailsKey;
        bool detailsKeyRevealed;
        BugStatus status;
        bool payoutCompleted;
        uint256 payoutAmount;
        uint8 payoutMultiplier;
    }

    struct BugInput {
        bytes32 reportHash;
        string reportId;
        address reporter;
        uint64 createdAt;
        DisclosureMode disclosureMode;
        string publicSummary;
        string bugBundleCid;
        TargetKind targetKind;
        bytes32 targetRefHash;
        string tags;
        bytes32 contentHash;
        bytes32 bugBundleHash;
        bytes32 encryptedDetailsHash;
        bytes32 detailsKeyCommitment;
        uint64 revealAfter;
    }

    struct BondVote {
        bytes32 reportHash;
        address voter;
        uint64 createdAt;
        bool support;
        uint8 weight;
    }

    IBondVault public bondVault;
    ITreasuryVault public treasuryVault;

    mapping(address => bool) public brokers;
    mapping(address => bool) public admins;
    mapping(address => mapping(uint256 => bool)) public usedReporterNonces;
    mapping(bytes32 => bool) public exists;
    mapping(bytes32 => Bug) private bugs;
    bytes32[] private reportHashes;

    mapping(bytes32 => mapping(address => bool)) public hasBondVote;
    mapping(bytes32 => mapping(address => BondVote)) private bondVotes;
    mapping(bytes32 => address[]) private bondVoteVoters;
    mapping(bytes32 => uint256) public upVoteWeight;
    mapping(bytes32 => uint256) public downVoteWeight;

    address[] private brokerList;
    mapping(address => uint256) private brokerIndexPlusOne;
    address[] private adminList;
    mapping(address => uint256) private adminIndexPlusOne;

    uint256 public nextPayoutIndex;

    event BondVaultSet(address indexed bondVault);
    event TreasuryVaultSet(address indexed treasuryVault);
    event BrokerSet(address indexed broker, bool allowed);
    event AdminSet(address indexed admin, bool allowed);
    event BugPublished(
        bytes32 indexed reportHash,
        string reportId,
        address indexed reporter,
        address indexed broker,
        uint64 createdAt,
        uint64 revealAfter,
        string bugBundleCid,
        bytes32 detailsKeyCommitment
    );
    event BugFlagged(bytes32 indexed reportHash, address indexed admin, BugStatus status);
    event BondVoteSubmitted(bytes32 indexed reportHash, address indexed voter, bool support, uint8 weight);
    event DetailsKeyRevealed(bytes32 indexed reportHash, bytes32 detailsKey);
    event PayoutCompleted(
        bytes32 indexed reportHash,
        address indexed broker,
        address indexed recipient,
        uint8 multiplier,
        uint256 amount
    );

    error DetailKeyAlreadyRevealed(bytes32 reportHash);
    error InvalidAddress();
    error InvalidDetailsKey();
    error InvalidField(string field);
    error InvalidPayoutMultiplier(uint8 multiplier);
    error InvalidRevealAfter(uint64 revealAfter);
    error InvalidStatus(BugStatus status);
    error MissingBug(bytes32 reportHash);
    error NoVotingPower(address voter);
    error NonceUsed(address reporter, uint256 nonce);
    error NotAdmin();
    error NotBroker();
    error OutOfOrderPayout(bytes32 expectedReportHash, bytes32 actualReportHash);
    error PayoutAlreadyCompleted(bytes32 reportHash);
    error PayoutRequiresAdminStatus(bytes32 reportHash);
    error PayoutRequiresZeroMultiplier(BugStatus status);
    error RevealNotReady(uint64 revealAfter);
    error SignatureExpired(uint64 deadline);
    error SubmissionExists(bytes32 reportHash);
    error VotingClosed(bytes32 reportHash);
    error WrongReporterSignature(address expected, address recovered);

    modifier onlyBroker() {
        if (!brokers[msg.sender]) revert NotBroker();
        _;
    }

    modifier onlyAdmin() {
        if (!admins[msg.sender]) revert NotAdmin();
        _;
    }

    constructor(
        address initialOwner,
        IBondVault initialBondVault,
        ITreasuryVault initialTreasuryVault,
        address[] memory initialBrokers,
        address[] memory initialAdmins
    )
        Ownable(initialOwner)
        EIP712("CheapBugsBugIndex", "1")
    {
        if (address(initialBondVault) == address(0) || address(initialTreasuryVault) == address(0)) {
            revert InvalidAddress();
        }

        bondVault = initialBondVault;
        treasuryVault = initialTreasuryVault;
        emit BondVaultSet(address(initialBondVault));
        emit TreasuryVaultSet(address(initialTreasuryVault));

        for (uint256 i = 0; i < initialBrokers.length; i++) {
            _setBroker(initialBrokers[i], true);
        }

        for (uint256 i = 0; i < initialAdmins.length; i++) {
            _setAdmin(initialAdmins[i], true);
        }
    }

    function setBondVault(IBondVault newBondVault) external onlyOwner {
        if (address(newBondVault) == address(0)) revert InvalidAddress();
        bondVault = newBondVault;
        emit BondVaultSet(address(newBondVault));
    }

    function setTreasuryVault(ITreasuryVault newTreasuryVault) external onlyOwner {
        if (address(newTreasuryVault) == address(0)) revert InvalidAddress();
        treasuryVault = newTreasuryVault;
        emit TreasuryVaultSet(address(newTreasuryVault));
    }

    function setBroker(address broker, bool allowed) external onlyOwner {
        _setBroker(broker, allowed);
    }

    function setAdmin(address admin, bool allowed) external onlyOwner {
        _setAdmin(admin, allowed);
    }

    function publishBug(BugInput calldata input, uint256 nonce, uint64 deadline, bytes calldata reporterSignature)
        external
        onlyBroker
    {
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        if (usedReporterNonces[input.reporter][nonce]) revert NonceUsed(input.reporter, nonce);

        bytes32 digest = publishBugDigest(input, nonce, deadline, msg.sender);
        address recovered = ECDSA.recover(digest, reporterSignature);
        if (recovered != input.reporter) revert WrongReporterSignature(input.reporter, recovered);

        usedReporterNonces[input.reporter][nonce] = true;
        _storeBug(input);
    }

    function flagBug(bytes32 reportHash, BugStatus status) external onlyAdmin {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        if (status == BugStatus.Unreviewed) revert InvalidStatus(status);

        bugs[reportHash].status = status;
        emit BugFlagged(reportHash, msg.sender, status);
    }

    function submitBondVote(bytes32 reportHash, bool support) external {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        Bug storage bug = bugs[reportHash];
        if (block.timestamp >= bug.revealAfter || bug.payoutCompleted) revert VotingClosed(reportHash);

        uint8 weight = bondVault.getLevel(msg.sender);
        if (weight == 0) revert NoVotingPower(msg.sender);

        if (hasBondVote[reportHash][msg.sender]) {
            BondVote storage previousVote = bondVotes[reportHash][msg.sender];
            if (previousVote.support) {
                upVoteWeight[reportHash] -= previousVote.weight;
            } else {
                downVoteWeight[reportHash] -= previousVote.weight;
            }
        } else {
            hasBondVote[reportHash][msg.sender] = true;
            bondVoteVoters[reportHash].push(msg.sender);
        }

        bondVotes[reportHash][msg.sender] = BondVote({
            reportHash: reportHash,
            voter: msg.sender,
            createdAt: uint64(block.timestamp),
            support: support,
            weight: weight
        });

        if (support) {
            upVoteWeight[reportHash] += weight;
        } else {
            downVoteWeight[reportHash] += weight;
        }

        emit BondVoteSubmitted(reportHash, msg.sender, support, weight);
    }

    function revealDetailsKey(bytes32 reportHash, bytes32 detailsKey) external onlyBroker {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        _revealDetailsKey(reportHash, detailsKey);
    }

    function completePayout(bytes32 reportHash, uint8 multiplier, bytes32 detailsKey) external onlyBroker {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        if (multiplier > MAX_PAYOUT_MULTIPLIER) revert InvalidPayoutMultiplier(multiplier);
        if (nextPayoutIndex >= reportHashes.length) revert MissingBug(reportHash);

        bytes32 expectedReportHash = reportHashes[nextPayoutIndex];
        if (expectedReportHash != reportHash) revert OutOfOrderPayout(expectedReportHash, reportHash);

        Bug storage bug = bugs[reportHash];
        if (bug.payoutCompleted) revert PayoutAlreadyCompleted(reportHash);
        if (bug.status == BugStatus.Unreviewed) revert PayoutRequiresAdminStatus(reportHash);
        if ((bug.status == BugStatus.Invalid || bug.status == BugStatus.Spam) && multiplier != 0) {
            revert PayoutRequiresZeroMultiplier(bug.status);
        }

        if (!bug.detailsKeyRevealed) {
            _revealDetailsKey(reportHash, detailsKey);
        } else if (detailsKey != bytes32(0) && detailsKey != bug.detailsKey) {
            revert DetailKeyAlreadyRevealed(reportHash);
        }

        uint256 amount = treasuryVault.payRewardFromIndex(msg.sender, bug.reporter, multiplier);
        bug.payoutCompleted = true;
        bug.payoutAmount = amount;
        bug.payoutMultiplier = multiplier;
        nextPayoutIndex++;

        emit PayoutCompleted(reportHash, msg.sender, bug.reporter, multiplier, amount);
    }

    function publishBugDigest(BugInput calldata input, uint256 nonce, uint64 deadline, address broker)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(_publishBugStructHash(input, nonce, deadline, broker));
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

    function getReport(bytes32 reportHash) external view returns (Bug memory) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bugs[reportHash];
    }

    function bondVoteCount(bytes32 reportHash) external view returns (uint256) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bondVoteVoters[reportHash].length;
    }

    function bondVoteVoterAt(bytes32 reportHash, uint256 index) external view returns (address) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bondVoteVoters[reportHash][index];
    }

    function getBondVote(bytes32 reportHash, address voter) external view returns (BondVote memory) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bondVotes[reportHash][voter];
    }

    function brokerCount() external view returns (uint256) {
        return brokerList.length;
    }

    function brokerAt(uint256 index) external view returns (address) {
        return brokerList[index];
    }

    function adminCount() external view returns (uint256) {
        return adminList.length;
    }

    function adminAt(uint256 index) external view returns (address) {
        return adminList[index];
    }

    function nextPayoutReportHash() external view returns (bytes32) {
        if (nextPayoutIndex >= reportHashes.length) {
            return bytes32(0);
        }
        return reportHashes[nextPayoutIndex];
    }

    function _storeBug(BugInput calldata input) private {
        if (exists[input.reportHash]) revert SubmissionExists(input.reportHash);
        if (input.reportHash == bytes32(0)) revert InvalidField("reportHash");
        if (input.reporter == address(0)) revert InvalidField("reporter");
        if (input.createdAt == 0) revert InvalidField("createdAt");
        if (bytes(input.reportId).length == 0) revert InvalidField("reportId");
        if (bytes(input.publicSummary).length == 0) revert InvalidField("publicSummary");
        if (bytes(input.bugBundleCid).length == 0) revert InvalidField("bugBundleCid");
        if (input.contentHash == bytes32(0)) revert InvalidField("contentHash");
        if (input.bugBundleHash == bytes32(0)) revert InvalidField("bugBundleHash");
        if (input.encryptedDetailsHash == bytes32(0)) revert InvalidField("encryptedDetailsHash");
        if (input.detailsKeyCommitment == bytes32(0)) revert InvalidField("detailsKeyCommitment");
        if (uint256(input.revealAfter) < block.timestamp + JUDGMENT_PERIOD) {
            revert InvalidRevealAfter(input.revealAfter);
        }

        Bug memory bug = Bug({
            reportHash: input.reportHash,
            reportId: input.reportId,
            reporter: input.reporter,
            createdAt: input.createdAt,
            disclosureMode: input.disclosureMode,
            publicSummary: input.publicSummary,
            encryptedPayloadCid: input.bugBundleCid,
            targetKind: input.targetKind,
            targetRefHash: input.targetRefHash,
            tags: input.tags,
            contentHash: input.contentHash,
            bugBundleHash: input.bugBundleHash,
            encryptedDetailsHash: input.encryptedDetailsHash,
            detailsKeyCommitment: input.detailsKeyCommitment,
            revealAfter: input.revealAfter,
            detailsKey: bytes32(0),
            detailsKeyRevealed: false,
            status: BugStatus.Unreviewed,
            payoutCompleted: false,
            payoutAmount: 0,
            payoutMultiplier: 0
        });

        bugs[input.reportHash] = bug;
        exists[input.reportHash] = true;
        reportHashes.push(input.reportHash);

        emit BugPublished(
            input.reportHash,
            input.reportId,
            input.reporter,
            msg.sender,
            input.createdAt,
            input.revealAfter,
            input.bugBundleCid,
            input.detailsKeyCommitment
        );
    }

    function _revealDetailsKey(bytes32 reportHash, bytes32 detailsKey) private {
        Bug storage bug = bugs[reportHash];
        if (block.timestamp < bug.revealAfter) revert RevealNotReady(bug.revealAfter);
        if (detailsKey == bytes32(0) || sha256(abi.encodePacked(detailsKey)) != bug.detailsKeyCommitment) {
            revert InvalidDetailsKey();
        }

        if (bug.detailsKeyRevealed) {
            if (bug.detailsKey != detailsKey) revert DetailKeyAlreadyRevealed(reportHash);
            return;
        }

        bug.detailsKey = detailsKey;
        bug.detailsKeyRevealed = true;
        emit DetailsKeyRevealed(reportHash, detailsKey);
    }

    function _publishBugStructHash(BugInput calldata input, uint256 nonce, uint64 deadline, address broker)
        private
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PUBLISH_BUG_TYPEHASH,
                input.reportHash,
                keccak256(bytes(input.reportId)),
                input.reporter,
                input.createdAt,
                uint8(input.disclosureMode),
                keccak256(bytes(input.publicSummary)),
                keccak256(bytes(input.bugBundleCid)),
                uint8(input.targetKind),
                input.targetRefHash,
                keccak256(bytes(input.tags)),
                input.contentHash,
                input.bugBundleHash,
                input.encryptedDetailsHash,
                input.detailsKeyCommitment,
                input.revealAfter,
                nonce,
                deadline,
                broker
            )
        );
    }

    function _setBroker(address broker, bool allowed) private {
        if (broker == address(0)) revert InvalidAddress();
        brokers[broker] = allowed;
        if (allowed) {
            _ensureListed(broker, brokerList, brokerIndexPlusOne);
        } else {
            _removeListed(broker, brokerList, brokerIndexPlusOne);
        }
        emit BrokerSet(broker, allowed);
    }

    function _setAdmin(address admin, bool allowed) private {
        if (admin == address(0)) revert InvalidAddress();
        admins[admin] = allowed;
        if (allowed) {
            _ensureListed(admin, adminList, adminIndexPlusOne);
        } else {
            _removeListed(admin, adminList, adminIndexPlusOne);
        }
        emit AdminSet(admin, allowed);
    }

    function _ensureListed(address account, address[] storage list, mapping(address => uint256) storage indexPlusOne)
        private
    {
        if (indexPlusOne[account] != 0) {
            return;
        }

        list.push(account);
        indexPlusOne[account] = list.length;
    }

    function _removeListed(address account, address[] storage list, mapping(address => uint256) storage indexPlusOne)
        private
    {
        uint256 currentIndexPlusOne = indexPlusOne[account];
        if (currentIndexPlusOne == 0) {
            return;
        }

        uint256 index = currentIndexPlusOne - 1;
        uint256 lastIndex = list.length - 1;
        if (index != lastIndex) {
            address moved = list[lastIndex];
            list[index] = moved;
            indexPlusOne[moved] = index + 1;
        }

        list.pop();
        delete indexPlusOne[account];
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @notice Minimal bond vault interface used by the index for vote-weight snapshots.
interface ICheapBugsBondVault {
    /// @notice Returns the caller's current voting level from active BUGZ bond only.
    /// @param account Account to inspect.
    /// @return Voting level used as vote weight.
    function getLevel(address account) external view returns (uint8);
}

/// @notice Minimal treasury interface used by the index for ordered reward payouts.
interface ICheapBugsTreasuryVault {
    /// @notice Pays a reporter reward when requested by the index.
    /// @param broker Broker completing the payout.
    /// @param recipient Reporter receiving BUGZ.
    /// @param multiplier Reward multiplier selected by the broker.
    /// @return Amount of BUGZ paid.
    function payRewardFromIndex(address broker, address recipient, uint8 multiplier) external returns (uint256);
}

/// @title CheapBugsBugIndex
/// @notice Canonical onchain index of broker-published CheapBugs reports, admin status flags, bonded votes, reveals, and ordered payouts.
/// @dev Brokers publish with an EIP-712 reporter signature over `PublishBug`. The signature intentionally binds the
/// canonical encrypted BugBundle hash and commitments, not the IPFS CID, because the broker pins the bundle after
/// receiving the reporter-signed submission. The stored CID is still required and points at the pinned encrypted bundle.
contract CheapBugsBugIndex is Ownable, EIP712 {
    /// @notice Minimum review/reveal period before details can be revealed or payout completed.
    uint256 public constant JUDGMENT_PERIOD = 7 days;
    /// @notice Maximum reward multiplier a broker can choose for a valid bug.
    uint8 public constant MAX_PAYOUT_MULTIPLIER = 10;

    /// @dev EIP-712 type hash for reporter authorizations consumed by `publishBug`.
    bytes32 private constant PUBLISH_BUG_TYPEHASH = keccak256(
        "PublishBug(bytes32 reportHash,bytes32 reportIdHash,address reporter,uint64 createdAt,uint8 disclosureMode,bytes32 publicSummaryHash,uint8 targetKind,bytes32 targetRefHash,bytes32 tagsHash,bytes32 contentHash,bytes32 bugBundleHash,bytes32 encryptedDetailsHash,bytes32 detailsKeyCommitment,uint64 revealAfter,uint256 nonce,uint64 deadline,address broker)"
    );

    /// @notice Disclosure state requested by a reporter.
    enum DisclosureMode {
        /// @notice Private encrypted details until broker reveal.
        Private,
        /// @notice Embargoed report that can be revealed after the window.
        Embargoed,
        /// @notice Public report metadata and details are intended for public handling.
        Public
    }

    /// @notice Type of target affected by a bug report.
    enum TargetKind {
        Repo,
        Package,
        Domain,
        Contract,
        Protocol,
        Other
    }

    /// @notice Admin judgment used to guide payout decisions.
    enum BugStatus {
        /// @notice No admin has flagged this report yet.
        Unreviewed,
        /// @notice Report is valid and may receive a nonzero payout.
        Valid,
        /// @notice Report is invalid and must receive a zero multiplier.
        Invalid,
        /// @notice Report is spam and must receive a zero multiplier.
        Spam
    }

    /// @notice Full stored bug record.
    struct Bug {
        /// @notice Unique report hash signed by the reporter and used as the primary key.
        bytes32 reportHash;
        /// @notice Human-readable report id derived by the client from `reportHash`.
        string reportId;
        /// @notice Reporter address that signed the broker relay authorization.
        address reporter;
        /// @notice Reporter-created timestamp in seconds.
        uint64 createdAt;
        /// @notice Reporter-selected disclosure mode.
        DisclosureMode disclosureMode;
        /// @notice Public-safe report summary.
        string publicSummary;
        /// @notice IPFS URI of the encrypted BugBundle pinned by the broker.
        string encryptedPayloadCid;
        /// @notice Target category.
        TargetKind targetKind;
        /// @notice Hash of the target reference, keeping the full reference out of this contract.
        bytes32 targetRefHash;
        /// @notice Comma-separated public tags.
        string tags;
        /// @notice Hash of public/report content used by clients and broker checks.
        bytes32 contentHash;
        /// @notice Hash of the canonical encrypted BugBundle core signed by the reporter.
        bytes32 bugBundleHash;
        /// @notice Hash of encrypted private details ciphertext.
        bytes32 encryptedDetailsHash;
        /// @notice SHA-256 commitment to the 32-byte details key.
        bytes32 detailsKeyCommitment;
        /// @notice Earliest timestamp at which the details key can be revealed and payout completed.
        uint64 revealAfter;
        /// @notice Revealed 32-byte details key, or zero before reveal.
        bytes32 detailsKey;
        /// @notice True after a broker reveals the details key.
        bool detailsKeyRevealed;
        /// @notice Admin status flag used to constrain payout completion.
        BugStatus status;
        /// @notice True after the broker completes this report's ordered payout slot.
        bool payoutCompleted;
        /// @notice BUGZ amount paid to the reporter.
        uint256 payoutAmount;
        /// @notice Multiplier used for the completed payout.
        uint8 payoutMultiplier;
    }

    /// @notice Broker-published input for one new bug.
    /// @dev Every field except `bugBundleCid` is bound by the reporter's EIP-712 signature either directly or by hash.
    struct BugInput {
        /// @notice Unique report hash signed by the reporter.
        bytes32 reportHash;
        /// @notice Human-readable report id whose hash is signed by the reporter.
        string reportId;
        /// @notice Reporter that signed the publish authorization.
        address reporter;
        /// @notice Reporter-created timestamp in seconds.
        uint64 createdAt;
        /// @notice Reporter-selected disclosure mode.
        DisclosureMode disclosureMode;
        /// @notice Public-safe summary whose hash is signed by the reporter.
        string publicSummary;
        /// @notice Broker-pinned encrypted BugBundle CID/URI stored onchain after authorization.
        string bugBundleCid;
        /// @notice Target category signed by the reporter.
        TargetKind targetKind;
        /// @notice Hash of target reference signed by the reporter.
        bytes32 targetRefHash;
        /// @notice Tags string whose hash is signed by the reporter.
        string tags;
        /// @notice Public/report content hash signed by the reporter.
        bytes32 contentHash;
        /// @notice Canonical encrypted BugBundle hash signed by the reporter.
        bytes32 bugBundleHash;
        /// @notice Encrypted details ciphertext hash signed by the reporter.
        bytes32 encryptedDetailsHash;
        /// @notice SHA-256 details-key commitment signed by the reporter.
        bytes32 detailsKeyCommitment;
        /// @notice Earliest reveal and payout timestamp signed by the reporter.
        uint64 revealAfter;
    }

    /// @notice Snapshot of one bonded vote.
    struct BondVote {
        /// @notice Report hash being voted on.
        bytes32 reportHash;
        /// @notice Voter address.
        address voter;
        /// @notice Timestamp when the current vote value was submitted.
        uint64 createdAt;
        /// @notice True for upvote, false for downvote.
        bool support;
        /// @notice Vote weight snapshotted from `bondVault.getLevel(voter)`.
        uint8 weight;
    }

    /// @notice Bond vault used to snapshot voter levels.
    ICheapBugsBondVault public bondVault;
    /// @notice Treasury vault used for ordered reward payouts.
    ICheapBugsTreasuryVault public treasuryVault;

    /// @notice Whether an address can publish bugs, reveal details, and complete payouts.
    mapping(address => bool) public brokers;
    /// @notice Whether an address can flag report status.
    mapping(address => bool) public admins;
    /// @notice Reporter nonce replay protection for EIP-712 publish signatures.
    mapping(address => mapping(uint256 => bool)) public usedReporterNonces;
    /// @notice Whether a report hash exists in the index.
    mapping(bytes32 => bool) public exists;
    /// @dev Full report records keyed by report hash.
    mapping(bytes32 => Bug) private bugs;
    /// @dev Report hashes in insertion order; this order defines payout order.
    bytes32[] private reportHashes;

    /// @notice Whether a voter has ever submitted a vote for a report.
    mapping(bytes32 => mapping(address => bool)) public hasBondVote;
    /// @dev Latest vote snapshot keyed by report hash and voter.
    mapping(bytes32 => mapping(address => BondVote)) private bondVotes;
    /// @dev Enumerable voter list per report for offchain inspection.
    mapping(bytes32 => address[]) private bondVoteVoters;
    /// @notice Total current upvote weight for a report.
    mapping(bytes32 => uint256) public upVoteWeight;
    /// @notice Total current downvote weight for a report.
    mapping(bytes32 => uint256) public downVoteWeight;

    /// @dev Enumerable set of index-authorized brokers.
    address[] private brokerList;
    /// @dev One-based index into `brokerList`; zero means absent.
    mapping(address => uint256) private brokerIndexPlusOne;
    /// @dev Enumerable set of index-authorized admins.
    address[] private adminList;
    /// @dev One-based index into `adminList`; zero means absent.
    mapping(address => uint256) private adminIndexPlusOne;

    /// @notice Index in `reportHashes` of the next report eligible for payout completion.
    uint256 public nextPayoutIndex;

    /// @notice Emitted when owner changes the bond vault.
    /// @param bondVault New bond vault address.
    event BondVaultSet(address indexed bondVault);
    /// @notice Emitted when owner changes the treasury vault.
    /// @param treasuryVault New treasury vault address.
    event TreasuryVaultSet(address indexed treasuryVault);
    /// @notice Emitted when owner grants or removes broker authority.
    /// @param broker Broker account whose permission changed.
    /// @param allowed True when broker authority is granted.
    event BrokerSet(address indexed broker, bool allowed);
    /// @notice Emitted when owner grants or removes admin authority.
    /// @param admin Admin account whose permission changed.
    /// @param allowed True when admin authority is granted.
    event AdminSet(address indexed admin, bool allowed);
    /// @notice Emitted when a broker publishes a reporter-signed bug.
    /// @param reportHash Primary report hash.
    /// @param reportId Human-readable report id.
    /// @param reporter Reporter that signed the EIP-712 publish authorization.
    /// @param broker Broker that submitted the transaction.
    /// @param createdAt Reporter-created timestamp.
    /// @param revealAfter Earliest reveal and payout time.
    /// @param bugBundleCid IPFS URI for the encrypted BugBundle.
    /// @param detailsKeyCommitment SHA-256 commitment to the details key.
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
    /// @notice Emitted when an admin flags a report status.
    /// @param reportHash Report being flagged.
    /// @param admin Admin that set the status.
    /// @param status New status.
    event BugFlagged(bytes32 indexed reportHash, address indexed admin, BugStatus status);
    /// @notice Emitted when a bonded voter submits or updates a vote.
    /// @param reportHash Report being voted on.
    /// @param voter Voter address.
    /// @param support True for upvote, false for downvote.
    /// @param weight Snapshotted vote weight.
    event BondVoteSubmitted(bytes32 indexed reportHash, address indexed voter, bool support, uint8 weight);
    /// @notice Emitted when the details key becomes public.
    /// @param reportHash Report whose key was revealed.
    /// @param detailsKey Revealed 32-byte details key.
    event DetailsKeyRevealed(bytes32 indexed reportHash, bytes32 detailsKey);
    /// @notice Emitted after a report's ordered payout slot is completed.
    /// @param reportHash Report whose payout was completed.
    /// @param broker Broker that completed the payout.
    /// @param recipient Reporter that received the reward.
    /// @param multiplier Reward multiplier used.
    /// @param amount BUGZ amount paid.
    event PayoutCompleted(
        bytes32 indexed reportHash,
        address indexed broker,
        address indexed recipient,
        uint8 multiplier,
        uint256 amount
    );

    /// @notice Reverts when a different details key is supplied after reveal.
    /// @param reportHash Report whose key is already revealed.
    error DetailKeyAlreadyRevealed(bytes32 reportHash);
    /// @notice Reverts when a required address is zero.
    error InvalidAddress();
    /// @notice Reverts when a revealed key is zero or does not match `detailsKeyCommitment`.
    error InvalidDetailsKey();
    /// @notice Reverts when a required input field is empty or zero.
    /// @param field Name of the invalid field.
    error InvalidField(string field);
    /// @notice Reverts when a payout multiplier exceeds `MAX_PAYOUT_MULTIPLIER`.
    /// @param multiplier Invalid multiplier.
    error InvalidPayoutMultiplier(uint8 multiplier);
    /// @notice Reverts when `revealAfter` is less than seven days from publish time.
    /// @param revealAfter Invalid reveal timestamp.
    error InvalidRevealAfter(uint64 revealAfter);
    /// @notice Reverts when an admin tries to set a disallowed status.
    /// @param status Invalid status.
    error InvalidStatus(BugStatus status);
    /// @notice Reverts when a report hash is not present in the index.
    /// @param reportHash Missing report hash.
    error MissingBug(bytes32 reportHash);
    /// @notice Reverts when a voter has zero current voting level.
    /// @param voter Address with no voting power.
    error NoVotingPower(address voter);
    /// @notice Reverts when a reporter nonce has already been consumed.
    /// @param reporter Reporter address.
    /// @param nonce Used nonce.
    error NonceUsed(address reporter, uint256 nonce);
    /// @notice Reverts when caller lacks admin authority.
    error NotAdmin();
    /// @notice Reverts when caller lacks broker authority.
    error NotBroker();
    /// @notice Reverts when a broker attempts to complete payouts out of insertion order.
    /// @param expectedReportHash Report hash at the current payout cursor.
    /// @param actualReportHash Report hash supplied by the broker.
    error OutOfOrderPayout(bytes32 expectedReportHash, bytes32 actualReportHash);
    /// @notice Reverts when payout is attempted before an admin sets a final status.
    /// @param reportHash Report hash still unreviewed.
    error PayoutRequiresAdminStatus(bytes32 reportHash);
    /// @notice Reverts when invalid/spam reports are paid with a nonzero multiplier.
    /// @param status Status that requires a zero multiplier.
    error PayoutRequiresZeroMultiplier(BugStatus status);
    /// @notice Reverts when details reveal or payout is attempted before `revealAfter`.
    /// @param revealAfter Earliest reveal timestamp.
    error RevealNotReady(uint64 revealAfter);
    /// @notice Reverts when the reporter's EIP-712 signature deadline has passed.
    /// @param deadline Expired deadline.
    error SignatureExpired(uint64 deadline);
    /// @notice Reverts when a report hash already exists.
    /// @param reportHash Duplicate report hash.
    error SubmissionExists(bytes32 reportHash);
    /// @notice Reverts when voting is attempted after reveal time or payout completion.
    /// @param reportHash Report whose voting window is closed.
    error VotingClosed(bytes32 reportHash);
    /// @notice Reverts when an EIP-712 publish signature recovers to the wrong address.
    /// @param expected Reporter expected from the submitted bug input.
    /// @param recovered Address recovered from the signature.
    error WrongReporterSignature(address expected, address recovered);

    /// @dev Restricts execution to owner-authorized index brokers.
    modifier onlyBroker() {
        if (!brokers[msg.sender]) revert NotBroker();
        _;
    }

    /// @dev Restricts execution to owner-authorized index admins.
    modifier onlyAdmin() {
        if (!admins[msg.sender]) revert NotAdmin();
        _;
    }

    /// @notice Creates the bug index.
    /// @param initialOwner Owner that can manage vaults, brokers, and admins.
    /// @param initialBondVault Bond vault used for voting weight snapshots.
    /// @param initialTreasuryVault Treasury vault used for reward payouts.
    /// @param initialBrokers Brokers initially authorized to publish, reveal, and complete payouts.
    /// @param initialAdmins Admins initially authorized to flag report status.
    constructor(
        address initialOwner,
        ICheapBugsBondVault initialBondVault,
        ICheapBugsTreasuryVault initialTreasuryVault,
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

    /// @notice Sets the bond vault used for future vote-weight snapshots.
    /// @param newBondVault New bond vault address.
    function setBondVault(ICheapBugsBondVault newBondVault) external onlyOwner {
        if (address(newBondVault) == address(0)) revert InvalidAddress();
        bondVault = newBondVault;
        emit BondVaultSet(address(newBondVault));
    }

    /// @notice Sets the treasury vault used for future payouts.
    /// @param newTreasuryVault New treasury vault address.
    function setTreasuryVault(ICheapBugsTreasuryVault newTreasuryVault) external onlyOwner {
        if (address(newTreasuryVault) == address(0)) revert InvalidAddress();
        treasuryVault = newTreasuryVault;
        emit TreasuryVaultSet(address(newTreasuryVault));
    }

    /// @notice Grants or removes broker authority.
    /// @param broker Broker account to update.
    /// @param allowed True to allow broker operations.
    function setBroker(address broker, bool allowed) external onlyOwner {
        _setBroker(broker, allowed);
    }

    /// @notice Grants or removes admin authority.
    /// @param admin Admin account to update.
    /// @param allowed True to allow status flagging.
    function setAdmin(address admin, bool allowed) external onlyOwner {
        _setAdmin(admin, allowed);
    }

    /// @notice Publishes a reporter-signed bug into the index.
    /// @dev `reporterSignature` must be an EIP-712 signature over `PublishBug` for this contract, chain,
    /// reporter, nonce, deadline, and `msg.sender` as broker. The signature binds the BugBundle hash and
    /// commitments; `bugBundleCid` is stored but not part of the signature because brokers pin after authorization.
    /// @param input Bug metadata and commitments to store.
    /// @param nonce Reporter nonce consumed to prevent replay.
    /// @param deadline Latest timestamp at which the signature is valid.
    /// @param reporterSignature Reporter EIP-712 signature.
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

    /// @notice Flags a report as valid, invalid, or spam.
    /// @param reportHash Report hash to flag.
    /// @param status New non-`Unreviewed` status.
    function flagBug(bytes32 reportHash, BugStatus status) external onlyAdmin {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        if (status == BugStatus.Unreviewed) revert InvalidStatus(status);

        bugs[reportHash].status = status;
        emit BugFlagged(reportHash, msg.sender, status);
    }

    /// @notice Submits or updates a bonded vote before reveal time.
    /// @dev Vote weight is snapshotted from the current bond vault level and does not change unless the voter
    /// submits another vote. Pending withdrawals reduce level before the snapshot.
    /// @param reportHash Report hash to vote on.
    /// @param support True for upvote, false for downvote.
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

    /// @notice Reveals a report's details key after the judgment period.
    /// @param reportHash Report hash whose key is being revealed.
    /// @param detailsKey 32-byte details key that must match `detailsKeyCommitment`.
    function revealDetailsKey(bytes32 reportHash, bytes32 detailsKey) external onlyBroker {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        _revealDetailsKey(reportHash, detailsKey);
    }

    /// @notice Completes the next report payout in insertion order.
    /// @dev Also reveals the details key if needed. Valid reports may use multiplier 0-10; invalid and spam reports
    /// must use multiplier 0. The treasury independently checks that `msg.sender` remains a treasury-authorized broker.
    /// @param reportHash Report hash at the current payout cursor.
    /// @param multiplier Reward multiplier selected by the broker.
    /// @param detailsKey Details key to reveal, or zero only when the key was already revealed.
    function completePayout(bytes32 reportHash, uint8 multiplier, bytes32 detailsKey) external onlyBroker {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        if (multiplier > MAX_PAYOUT_MULTIPLIER) revert InvalidPayoutMultiplier(multiplier);
        if (nextPayoutIndex >= reportHashes.length) revert MissingBug(reportHash);

        bytes32 expectedReportHash = reportHashes[nextPayoutIndex];
        if (expectedReportHash != reportHash) revert OutOfOrderPayout(expectedReportHash, reportHash);

        Bug storage bug = bugs[reportHash];
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

    /// @notice Returns the EIP-712 digest a reporter must sign for `publishBug`.
    /// @param input Bug metadata and commitments.
    /// @param nonce Reporter nonce.
    /// @param deadline Signature deadline.
    /// @param broker Broker address authorized by this signature.
    /// @return EIP-712 digest.
    function publishBugDigest(BugInput calldata input, uint256 nonce, uint64 deadline, address broker)
        public
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(_publishBugStructHash(input, nonce, deadline, broker));
    }

    /// @notice Returns number of reports in insertion order.
    /// @return Report count.
    function reportCount() external view returns (uint256) {
        return reportHashes.length;
    }

    /// @notice Returns a report hash by insertion index.
    /// @param index Zero-based insertion index.
    /// @return Report hash at `index`.
    function reportHashAt(uint256 index) external view returns (bytes32) {
        return reportHashes[index];
    }

    /// @notice Returns the most recent report hashes in reverse insertion order.
    /// @param limit Maximum number of hashes to return.
    /// @return Latest report hashes, newest first.
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

    /// @notice Returns the full stored report.
    /// @param reportHash Report hash to inspect.
    /// @return Stored bug record.
    function getReport(bytes32 reportHash) external view returns (Bug memory) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bugs[reportHash];
    }

    /// @notice Returns number of distinct voters for a report.
    /// @param reportHash Report hash to inspect.
    /// @return Voter count.
    function bondVoteCount(bytes32 reportHash) external view returns (uint256) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bondVoteVoters[reportHash].length;
    }

    /// @notice Returns a report voter by index.
    /// @param reportHash Report hash to inspect.
    /// @param index Zero-based voter index.
    /// @return Voter address.
    function bondVoteVoterAt(bytes32 reportHash, uint256 index) external view returns (address) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bondVoteVoters[reportHash][index];
    }

    /// @notice Returns a voter's current stored vote snapshot for a report.
    /// @param reportHash Report hash to inspect.
    /// @param voter Voter address.
    /// @return Bond vote snapshot. Returns zero values for an address that has not voted.
    function getBondVote(bytes32 reportHash, address voter) external view returns (BondVote memory) {
        if (!exists[reportHash]) revert MissingBug(reportHash);
        return bondVotes[reportHash][voter];
    }

    /// @notice Returns number of index-authorized brokers.
    /// @return Broker count.
    function brokerCount() external view returns (uint256) {
        return brokerList.length;
    }

    /// @notice Returns a broker by index.
    /// @param index Zero-based broker-list index.
    /// @return Broker address.
    function brokerAt(uint256 index) external view returns (address) {
        return brokerList[index];
    }

    /// @notice Returns number of authorized admins.
    /// @return Admin count.
    function adminCount() external view returns (uint256) {
        return adminList.length;
    }

    /// @notice Returns an admin by index.
    /// @param index Zero-based admin-list index.
    /// @return Admin address.
    function adminAt(uint256 index) external view returns (address) {
        return adminList[index];
    }

    /// @notice Returns the report hash currently expected for the next payout.
    /// @return Next payout report hash, or zero if all reports are complete.
    function nextPayoutReportHash() external view returns (bytes32) {
        if (nextPayoutIndex >= reportHashes.length) {
            return bytes32(0);
        }
        return reportHashes[nextPayoutIndex];
    }

    /// @dev Validates and stores a broker-submitted bug after reporter signature verification.
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

    /// @dev Reveals a post-window details key after checking it against the stored SHA-256 commitment.
    function _revealDetailsKey(bytes32 reportHash, bytes32 detailsKey) private {
        Bug storage bug = bugs[reportHash];
        if (block.timestamp < bug.revealAfter) revert RevealNotReady(bug.revealAfter);
        if (bug.detailsKeyRevealed) {
            if (bug.detailsKey != detailsKey) revert DetailKeyAlreadyRevealed(reportHash);
            return;
        }
        if (detailsKey == bytes32(0) || sha256(abi.encodePacked(detailsKey)) != bug.detailsKeyCommitment) {
            revert InvalidDetailsKey();
        }

        bug.detailsKey = detailsKey;
        bug.detailsKeyRevealed = true;
        emit DetailsKeyRevealed(reportHash, detailsKey);
    }

    /// @dev Builds the EIP-712 struct hash for a reporter's `PublishBug` authorization.
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

    /// @dev Applies broker permission changes and keeps the enumerable broker set synchronized.
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

    /// @dev Applies admin permission changes and keeps the enumerable admin set synchronized.
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

    /// @dev Adds `account` to an enumerable one-based-indexed address set.
    function _ensureListed(address account, address[] storage list, mapping(address => uint256) storage indexPlusOne)
        private
    {
        if (indexPlusOne[account] != 0) {
            return;
        }

        list.push(account);
        indexPlusOne[account] = list.length;
    }

    /// @dev Removes `account` from an enumerable one-based-indexed address set using swap-and-pop.
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

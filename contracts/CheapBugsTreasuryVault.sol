// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CheapBugsTreasuryVault
/// @notice Holds BUGZ treasury funds, records detail-key purchases, and pays ordered reporter rewards for the index.
/// @dev Only the configured index can trigger rewards. The index passes the broker address so the treasury can
/// enforce its own broker allowlist in addition to the index broker allowlist.
contract CheapBugsTreasuryVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Live BUGZ ERC20 address on Base.
    address public constant BUGZ_TOKEN_ADDRESS = 0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07;
    /// @notice Default divisor for the standard payout: treasury balance divided by 1,000.
    uint256 public constant DEFAULT_STANDARD_PAYOUT_DIVISOR = 1_000;
    /// @notice Maximum broker-selected reward multiplier for high-interest bugs.
    uint8 public constant MAX_REWARD_MULTIPLIER = 10;

    /// @notice One detail-key purchase record.
    struct DetailKeyPurchase {
        /// @notice Report hash whose key was purchased.
        bytes32 reportHash;
        /// @notice Buyer that paid BUGZ for the detail key.
        address buyer;
        /// @notice BUGZ amount paid in this purchase.
        uint256 amount;
        /// @notice Buyer total paid for this report after this purchase.
        uint256 totalPaid;
        /// @notice Timestamp when this purchase was recorded.
        uint64 createdAt;
    }

    /// @notice Bug index contract authorized to request reward payouts.
    address public index;
    /// @notice Divisor used to calculate the base payout from the current treasury balance.
    uint256 public standardPayoutDivisor = DEFAULT_STANDARD_PAYOUT_DIVISOR;

    /// @notice Whether an address is authorized as a broker for treasury payouts.
    mapping(address => bool) public brokers;
    /// @notice Total BUGZ paid by buyer for a given report hash.
    mapping(bytes32 => mapping(address => uint256)) public detailKeyPayments;

    /// @dev Enumerable set of treasury-authorized brokers.
    address[] private brokerList;
    /// @dev One-based index into `brokerList`; zero means absent.
    mapping(address => uint256) private brokerIndexPlusOne;
    /// @dev Append-only purchase ledger used by brokers to audit detail-key payments.
    DetailKeyPurchase[] private detailKeyPurchases;

    /// @notice Emitted when the authorized index changes.
    /// @param index Index address authorized to call payout functions.
    event IndexSet(address indexed index);
    /// @notice Emitted when owner grants or removes treasury broker authority.
    /// @param broker Broker whose permission changed.
    /// @param allowed True when broker is authorized for rewards.
    event BrokerSet(address indexed broker, bool allowed);
    /// @notice Emitted when owner changes the base payout divisor.
    /// @param divisor New payout divisor.
    event StandardPayoutDivisorSet(uint256 divisor);
    /// @notice Emitted when BUGZ is deposited into the treasury.
    /// @param from Address that funded the treasury.
    /// @param amount BUGZ amount deposited.
    event TreasuryDeposit(address indexed from, uint256 amount);
    /// @notice Emitted when a user pays for a report detail key.
    /// @param reportHash Report hash whose key was purchased.
    /// @param buyer Address that paid BUGZ.
    /// @param amount BUGZ amount paid in this transaction.
    /// @param totalPaid Buyer total paid for this report after this purchase.
    /// @param createdAt Timestamp when the purchase was recorded.
    event DetailKeyPurchased(
        bytes32 indexed reportHash,
        address indexed buyer,
        uint256 amount,
        uint256 totalPaid,
        uint64 createdAt
    );
    /// @notice Emitted when the index pays a reporter reward from the treasury.
    /// @param broker Broker credited with completing the payout.
    /// @param recipient Reporter receiving BUGZ.
    /// @param multiplier Reward multiplier selected by the broker.
    /// @param amount BUGZ amount paid.
    event RewardPaid(address indexed broker, address indexed recipient, uint8 multiplier, uint256 amount);

    /// @notice Reverts when a required address is zero.
    error InvalidAddress();
    /// @notice Reverts when a payment or deposit amount is zero.
    error InvalidAmount();
    /// @notice Reverts when a reward multiplier exceeds `MAX_REWARD_MULTIPLIER`.
    /// @param multiplier Invalid multiplier.
    error InvalidMultiplier(uint8 multiplier);
    /// @notice Reverts when owner attempts to set the payout divisor to zero.
    error InvalidPayoutDivisor();
    /// @notice Reverts when the index requests a reward for a broker not authorized by treasury.
    /// @param broker Unauthorized broker.
    error NotBroker(address broker);
    /// @notice Reverts when a caller other than `index` requests a payout.
    error NotIndex();

    /// @dev Restricts execution to the configured bug index.
    modifier onlyIndex() {
        if (msg.sender != index) revert NotIndex();
        _;
    }

    /// @notice Creates the treasury vault.
    /// @param initialOwner Owner that can manage index, brokers, and payout divisor.
    constructor(address initialOwner) Ownable(initialOwner) { }

    /// @notice Returns the live BUGZ ERC20 interface.
    /// @return BUGZ token interface at `BUGZ_TOKEN_ADDRESS`.
    function bugz() public pure returns (IERC20) {
        return IERC20(BUGZ_TOKEN_ADDRESS);
    }

    /// @notice Sets the bug index authorized to request payouts.
    /// @param indexAddress New index address.
    function setIndex(address indexAddress) external onlyOwner {
        if (indexAddress == address(0)) revert InvalidAddress();
        index = indexAddress;
        emit IndexSet(indexAddress);
    }

    /// @notice Grants or removes treasury broker authority.
    /// @param broker Broker account to update.
    /// @param allowed True to authorize reward payouts for this broker.
    function setBroker(address broker, bool allowed) external onlyOwner {
        if (broker == address(0)) revert InvalidAddress();
        brokers[broker] = allowed;
        if (allowed) {
            _ensureBroker(broker);
        } else {
            _removeBroker(broker);
        }
        emit BrokerSet(broker, allowed);
    }

    /// @notice Sets the divisor used for base reporter rewards.
    /// @param divisor New nonzero divisor. Base payout is `balance / divisor`.
    function setStandardPayoutDivisor(uint256 divisor) external onlyOwner {
        if (divisor == 0) revert InvalidPayoutDivisor();
        standardPayoutDivisor = divisor;
        emit StandardPayoutDivisorSet(divisor);
    }

    /// @notice Deposits BUGZ into the treasury.
    /// @param amount BUGZ amount to transfer from the caller.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        bugz().safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposit(msg.sender, amount);
    }

    /// @notice Pays BUGZ for a report's detail key and records the buyer's total payment.
    /// @param reportHash Report hash whose details key is being purchased.
    /// @param amount BUGZ amount to transfer from the buyer.
    function purchaseDetailKey(bytes32 reportHash, uint256 amount) external nonReentrant {
        if (reportHash == bytes32(0) || amount == 0) revert InvalidAmount();

        bugz().safeTransferFrom(msg.sender, address(this), amount);

        uint256 totalPaid = detailKeyPayments[reportHash][msg.sender] + amount;
        detailKeyPayments[reportHash][msg.sender] = totalPaid;
        uint64 createdAt = uint64(block.timestamp);
        detailKeyPurchases.push(
            DetailKeyPurchase({
                reportHash: reportHash,
                buyer: msg.sender,
                amount: amount,
                totalPaid: totalPaid,
                createdAt: createdAt
            })
        );

        emit DetailKeyPurchased(reportHash, msg.sender, amount, totalPaid, createdAt);
    }

    /// @notice Pays a reporter reward when called by the configured index.
    /// @dev Reward amount is calculated from the treasury balance at call time before the transfer.
    /// @param broker Broker completing the payout; must be authorized in this treasury.
    /// @param recipient Reporter receiving BUGZ.
    /// @param multiplier Reward multiplier from 0 to `MAX_REWARD_MULTIPLIER`.
    /// @return amount BUGZ paid to `recipient`.
    function payRewardFromIndex(address broker, address recipient, uint8 multiplier)
        external
        onlyIndex
        nonReentrant
        returns (uint256 amount)
    {
        if (!brokers[broker]) revert NotBroker(broker);
        if (recipient == address(0)) revert InvalidAddress();
        amount = calculateRewardAmount(multiplier);

        if (amount != 0) {
            bugz().safeTransfer(recipient, amount);
        }

        emit RewardPaid(broker, recipient, multiplier, amount);
    }

    /// @notice Calculates reward amount for a multiplier using the current treasury balance and divisor.
    /// @param multiplier Reward multiplier from 0 to `MAX_REWARD_MULTIPLIER`.
    /// @return Reward amount in BUGZ base units.
    function calculateRewardAmount(uint8 multiplier) public view returns (uint256) {
        if (multiplier > MAX_REWARD_MULTIPLIER) revert InvalidMultiplier(multiplier);
        return (bugz().balanceOf(address(this)) * multiplier) / standardPayoutDivisor;
    }

    /// @notice Returns the number of treasury-authorized brokers.
    /// @return Broker count.
    function brokerCount() external view returns (uint256) {
        return brokerList.length;
    }

    /// @notice Returns a broker address by index.
    /// @param brokerIndex Zero-based broker-list index.
    /// @return Broker address.
    function brokerAt(uint256 brokerIndex) external view returns (address) {
        return brokerList[brokerIndex];
    }

    /// @notice Returns the number of detail-key purchase records.
    /// @return Purchase record count.
    function detailKeyPurchaseCount() external view returns (uint256) {
        return detailKeyPurchases.length;
    }

    /// @notice Returns a detail-key purchase record by index.
    /// @param purchaseIndex Zero-based purchase index.
    /// @return Purchase record.
    function detailKeyPurchaseAt(uint256 purchaseIndex) external view returns (DetailKeyPurchase memory) {
        return detailKeyPurchases[purchaseIndex];
    }

    /// @dev Adds `broker` to the enumerable broker set if it is not already present.
    function _ensureBroker(address broker) private {
        if (brokerIndexPlusOne[broker] != 0) {
            return;
        }

        brokerList.push(broker);
        brokerIndexPlusOne[broker] = brokerList.length;
    }

    /// @dev Removes `broker` from the enumerable broker set if it is present.
    function _removeBroker(address broker) private {
        uint256 indexPlusOne = brokerIndexPlusOne[broker];
        if (indexPlusOne == 0) {
            return;
        }

        uint256 brokerListIndex = indexPlusOne - 1;
        uint256 lastIndex = brokerList.length - 1;
        if (brokerListIndex != lastIndex) {
            address moved = brokerList[lastIndex];
            brokerList[brokerListIndex] = moved;
            brokerIndexPlusOne[moved] = brokerListIndex + 1;
        }

        brokerList.pop();
        delete brokerIndexPlusOne[broker];
    }
}

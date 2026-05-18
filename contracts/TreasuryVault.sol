// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract TreasuryVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DEFAULT_STANDARD_PAYOUT_DIVISOR = 1_000;
    uint8 public constant MAX_REWARD_MULTIPLIER = 10;

    struct DetailKeyPurchase {
        bytes32 reportHash;
        address buyer;
        uint256 amount;
        uint256 totalPaid;
        uint64 createdAt;
    }

    IERC20 public immutable bugz;
    address public index;
    uint256 public standardPayoutDivisor = DEFAULT_STANDARD_PAYOUT_DIVISOR;

    mapping(address => bool) public brokers;
    mapping(bytes32 => mapping(address => uint256)) public detailKeyPayments;

    address[] private brokerList;
    mapping(address => uint256) private brokerIndexPlusOne;
    DetailKeyPurchase[] private detailKeyPurchases;

    event IndexSet(address indexed index);
    event BrokerSet(address indexed broker, bool allowed);
    event StandardPayoutDivisorSet(uint256 divisor);
    event TreasuryDeposit(address indexed from, uint256 amount);
    event DetailKeyPurchased(
        bytes32 indexed reportHash,
        address indexed buyer,
        uint256 amount,
        uint256 totalPaid,
        uint64 createdAt
    );
    event RewardPaid(address indexed broker, address indexed recipient, uint8 multiplier, uint256 amount);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidMultiplier(uint8 multiplier);
    error InvalidPayoutDivisor();
    error NotBroker(address broker);
    error NotIndex();

    modifier onlyIndex() {
        if (msg.sender != index) revert NotIndex();
        _;
    }

    constructor(IERC20 bugzToken, address initialOwner) Ownable(initialOwner) {
        if (address(bugzToken) == address(0)) revert InvalidAddress();
        bugz = bugzToken;
    }

    function setIndex(address indexAddress) external onlyOwner {
        if (indexAddress == address(0)) revert InvalidAddress();
        index = indexAddress;
        emit IndexSet(indexAddress);
    }

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

    function setStandardPayoutDivisor(uint256 divisor) external onlyOwner {
        if (divisor == 0) revert InvalidPayoutDivisor();
        standardPayoutDivisor = divisor;
        emit StandardPayoutDivisorSet(divisor);
    }

    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        bugz.safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposit(msg.sender, amount);
    }

    function purchaseDetailKey(bytes32 reportHash, uint256 amount) external nonReentrant {
        if (reportHash == bytes32(0) || amount == 0) revert InvalidAmount();

        bugz.safeTransferFrom(msg.sender, address(this), amount);

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
            bugz.safeTransfer(recipient, amount);
        }

        emit RewardPaid(broker, recipient, multiplier, amount);
    }

    function calculateRewardAmount(uint8 multiplier) public view returns (uint256) {
        if (multiplier > MAX_REWARD_MULTIPLIER) revert InvalidMultiplier(multiplier);
        return (bugz.balanceOf(address(this)) / standardPayoutDivisor) * multiplier;
    }

    function brokerCount() external view returns (uint256) {
        return brokerList.length;
    }

    function brokerAt(uint256 brokerIndex) external view returns (address) {
        return brokerList[brokerIndex];
    }

    function detailKeyPurchaseCount() external view returns (uint256) {
        return detailKeyPurchases.length;
    }

    function detailKeyPurchaseAt(uint256 purchaseIndex) external view returns (DetailKeyPurchase memory) {
        return detailKeyPurchases[purchaseIndex];
    }

    function _ensureBroker(address broker) private {
        if (brokerIndexPlusOne[broker] != 0) {
            return;
        }

        brokerList.push(broker);
        brokerIndexPlusOne[broker] = brokerList.length;
    }

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

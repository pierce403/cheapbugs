// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract BondVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant WITHDRAWAL_DELAY = 7 days;
    uint256 public constant WHOLE_BUGZ = 1e18;
    uint16 public constant MAX_SLASH_BPS = 10_000;

    struct BondAccount {
        uint256 active;
        uint256 pendingWithdrawal;
        uint64 withdrawAvailableAt;
    }

    IERC20 public immutable bugz;
    address public treasury;

    mapping(address => bool) public slashers;

    mapping(address => BondAccount) private accounts;
    address[] private bondedAddresses;
    mapping(address => uint256) private bondedAddressIndexPlusOne;

    event TreasurySet(address indexed treasury);
    event SlasherSet(address indexed slasher, bool allowed);
    event Bonded(address indexed account, uint256 amount, uint256 activeBond);
    event WithdrawalRequested(
        address indexed account,
        uint256 amount,
        uint256 pendingWithdrawal,
        uint64 withdrawAvailableAt
    );
    event WithdrawalCanceled(address indexed account, uint256 restoredAmount);
    event Withdrawn(address indexed account, uint256 amount);
    event BondSlashed(address indexed account, address indexed slasher, uint256 amount, uint16 slashBps);

    error InvalidAddress();
    error InvalidAmount();
    error InvalidSlashBps(uint16 slashBps);
    error InsufficientActiveBond(uint256 requested, uint256 active);
    error NoPendingWithdrawal();
    error NotSlasher();
    error WithdrawalNotReady(uint64 availableAt);

    modifier onlySlasher() {
        if (!slashers[msg.sender]) revert NotSlasher();
        _;
    }

    constructor(IERC20 bugzToken, address treasuryAddress, address initialOwner) Ownable(initialOwner) {
        if (address(bugzToken) == address(0) || treasuryAddress == address(0)) revert InvalidAddress();
        bugz = bugzToken;
        treasury = treasuryAddress;
        emit TreasurySet(treasuryAddress);
    }

    function setTreasury(address treasuryAddress) external onlyOwner {
        if (treasuryAddress == address(0)) revert InvalidAddress();
        treasury = treasuryAddress;
        emit TreasurySet(treasuryAddress);
    }

    function setSlasher(address slasher, bool allowed) external onlyOwner {
        if (slasher == address(0)) revert InvalidAddress();
        slashers[slasher] = allowed;
        emit SlasherSet(slasher, allowed);
    }

    function bond(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        BondAccount storage account = accounts[msg.sender];
        uint256 restoredAmount = account.pendingWithdrawal;
        if (restoredAmount != 0) {
            account.active += restoredAmount;
            account.pendingWithdrawal = 0;
            account.withdrawAvailableAt = 0;
            emit WithdrawalCanceled(msg.sender, restoredAmount);
        }

        bugz.safeTransferFrom(msg.sender, address(this), amount);
        account.active += amount;
        _ensureBondedAddress(msg.sender);

        emit Bonded(msg.sender, amount, account.active);
    }

    function requestWithdrawal(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        BondAccount storage account = accounts[msg.sender];
        if (amount > account.active) revert InsufficientActiveBond(amount, account.active);

        account.active -= amount;
        account.pendingWithdrawal += amount;
        account.withdrawAvailableAt = uint64(block.timestamp + WITHDRAWAL_DELAY);

        emit WithdrawalRequested(msg.sender, amount, account.pendingWithdrawal, account.withdrawAvailableAt);
    }

    function withdraw() external nonReentrant {
        BondAccount storage account = accounts[msg.sender];
        uint256 amount = account.pendingWithdrawal;
        if (amount == 0) revert NoPendingWithdrawal();
        if (block.timestamp < account.withdrawAvailableAt) revert WithdrawalNotReady(account.withdrawAvailableAt);

        account.pendingWithdrawal = 0;
        account.withdrawAvailableAt = 0;
        _removeBondedAddressIfEmpty(msg.sender);

        bugz.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function slash(address accountAddress, uint16 slashBps) external onlySlasher nonReentrant returns (uint256 amount) {
        if (slashBps == 0 || slashBps > MAX_SLASH_BPS) revert InvalidSlashBps(slashBps);

        BondAccount storage account = accounts[accountAddress];
        uint256 totalBond = account.active + account.pendingWithdrawal;
        amount = (totalBond * slashBps) / MAX_SLASH_BPS;
        if (amount == 0) revert InvalidAmount();

        uint256 fromPending = _min(account.pendingWithdrawal, amount);
        if (fromPending != 0) {
            account.pendingWithdrawal -= fromPending;
            if (account.pendingWithdrawal == 0) {
                account.withdrawAvailableAt = 0;
            }
        }

        uint256 fromActive = amount - fromPending;
        if (fromActive != 0) {
            account.active -= fromActive;
        }

        _removeBondedAddressIfEmpty(accountAddress);
        bugz.safeTransfer(treasury, amount);

        emit BondSlashed(accountAddress, msg.sender, amount, slashBps);
    }

    function bondOf(address accountAddress) external view returns (uint256) {
        BondAccount storage account = accounts[accountAddress];
        return account.active + account.pendingWithdrawal;
    }

    function activeBondOf(address accountAddress) external view returns (uint256) {
        return accounts[accountAddress].active;
    }

    function pendingWithdrawalOf(address accountAddress) external view returns (uint256) {
        return accounts[accountAddress].pendingWithdrawal;
    }

    function withdrawAvailableAt(address accountAddress) external view returns (uint64) {
        return accounts[accountAddress].withdrawAvailableAt;
    }

    function accountOf(address accountAddress) external view returns (BondAccount memory) {
        return accounts[accountAddress];
    }

    function getLevel(address accountAddress) external view returns (uint8) {
        uint256 wholeTokens = accounts[accountAddress].active / WHOLE_BUGZ;
        uint8 level = 0;

        while (wholeTokens >= 10) {
            wholeTokens /= 10;
            level++;
        }

        return level;
    }

    function bondedAddressCount() external view returns (uint256) {
        return bondedAddresses.length;
    }

    function bondedAddressAt(uint256 index) external view returns (address) {
        return bondedAddresses[index];
    }

    function bondedAddressList(uint256 offset, uint256 limit) external view returns (address[] memory) {
        uint256 total = bondedAddresses.length;
        if (offset >= total) {
            return new address[](0);
        }

        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }

        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = bondedAddresses[i];
        }
        return result;
    }

    function _ensureBondedAddress(address accountAddress) private {
        if (bondedAddressIndexPlusOne[accountAddress] != 0) {
            return;
        }

        bondedAddresses.push(accountAddress);
        bondedAddressIndexPlusOne[accountAddress] = bondedAddresses.length;
    }

    function _removeBondedAddressIfEmpty(address accountAddress) private {
        BondAccount storage account = accounts[accountAddress];
        if (account.active + account.pendingWithdrawal != 0) {
            return;
        }

        uint256 indexPlusOne = bondedAddressIndexPlusOne[accountAddress];
        if (indexPlusOne == 0) {
            return;
        }

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = bondedAddresses.length - 1;
        if (index != lastIndex) {
            address moved = bondedAddresses[lastIndex];
            bondedAddresses[index] = moved;
            bondedAddressIndexPlusOne[moved] = index + 1;
        }

        bondedAddresses.pop();
        delete bondedAddressIndexPlusOne[accountAddress];
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

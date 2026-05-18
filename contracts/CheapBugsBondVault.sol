// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title CheapBugsBondVault
/// @notice Holds BUGZ bonds that give reporters/users reputation weight and remain slashable during withdrawals.
/// @dev The token address is the live Base BUGZ token. Pending withdrawals are still bonded exposure for slashing,
/// but they do not count toward `getLevel` voting power.
contract CheapBugsBondVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Live BUGZ ERC20 address on Base.
    address public constant BUGZ_TOKEN_ADDRESS = 0x60Df4a0C9A5050c337010cb29C9694cE4d8fbb07;
    /// @notice Delay between a withdrawal request and the earliest successful withdrawal.
    uint256 public constant WITHDRAWAL_DELAY = 7 days;
    /// @notice One whole BUGZ token in ERC20 base units.
    uint256 public constant WHOLE_BUGZ = 1e18;
    /// @notice Basis-point denominator and maximum slash amount.
    uint16 public constant MAX_SLASH_BPS = 10_000;

    /// @notice Bond accounting for one address.
    struct BondAccount {
        /// @notice BUGZ currently active for vote-level calculations.
        uint256 active;
        /// @notice BUGZ queued for delayed withdrawal and still slashable.
        uint256 pendingWithdrawal;
        /// @notice Unix timestamp when the pending withdrawal becomes claimable, or zero when none is pending.
        uint64 withdrawAvailableAt;
    }

    /// @notice Address that receives slashed BUGZ.
    address public treasury;

    /// @notice Whether an address is allowed to slash bonded accounts.
    mapping(address => bool) public slashers;

    /// @dev Internal bond ledger keyed by bonded address.
    mapping(address => BondAccount) private accounts;
    /// @dev Enumerable set of accounts with nonzero active or pending bond exposure.
    address[] private bondedAddresses;
    /// @dev One-based index into `bondedAddresses`; zero means absent.
    mapping(address => uint256) private bondedAddressIndexPlusOne;

    /// @notice Emitted when the slash treasury changes.
    /// @param treasury Address that receives future slashed BUGZ.
    event TreasurySet(address indexed treasury);
    /// @notice Emitted when owner grants or removes slashing authority.
    /// @param slasher Account whose slashing permission changed.
    /// @param allowed True when the account can slash bonds.
    event SlasherSet(address indexed slasher, bool allowed);
    /// @notice Emitted after BUGZ enters the vault as active bond.
    /// @param account Address that bonded BUGZ.
    /// @param amount BUGZ amount newly transferred into the vault.
    /// @param activeBond Account's active bond after the transfer and any withdrawal cancellation.
    event Bonded(address indexed account, uint256 amount, uint256 activeBond);
    /// @notice Emitted when active bond is moved into the delayed withdrawal queue.
    /// @param account Address requesting withdrawal.
    /// @param amount Active BUGZ newly moved to pending withdrawal.
    /// @param pendingWithdrawal Total pending withdrawal after this request.
    /// @param withdrawAvailableAt Earliest timestamp at which `account` can withdraw its pending BUGZ.
    event WithdrawalRequested(
        address indexed account,
        uint256 amount,
        uint256 pendingWithdrawal,
        uint64 withdrawAvailableAt
    );
    /// @notice Emitted when a new bond restores an account's pending withdrawal back to active bond.
    /// @param account Address whose pending withdrawal was canceled.
    /// @param restoredAmount Pending BUGZ restored to active bond.
    event WithdrawalCanceled(address indexed account, uint256 restoredAmount);
    /// @notice Emitted when a pending withdrawal leaves the vault.
    /// @param account Address receiving withdrawn BUGZ.
    /// @param amount BUGZ amount withdrawn.
    event Withdrawn(address indexed account, uint256 amount);
    /// @notice Emitted when a slasher removes bonded exposure and transfers it to the treasury.
    /// @param account Address whose active and/or pending bond was slashed.
    /// @param slasher Authorized slasher that executed the slash.
    /// @param amount BUGZ transferred to the treasury.
    /// @param slashBps Slash percentage in basis points.
    event BondSlashed(address indexed account, address indexed slasher, uint256 amount, uint16 slashBps);

    /// @notice Reverts when a required address is zero.
    error InvalidAddress();
    /// @notice Reverts when an amount is zero or a computed slash rounds to zero.
    error InvalidAmount();
    /// @notice Reverts when a slash basis-point value is zero or above 10,000.
    /// @param slashBps Invalid basis-point value.
    error InvalidSlashBps(uint16 slashBps);
    /// @notice Reverts when an account attempts to queue more active bond than it has.
    /// @param requested Requested withdrawal amount.
    /// @param active Current active bond amount.
    error InsufficientActiveBond(uint256 requested, uint256 active);
    /// @notice Reverts when an account tries to withdraw without a pending withdrawal.
    error NoPendingWithdrawal();
    /// @notice Reverts when an unauthorized address tries to slash.
    error NotSlasher();
    /// @notice Reverts when a pending withdrawal is claimed before the delay has elapsed.
    /// @param availableAt Earliest timestamp at which withdrawal is allowed.
    error WithdrawalNotReady(uint64 availableAt);

    /// @dev Restricts execution to owner-approved slashers.
    modifier onlySlasher() {
        if (!slashers[msg.sender]) revert NotSlasher();
        _;
    }

    /// @notice Creates the bond vault.
    /// @param treasuryAddress Address that receives slashed BUGZ.
    /// @param initialOwner Owner that can manage treasury and slashers.
    constructor(address treasuryAddress, address initialOwner) Ownable(initialOwner) {
        if (treasuryAddress == address(0)) revert InvalidAddress();
        treasury = treasuryAddress;
        emit TreasurySet(treasuryAddress);
    }

    /// @notice Returns the live BUGZ ERC20 interface.
    /// @return BUGZ token interface at `BUGZ_TOKEN_ADDRESS`.
    function bugz() public pure returns (IERC20) {
        return IERC20(BUGZ_TOKEN_ADDRESS);
    }

    /// @notice Sets the address that receives future slashed BUGZ.
    /// @param treasuryAddress New treasury address.
    function setTreasury(address treasuryAddress) external onlyOwner {
        if (treasuryAddress == address(0)) revert InvalidAddress();
        treasury = treasuryAddress;
        emit TreasurySet(treasuryAddress);
    }

    /// @notice Grants or removes bond-slashing authority.
    /// @param slasher Account to update.
    /// @param allowed True to allow slashing, false to revoke.
    function setSlasher(address slasher, bool allowed) external onlyOwner {
        if (slasher == address(0)) revert InvalidAddress();
        slashers[slasher] = allowed;
        emit SlasherSet(slasher, allowed);
    }

    /// @notice Bonds BUGZ into the vault as active voting/reputation stake.
    /// @dev Any pending withdrawal for the caller is canceled before new BUGZ is transferred in.
    /// @param amount BUGZ amount to transfer from the caller.
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

        bugz().safeTransferFrom(msg.sender, address(this), amount);
        account.active += amount;
        _ensureBondedAddress(msg.sender);

        emit Bonded(msg.sender, amount, account.active);
    }

    /// @notice Starts or extends a delayed withdrawal for active BUGZ.
    /// @dev Pending withdrawals remain slashable and reset to a fresh seven-day delay on each request.
    /// @param amount Active BUGZ amount to move into pending withdrawal.
    function requestWithdrawal(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();

        BondAccount storage account = accounts[msg.sender];
        if (amount > account.active) revert InsufficientActiveBond(amount, account.active);

        account.active -= amount;
        account.pendingWithdrawal += amount;
        account.withdrawAvailableAt = uint64(block.timestamp + WITHDRAWAL_DELAY);

        emit WithdrawalRequested(msg.sender, amount, account.pendingWithdrawal, account.withdrawAvailableAt);
    }

    /// @notice Withdraws all caller BUGZ that has completed the seven-day delay.
    function withdraw() external nonReentrant {
        BondAccount storage account = accounts[msg.sender];
        uint256 amount = account.pendingWithdrawal;
        if (amount == 0) revert NoPendingWithdrawal();
        if (block.timestamp < account.withdrawAvailableAt) revert WithdrawalNotReady(account.withdrawAvailableAt);

        account.pendingWithdrawal = 0;
        account.withdrawAvailableAt = 0;
        _removeBondedAddressIfEmpty(msg.sender);

        bugz().safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Slashes an account's total bonded exposure and transfers the slashed BUGZ to treasury.
    /// @dev Pending withdrawal balance is consumed before active balance. This preserves the anti-exit protection.
    /// @param accountAddress Account to slash.
    /// @param slashBps Slash percentage in basis points, where 10,000 is 100%.
    /// @return amount BUGZ amount transferred to treasury.
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
        bugz().safeTransfer(treasury, amount);

        emit BondSlashed(accountAddress, msg.sender, amount, slashBps);
    }

    /// @notice Returns active plus pending BUGZ for an account.
    /// @param accountAddress Account to inspect.
    /// @return Total slashable bonded exposure.
    function bondOf(address accountAddress) external view returns (uint256) {
        BondAccount storage account = accounts[accountAddress];
        return account.active + account.pendingWithdrawal;
    }

    /// @notice Returns BUGZ currently active for voting/reputation.
    /// @param accountAddress Account to inspect.
    /// @return Active BUGZ amount.
    function activeBondOf(address accountAddress) external view returns (uint256) {
        return accounts[accountAddress].active;
    }

    /// @notice Returns BUGZ queued for delayed withdrawal and still slashable.
    /// @param accountAddress Account to inspect.
    /// @return Pending withdrawal BUGZ amount.
    function pendingWithdrawalOf(address accountAddress) external view returns (uint256) {
        return accounts[accountAddress].pendingWithdrawal;
    }

    /// @notice Returns when an account's pending withdrawal can be claimed.
    /// @param accountAddress Account to inspect.
    /// @return Unix timestamp when withdrawal is available, or zero when no withdrawal is pending.
    function withdrawAvailableAt(address accountAddress) external view returns (uint64) {
        return accounts[accountAddress].withdrawAvailableAt;
    }

    /// @notice Returns the full bond account state.
    /// @param accountAddress Account to inspect.
    /// @return Bond account state.
    function accountOf(address accountAddress) external view returns (BondAccount memory) {
        return accounts[accountAddress];
    }

    /// @notice Returns floor(log10(active whole BUGZ)) for voting weight.
    /// @dev Pending withdrawals are excluded, so moving BUGZ into withdrawal immediately reduces vote power.
    /// @param accountAddress Account to inspect.
    /// @return Voting level. Accounts below 10 active whole BUGZ return zero under this formula.
    function getLevel(address accountAddress) external view returns (uint8) {
        uint256 wholeTokens = accounts[accountAddress].active / WHOLE_BUGZ;
        uint8 level = 0;

        while (wholeTokens >= 10) {
            wholeTokens /= 10;
            level++;
        }

        return level;
    }

    /// @notice Returns the number of addresses with nonzero active or pending bond.
    /// @return Bonded address count.
    function bondedAddressCount() external view returns (uint256) {
        return bondedAddresses.length;
    }

    /// @notice Returns a bonded address by index.
    /// @param index Zero-based index into the bonded address set.
    /// @return Bonded address at `index`.
    function bondedAddressAt(uint256 index) external view returns (address) {
        return bondedAddresses[index];
    }

    /// @notice Returns a page of bonded addresses.
    /// @param offset Zero-based start index.
    /// @param limit Maximum number of addresses to return.
    /// @return Page of bonded addresses. Returns an empty array if `offset` is past the end.
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

    /// @dev Adds `accountAddress` to the enumerable bonded set if it is not already present.
    function _ensureBondedAddress(address accountAddress) private {
        if (bondedAddressIndexPlusOne[accountAddress] != 0) {
            return;
        }

        bondedAddresses.push(accountAddress);
        bondedAddressIndexPlusOne[accountAddress] = bondedAddresses.length;
    }

    /// @dev Removes `accountAddress` from the enumerable bonded set once all slashable exposure is gone.
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

    /// @dev Returns the smaller of two unsigned integers.
    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}

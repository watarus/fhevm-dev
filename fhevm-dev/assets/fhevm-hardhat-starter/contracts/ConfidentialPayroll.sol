// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title ConfidentialPayroll
/// @notice Reference Confidential-Finance dApp for Zama's @fhevm/solidity v0.11.
///         An employer maintains an encrypted salary ledger: each employee's balance
///         is an `euint64` whose plaintext is visible only to the employer and the
///         employee (per-handle ACL). The total payroll is an `euint64` aggregate
///         visible only to the employer.
///
///         A payout flow demonstrates the v0.11 self-relayed public-decryption
///         idiom: the user submits an encrypted withdrawal request, the contract
///         clamps it to the available balance via `FHE.min`, marks the resulting
///         amount publicly decryptable, and the user relays the cleartext back via
///         `FHE.checkSignatures` to release ETH.
///
/// @dev Privacy model:
///      * Per-employee balance: confidential (employer + employee see it via userDecrypt).
///      * Total payroll: confidential (employer only).
///      * Individual payout amount: revealed to all on settlement (ETH transfer is
///        public anyway). The encrypted balance, however, stays confidential — only
///        the deltas drained over time are observable.
contract ConfidentialPayroll is ZamaEthereumConfig {
    // ─── State ───────────────────────────────────────────────────────────────

    address public immutable owner;

    mapping(address => euint64) private _salaries;
    euint64 private _totalPayroll;

    mapping(address => bool) public isEmployee;
    address[] private _employees;

    struct PendingPayout {
        address employee;
        euint64 actualEnc; // encrypted amount to release once settled
        bool settled;
    }
    uint256 public nextPayoutId;
    mapping(uint256 => PendingPayout) private _pending;

    // ─── Events ──────────────────────────────────────────────────────────────

    event EmployeeAdded(address indexed employee);
    event EmployeeRemoved(address indexed employee);
    event SalaryCredited(address indexed employee);
    event PayoutRequested(uint256 indexed payoutId, address indexed employee, bytes32 amountHandle);
    event PayoutSettled(uint256 indexed payoutId, address indexed employee, uint64 amount);

    // ─── Errors ──────────────────────────────────────────────────────────────

    error NotOwner();
    error NotEmployee();
    error AlreadyEmployee();
    error UnknownPayout();
    error PayoutAlreadySettled();
    error PayoutSenderMismatch();
    error EthTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    // ─── Employee management ─────────────────────────────────────────────────

    function addEmployee(address employee) external onlyOwner {
        if (employee == address(0)) revert NotEmployee();
        if (isEmployee[employee]) revert AlreadyEmployee();
        isEmployee[employee] = true;
        _employees.push(employee);
        emit EmployeeAdded(employee);
    }

    function removeEmployee(address employee) external onlyOwner {
        if (!isEmployee[employee]) revert NotEmployee();
        isEmployee[employee] = false;
        emit EmployeeRemoved(employee);
    }

    function employeeCount() external view returns (uint256) {
        return _employees.length;
    }

    function employeeAt(uint256 index) external view returns (address) {
        return _employees[index];
    }

    // ─── Credit salary (employer-only) ───────────────────────────────────────

    /// @notice Credit `amount` to `employee`'s encrypted salary balance and to the
    ///         encrypted total payroll. Emits ACL grants so the employer and the
    ///         employee can each user-decrypt their own view of the balance.
    function creditSalary(
        address employee,
        externalEuint64 amount,
        bytes calldata inputProof
    ) external onlyOwner {
        if (!isEmployee[employee]) revert NotEmployee();

        euint64 amt = FHE.fromExternal(amount, inputProof);

        // Salary balance: initialize on first credit, otherwise accumulate.
        euint64 newSalary = FHE.isInitialized(_salaries[employee])
            ? FHE.add(_salaries[employee], amt)
            : amt;
        _salaries[employee] = newSalary;
        FHE.allowThis(newSalary);
        FHE.allow(newSalary, owner);
        FHE.allow(newSalary, employee);

        // Total payroll: employer-visible aggregate.
        euint64 newTotal = FHE.isInitialized(_totalPayroll)
            ? FHE.add(_totalPayroll, amt)
            : amt;
        _totalPayroll = newTotal;
        FHE.allowThis(newTotal);
        FHE.allow(newTotal, owner);

        emit SalaryCredited(employee);
    }

    // ─── Read encrypted state (handles only — caller decrypts off-chain) ────

    function getSalary(address employee) external view returns (euint64) {
        return _salaries[employee];
    }

    function getTotalPayroll() external view returns (euint64) {
        return _totalPayroll;
    }

    // ─── Withdraw flow (two-step, self-relayed public decryption) ───────────

    /// @notice Step 1 of withdrawal. Caller submits an encrypted request amount.
    ///         The contract clamps it to `min(requested, balance)`, deducts the
    ///         clamped amount from the balance, and marks the clamped amount as
    ///         publicly decryptable so the user can self-relay it back in step 2.
    function requestPayout(externalEuint64 requested, bytes calldata inputProof) external returns (uint256 payoutId) {
        if (!isEmployee[msg.sender]) revert NotEmployee();

        euint64 req = FHE.fromExternal(requested, inputProof);
        euint64 balance = _salaries[msg.sender];
        // If no salary has ever been credited, balance handle is uninitialized;
        // FHE.min would still work after we treat balance as 0 by initializing it.
        if (!FHE.isInitialized(balance)) {
            balance = FHE.asEuint64(0);
        }

        euint64 actual = FHE.min(req, balance);

        euint64 newBalance = FHE.sub(balance, actual);
        _salaries[msg.sender] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, owner);
        FHE.allow(newBalance, msg.sender);

        euint64 newTotal = FHE.sub(_totalPayroll, actual);
        _totalPayroll = newTotal;
        FHE.allowThis(newTotal);
        FHE.allow(newTotal, owner);

        // Make `actual` publicly decryptable so the relayer SDK can produce a
        // KMS-signed cleartext that anyone can submit back to settlePayout.
        FHE.makePubliclyDecryptable(actual);
        FHE.allowThis(actual);

        payoutId = nextPayoutId++;
        _pending[payoutId] = PendingPayout({employee: msg.sender, actualEnc: actual, settled: false});

        emit PayoutRequested(payoutId, msg.sender, FHE.toBytes32(actual));
    }

    /// @notice Step 2 of withdrawal. Caller (the same employee) submits the
    ///         abi-encoded cleartext and KMS proof obtained from
    ///         `instance.publicDecrypt([handle])`. The contract verifies, decodes,
    ///         and releases ETH equal to the cleartext amount.
    /// @dev    Anyone may submit on the employee's behalf because the ETH is
    ///         always sent to `_pending[payoutId].employee`, but we restrict
    ///         to the employee themselves to keep the demo simple.
    function settlePayout(
        uint256 payoutId,
        bytes calldata abiEncodedCleartext,
        bytes calldata decryptionProof
    ) external {
        PendingPayout storage p = _pending[payoutId];
        if (p.employee == address(0)) revert UnknownPayout();
        if (p.settled) revert PayoutAlreadySettled();
        if (msg.sender != p.employee) revert PayoutSenderMismatch();

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(p.actualEnc);
        FHE.checkSignatures(cts, abiEncodedCleartext, decryptionProof);

        uint64 amount = abi.decode(abiEncodedCleartext, (uint64));
        p.settled = true;

        if (amount > 0) {
            (bool ok, ) = payable(p.employee).call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        }

        emit PayoutSettled(payoutId, p.employee, amount);
    }

    function getPendingPayout(uint256 payoutId)
        external
        view
        returns (address employee, bytes32 amountHandle, bool settled)
    {
        PendingPayout storage p = _pending[payoutId];
        return (p.employee, FHE.toBytes32(p.actualEnc), p.settled);
    }
}

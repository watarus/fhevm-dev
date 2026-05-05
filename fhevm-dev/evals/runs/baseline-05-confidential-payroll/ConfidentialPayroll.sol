// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Baseline: TFHE.* + GatewayCaller for the payout callback, plus a
// `confidentialBalanceOf` view function that calls TFHE.decrypt — the
// canonical "leaks the balance" anti-pattern that older tutorials reach for.

import "fhevm/lib/TFHE.sol";
import "fhevm/config/SepoliaConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";

contract ConfidentialPayroll is SepoliaConfig, GatewayCaller {
    address public owner;
    mapping(address => euint64) private salaries;
    mapping(address => bool) public isEmployee;
    euint64 private totalPayroll;
    mapping(uint256 => address) private pendingEmployee;

    constructor() { owner = msg.sender; }

    modifier onlyOwner() { require(msg.sender == owner, "no"); _; }

    function addEmployee(address a) external onlyOwner { isEmployee[a] = true; }

    function creditSalary(address e, einput amount, bytes calldata p) external onlyOwner {
        require(isEmployee[e], "not emp");
        euint64 amt = TFHE.asEuint64(amount, p);
        salaries[e] = TFHE.add(salaries[e], amt);
        totalPayroll = TFHE.add(totalPayroll, amt);
        TFHE.allow(salaries[e], e);
    }

    // ANTI-PATTERN: leaks the encrypted balance.
    function confidentialBalanceOf(address e) external view returns (uint64) {
        return TFHE.decrypt(salaries[e]);
    }

    function requestPayout(einput requestedAmount, bytes calldata p) external {
        require(isEmployee[msg.sender], "not emp");
        euint64 req = TFHE.asEuint64(requestedAmount, p);
        ebool affordable = TFHE.le(req, salaries[msg.sender]);
        // BUG: tries to require an ebool — does not compile.
        require(affordable, "insufficient");
        salaries[msg.sender] = TFHE.sub(salaries[msg.sender], req);
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(req);
        uint256 reqId = Gateway.requestDecryption(cts, this.payoutCallback.selector, 0, block.timestamp + 100, false);
        pendingEmployee[reqId] = msg.sender;
    }

    function payoutCallback(uint256 reqId, uint64 amount) external onlyGateway {
        address emp = pendingEmployee[reqId];
        payable(emp).transfer(amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Baseline: agent without the skill rolls a custom ERC-20-style token from
// scratch (because it does not know about OpenZeppelin's confidential-contracts
// package), uses TFHE.* and SepoliaConfig, and naively reverts on insufficient
// balance — leaking balance information to anyone who can probe with a transfer.

import "fhevm/lib/TFHE.sol";
import "fhevm/config/SepoliaConfig.sol";

contract ConfidentialERC20 is SepoliaConfig {
    address public owner;
    mapping(address => euint64) public balances;

    constructor() { owner = msg.sender; }

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    function mint(address to, einput amount, bytes calldata proof) external onlyOwner {
        euint64 amt = TFHE.asEuint64(amount, proof);
        balances[to] = TFHE.add(balances[to], amt);
        TFHE.allow(balances[to], to);
    }

    function confidentialTransfer(address to, einput amount, bytes calldata proof) external {
        euint64 amt = TFHE.asEuint64(amount, proof);
        // BUG: this branches on the underlying handle by trying to require an
        //      ebool, which does not even compile, but the agent emits it
        //      because it is mimicking plaintext ERC-20 patterns.
        require(TFHE.le(amt, balances[msg.sender]), "insufficient balance");
        balances[msg.sender] = TFHE.sub(balances[msg.sender], amt);
        balances[to] = TFHE.add(balances[to], amt);
        TFHE.allow(balances[msg.sender], msg.sender);
        TFHE.allow(balances[to], to);
    }
}

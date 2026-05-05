// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Baseline: agent reaches for the v0.8 sealed-bid-auction tutorial pattern
// from Zama's own main branch (still indexed by training data) — uses
// GatewayCaller and `Gateway.requestDecryption` for the reveal callback,
// neither of which exists in `@fhevm/solidity ^0.11`.

import "fhevm/lib/TFHE.sol";
import "fhevm/config/SepoliaConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";

contract SealedBidAuction is SepoliaConfig, GatewayCaller {
    address public beneficiary;
    uint256 public endTime;
    eaddress private winner;
    euint64 private highestBid;
    address public revealedWinner;

    constructor(address _b, uint256 _end) {
        beneficiary = _b;
        endTime = _end;
    }

    function bid(einput amountHandle, bytes calldata proof) external {
        require(block.timestamp < endTime, "ended");
        euint64 amount = TFHE.asEuint64(amountHandle, proof);
        ebool higher = TFHE.gt(amount, highestBid);
        highestBid = TFHE.select(higher, amount, highestBid);
        winner = TFHE.select(higher, TFHE.asEaddress(msg.sender), winner);
        TFHE.allow(highestBid, address(this));
    }

    function reveal() external {
        require(block.timestamp >= endTime, "still open");
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(winner);
        Gateway.requestDecryption(cts, this.callback.selector, 0, block.timestamp + 100, false);
    }

    function callback(uint256 /*requestId*/, address w) external onlyGateway {
        revealedWinner = w;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Skill run: SKILL.md decision tree + references/common-patterns.md +
// references/decryption-patterns.md push the agent to the v0.11 self-relayed
// public-decryption flow. No GatewayCaller, no requestDecryption, no
// onlyGateway callback.

import {FHE, ebool, euint64, eaddress, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract SealedBidAuction is ZamaEthereumConfig {
    address public immutable beneficiary;
    uint256 public immutable endTime;

    mapping(address => euint64) private _bids;
    euint64 private _highestBid;
    eaddress private _winner;

    bool public revealed;
    address public revealedWinner;
    uint64 public revealedPrice;

    constructor(address beneficiary_, uint256 endTime_) {
        beneficiary = beneficiary_;
        endTime = endTime_;
    }

    function bid(externalEuint64 amount, bytes calldata inputProof) external {
        require(block.timestamp < endTime, "ended");
        euint64 newBid = FHE.fromExternal(amount, inputProof);

        _bids[msg.sender] = FHE.isInitialized(_bids[msg.sender])
            ? FHE.max(_bids[msg.sender], newBid)
            : newBid;
        FHE.allowThis(_bids[msg.sender]);
        FHE.allow(_bids[msg.sender], msg.sender);

        if (FHE.isInitialized(_highestBid)) {
            ebool higher = FHE.gt(newBid, _highestBid);
            _highestBid = FHE.select(higher, newBid, _highestBid);
            _winner = FHE.select(higher, FHE.asEaddress(msg.sender), _winner);
        } else {
            _highestBid = newBid;
            _winner = FHE.asEaddress(msg.sender);
        }
        FHE.allowThis(_highestBid);
        FHE.allowThis(_winner);
    }

    function startReveal() external {
        require(block.timestamp >= endTime, "still open");
        require(!revealed, "already started");
        FHE.makePubliclyDecryptable(_winner);
        FHE.makePubliclyDecryptable(_highestBid);
    }

    function finalizeReveal(bytes calldata abiEncodedClear, bytes calldata proof) external {
        require(!revealed, "already revealed");
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(_winner);
        cts[1] = FHE.toBytes32(_highestBid);
        FHE.checkSignatures(cts, abiEncodedClear, proof);
        (address w, uint64 p) = abi.decode(abiEncodedClear, (address, uint64));
        revealedWinner = w;
        revealedPrice = p;
        revealed = true;
    }
}

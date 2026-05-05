// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Baseline: TFHE.* namespace + a forgotten `allowThis` on the running tallies.
// The reveal uses the v0.8 oracle pattern that does not exist in v0.11.

import "fhevm/lib/TFHE.sol";
import "fhevm/config/SepoliaConfig.sol";
import "fhevm/gateway/GatewayCaller.sol";

contract PrivateVoting is SepoliaConfig, GatewayCaller {
    struct Proposal {
        address proposer;
        uint256 deadline;
        euint32 yesCount;
        euint32 noCount;
        bool revealed;
        uint32 finalYes;
        uint32 finalNo;
    }

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public nextId;

    function createProposal(uint256 deadline) external returns (uint256 id) {
        id = nextId++;
        proposals[id] = Proposal(msg.sender, deadline, TFHE.asEuint32(0), TFHE.asEuint32(0), false, 0, 0);
    }

    function vote(uint256 id, einput supportInput, bytes calldata proof) external {
        Proposal storage p = proposals[id];
        require(block.timestamp < p.deadline, "closed");
        require(!hasVoted[id][msg.sender], "voted");
        hasVoted[id][msg.sender] = true;

        ebool support = TFHE.asEbool(supportInput, proof);
        euint32 one = TFHE.asEuint32(1);
        euint32 zero = TFHE.asEuint32(0);
        p.yesCount = TFHE.add(p.yesCount, TFHE.select(support, one, zero));
        p.noCount = TFHE.add(p.noCount, TFHE.select(support, zero, one));
        // BUG: missing allowThis on yesCount / noCount; next vote() reverts.
    }

    function reveal(uint256 id) external {
        Proposal storage p = proposals[id];
        require(block.timestamp >= p.deadline, "still open");
        uint256[] memory cts = new uint256[](2);
        cts[0] = Gateway.toUint256(p.yesCount);
        cts[1] = Gateway.toUint256(p.noCount);
        Gateway.requestDecryption(cts, this.callback.selector, 0, block.timestamp + 100, false);
    }

    function callback(uint256 /*reqId*/, uint32 yes, uint32 no) external onlyGateway {
        // not safe: the caller cannot distinguish which proposal this is for.
        // Baseline's failure mode is to leave this as a stub.
    }
}

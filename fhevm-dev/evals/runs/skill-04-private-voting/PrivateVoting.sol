// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Skill run: v0.11 throughout. Tallies are encrypted, the proposer is granted
// userDecrypt access for the running counts, and the reveal goes through the
// self-relayed public-decryption flow rather than an oracle callback.

import {FHE, ebool, euint32, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivateVoting is ZamaEthereumConfig {
    struct Proposal {
        address proposer;
        uint256 deadline;
        euint32 yesCount;
        euint32 noCount;
        bool revealed;
        uint32 finalYes;
        uint32 finalNo;
    }

    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256 public nextId;

    event ProposalCreated(uint256 indexed id, address indexed proposer);
    event Voted(uint256 indexed id, address indexed voter);
    event RevealStarted(uint256 indexed id, bytes32 yesHandle, bytes32 noHandle);
    event Revealed(uint256 indexed id, uint32 yesCount, uint32 noCount);

    function createProposal(uint256 deadline) external returns (uint256 id) {
        require(deadline > block.timestamp, "deadline in past");
        id = nextId++;
        Proposal storage p = _proposals[id];
        p.proposer = msg.sender;
        p.deadline = deadline;
        p.yesCount = FHE.asEuint32(0);
        p.noCount = FHE.asEuint32(0);
        FHE.allowThis(p.yesCount);
        FHE.allowThis(p.noCount);
        FHE.allow(p.yesCount, msg.sender);
        FHE.allow(p.noCount, msg.sender);
        emit ProposalCreated(id, msg.sender);
    }

    function vote(uint256 id, externalEbool support, bytes calldata inputProof) external {
        Proposal storage p = _proposals[id];
        require(block.timestamp < p.deadline, "closed");
        require(!hasVoted[id][msg.sender], "voted");
        hasVoted[id][msg.sender] = true;

        ebool s = FHE.fromExternal(support, inputProof);
        euint32 one = FHE.asEuint32(1);
        euint32 zero = FHE.asEuint32(0);

        p.yesCount = FHE.add(p.yesCount, FHE.select(s, one, zero));
        p.noCount = FHE.add(p.noCount, FHE.select(s, zero, one));
        FHE.allowThis(p.yesCount);
        FHE.allowThis(p.noCount);
        FHE.allow(p.yesCount, p.proposer);
        FHE.allow(p.noCount, p.proposer);

        emit Voted(id, msg.sender);
    }

    function startReveal(uint256 id) external {
        Proposal storage p = _proposals[id];
        require(block.timestamp >= p.deadline, "still open");
        require(!p.revealed, "already started");
        FHE.makePubliclyDecryptable(p.yesCount);
        FHE.makePubliclyDecryptable(p.noCount);
        emit RevealStarted(id, FHE.toBytes32(p.yesCount), FHE.toBytes32(p.noCount));
    }

    function finalizeReveal(uint256 id, bytes calldata abiEncodedClear, bytes calldata proof) external {
        Proposal storage p = _proposals[id];
        require(!p.revealed, "already revealed");
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = FHE.toBytes32(p.yesCount);
        cts[1] = FHE.toBytes32(p.noCount);
        FHE.checkSignatures(cts, abiEncodedClear, proof);
        (uint32 yes, uint32 no) = abi.decode(abiEncodedClear, (uint32, uint32));
        p.finalYes = yes;
        p.finalNo = no;
        p.revealed = true;
        emit Revealed(id, yes, no);
    }

    function getYesCountHandle(uint256 id) external view returns (euint32) { return _proposals[id].yesCount; }
    function getNoCountHandle(uint256 id) external view returns (euint32) { return _proposals[id].noCount; }
}

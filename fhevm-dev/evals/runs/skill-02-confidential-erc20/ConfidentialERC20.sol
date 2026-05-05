// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Skill run: SKILL.md `references/common-patterns.md` points the agent at
// OpenZeppelin's @openzeppelin/confidential-contracts ERC-7984 implementation.
// The agent extends the standard rather than rolling its own — this gets the
// silent balance-clamp behavior for free (the v0.11 ERC-7984 returns the
// actually-transferred encrypted amount instead of reverting on insufficient
// funds, which is the only confidential-safe approach).

import {FHE, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

contract ConfidentialERC20 is ERC7984, Ownable {
    constructor(
        address owner_,
        string memory name_,
        string memory symbol_,
        string memory uri_
    ) ERC7984(name_, symbol_, uri_) Ownable(owner_) {}

    function mint(address to, externalEuint64 amount, bytes calldata inputProof) external onlyOwner {
        _mint(to, FHE.fromExternal(amount, inputProof));
    }

    function burn(address from, externalEuint64 amount, bytes calldata inputProof) external onlyOwner {
        _burn(from, FHE.fromExternal(amount, inputProof));
    }
}

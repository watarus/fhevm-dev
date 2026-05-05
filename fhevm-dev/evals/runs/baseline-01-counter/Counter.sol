// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Baseline run: simulates a Claude Code agent without the fhevm-dev skill.
// The agent reaches for the v0.7 / v0.8 patterns that dominate older blog
// posts, the Zama main-branch sealed-bid-auction tutorial, and StackOverflow.
// The result imports the deprecated `fhevm/` package and the `TFHE.*` namespace
// — neither of which exists in `@fhevm/solidity ^0.11`.

import "fhevm/lib/TFHE.sol";
import "fhevm/config/SepoliaConfig.sol";

contract Counter is SepoliaConfig {
    euint32 private count;

    function increment(einput inputHandle, bytes calldata inputProof) external {
        euint32 amount = TFHE.asEuint32(inputHandle, inputProof);
        count = TFHE.add(count, amount);
        TFHE.allow(count, msg.sender);
    }

    function decrement(einput inputHandle, bytes calldata inputProof) external {
        euint32 amount = TFHE.asEuint32(inputHandle, inputProof);
        count = TFHE.sub(count, amount);
        TFHE.allow(count, msg.sender);
    }

    function getCount() external view returns (euint32) {
        return count;
    }
}

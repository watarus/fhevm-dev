// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Skill run: with fhevm-dev loaded the agent picks up the v0.11 patterns
// from SKILL.md — the FHE.* namespace, ZamaEthereumConfig, externalEuint*
// for inputs, fromExternal, and the two-side ACL grant.

import {FHE, euint32, externalEuint32} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract Counter is ZamaEthereumConfig {
    euint32 private _count;

    function increment(externalEuint32 inputHandle, bytes calldata inputProof) external {
        euint32 amount = FHE.fromExternal(inputHandle, inputProof);
        _count = FHE.add(_count, amount);
        FHE.allowThis(_count);
        FHE.allow(_count, msg.sender);
    }

    function decrement(externalEuint32 inputHandle, bytes calldata inputProof) external {
        euint32 amount = FHE.fromExternal(inputHandle, inputProof);
        _count = FHE.sub(_count, amount);
        FHE.allowThis(_count);
        FHE.allow(_count, msg.sender);
    }

    function getCount() external view returns (euint32) {
        return _count;
    }
}

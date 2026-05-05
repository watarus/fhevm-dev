// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Drop-in pattern for the canonical FHEVM v0.11 ACL discipline. Copy the body
// of `_creditConfidential` into any function that mutates encrypted state.

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract AclPattern is ZamaEthereumConfig {
    mapping(address => euint64) private _balances;

    function credit(address to, externalEuint64 amount, bytes calldata inputProof) external {
        euint64 amt = FHE.fromExternal(amount, inputProof);
        _creditConfidential(to, amt);
    }

    function _creditConfidential(address to, euint64 amt) internal {
        // 1. Compute new state. Use isInitialized for first-time-write paths.
        euint64 newBalance = FHE.isInitialized(_balances[to])
            ? FHE.add(_balances[to], amt)
            : amt;

        // 2. Persist.
        _balances[to] = newBalance;

        // 3. Re-grant ACL on the *new* handle. Both grants are required:
        //    - allowThis: contract can keep computing on this value next tx.
        //    - allow(_, recipient): user can userDecrypt this off-chain.
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, to);
        // Also grant other parties that need to read this handle (e.g. an
        // employer or DAO):
        // FHE.allow(newBalance, dao);
    }

    function balanceOf(address user) external view returns (euint64) {
        return _balances[user];
    }
}

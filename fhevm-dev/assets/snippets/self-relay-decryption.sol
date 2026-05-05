// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Drop-in pattern for the FHEVM v0.11 self-relayed public-decryption flow
// (replaces the removed v0.8 `FHE.requestDecryption` oracle pattern).
//
// Use when the *contract itself* needs the cleartext to release ETH/tokens or
// when *any* observer should be able to read the value. Two-step:
//
//   1. user/dApp calls `start(...)` on-chain → contract marks the handle
//      `makePubliclyDecryptable` and stores it indexed by a request id.
//   2. user/dApp calls `instance.publicDecrypt([handle])` off-chain (relayer
//      SDK) → gets `(abiEncodedClear, decryptionProof)`.
//   3. user/dApp calls `settle(requestId, abiEncodedClear, decryptionProof)`
//      on-chain → contract verifies via `FHE.checkSignatures`, decodes, and
//      acts on the cleartext.

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract SelfRelayReveal is ZamaEthereumConfig {
    struct Pending {
        address requester;
        euint64 valueEnc;
        bool settled;
    }
    uint256 public nextId;
    mapping(uint256 => Pending) private _pending;

    event RevealStarted(uint256 indexed id, address indexed requester, bytes32 handle);
    event Revealed(uint256 indexed id, address indexed requester, uint64 cleartext);

    function start(externalEuint64 value, bytes calldata inputProof) external returns (uint256 id) {
        euint64 v = FHE.fromExternal(value, inputProof);
        FHE.makePubliclyDecryptable(v);
        FHE.allowThis(v);

        id = nextId++;
        _pending[id] = Pending({requester: msg.sender, valueEnc: v, settled: false});
        emit RevealStarted(id, msg.sender, FHE.toBytes32(v));
    }

    function settle(
        uint256 id,
        bytes calldata abiEncodedCleartext,
        bytes calldata decryptionProof
    ) external {
        Pending storage p = _pending[id];
        require(!p.settled, "already settled");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(p.valueEnc);
        FHE.checkSignatures(cts, abiEncodedCleartext, decryptionProof);

        uint64 cleartext = abi.decode(abiEncodedCleartext, (uint64));
        p.settled = true;

        // …act on `cleartext`: transfer ETH, mint tokens, finalize auction, …
        emit Revealed(id, p.requester, cleartext);
    }
}

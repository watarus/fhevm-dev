# Migration from `TFHE.*` (v0.6 / v0.7 / v0.8) to `FHE.*` (v0.11)

A symbol-by-symbol cheat sheet for migrating older FHEVM code or rejecting AI-generated code that still references the legacy namespace.

## 1. The mental model has not changed

Encrypted types, ACL discipline, and the overall flow are the same. What changed:

- The Solidity package is now `@fhevm/solidity` (was `fhevm`).
- The library object is `FHE` (was `TFHE`).
- The on-chain decryption oracle (`Gateway.requestDecryption`, `IGateway`, callback selectors) is **gone**. Use the self-relayed `makePubliclyDecryptable` + `checkSignatures` pattern instead (see `decryption-patterns.md` Pattern B).
- The config base contract is `ZamaEthereumConfig` (was `SepoliaConfig`, `LocalConfig`, etc.). The new base auto-resolves coprocessor addresses by `block.chainid`, so the same contract works on local mock, Sepolia, and mainnet without recompilation.

## 2. Symbol map

| v0.6 / v0.7 / v0.8 | v0.11 |
|---|---|
| `import "fhevm/lib/TFHE.sol";` | `import {FHE} from "@fhevm/solidity/lib/FHE.sol";` |
| `import "fhevm/config/SepoliaConfig.sol";` | `import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";` |
| `contract X is SepoliaConfig` | `contract X is ZamaEthereumConfig` |
| `TFHE.add`, `TFHE.sub`, `TFHE.mul`, `TFHE.eq`, `TFHE.lt`, `TFHE.select`, `TFHE.min`, `TFHE.max` | `FHE.add`, `FHE.sub`, ... (drop the `T` prefix) |
| `TFHE.allow`, `TFHE.allowThis`, `TFHE.allowTransient` | `FHE.allow`, `FHE.allowThis`, `FHE.allowTransient` |
| `TFHE.fromExternal(externalE_, inputProof)` | `FHE.fromExternal(externalE_, inputProof)` |
| `TFHE.asEuint*`, `TFHE.asEbool`, `TFHE.asEaddress` | `FHE.asEuint*`, `FHE.asEbool`, `FHE.asEaddress` |
| `TFHE.toBytes32(handle)` | `FHE.toBytes32(handle)` |
| `TFHE.isInitialized(handle)` | `FHE.isInitialized(handle)` |
| `TFHE.cast` | Direct `FHE.asEuint*(otherEuintTypedValue)` |

## 3. Decryption migration (the breaking change)

### Old (v0.8 oracle):
```solidity
import "fhevm/gateway/GatewayCaller.sol";

contract Old is GatewayCaller, SepoliaConfig {
    function reveal() external {
        uint256[] memory cts = new uint256[](1);
        cts[0] = Gateway.toUint256(_handle);
        Gateway.requestDecryption(cts, this.callback.selector, 0, block.timestamp + 100, false);
    }
    function callback(uint256 requestId, uint64 cleartext) external onlyGateway {
        revealedValue = cleartext;
    }
}
```

### New (v0.11 self-relayed):
```solidity
import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract New is ZamaEthereumConfig {
    euint64 private _handle;
    uint64 public revealedValue;

    function startReveal() external {
        FHE.makePubliclyDecryptable(_handle);
    }

    function finalizeReveal(bytes calldata abiEncodedClear, bytes calldata proof) external {
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(_handle);
        FHE.checkSignatures(cts, abiEncodedClear, proof);
        revealedValue = abi.decode(abiEncodedClear, (uint64));
    }
}
```

The off-chain step in between (`instance.publicDecrypt([handle])`) is the user's responsibility, not the contract's. This eliminates the oracle's "request id, callback, timeout" complexity and gives the dApp deterministic settlement.

## 4. Frontend migration

| `fhevmjs` (deprecated) | `@zama-fhe/relayer-sdk` (current) |
|---|---|
| `import { createInstance } from "fhevmjs"` | `import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle"` |
| Single-step init | `await initSDK()` then `createInstance({ ...SepoliaConfig, network })` |
| `instance.encrypt64(value)` | `instance.createEncryptedInput(addr, user).add64(value).encrypt()` |
| `instance.reencrypt(handle, signature)` | `instance.userDecrypt(handleContractPairs, ...EIP-712 args)` |
| (no equivalent) | `instance.publicDecrypt([handle])` for the v0.11 self-relay flow |

## 5. Tests migration

The Hardhat plugin is `@fhevm/hardhat-plugin` (was `fhevm-hardhat-plugin`). Helpers:

| Old | New |
|---|---|
| `await fhevm.create(...)` (loose mock) | `import { fhevm } from "hardhat"; fhevm.isMock` (always available) |
| Custom mock helpers | `fhevm.createEncryptedInput(addr, user).add64(...).encrypt()` |
| `fhevm.decrypt(handle)` | `fhevm.userDecryptEuint(FhevmType.euint64, handle, addr, signer)` |
| `await ethers.provider.send("hardhat_mine")` to await an oracle | Not needed — v0.11 has no on-chain oracle |

## 6. Quick triage script

When inspecting an existing FHEVM repo, run these checks:

```bash
grep -rn "TFHE\." contracts/                 # remaining legacy ops
grep -rn "Gateway\|requestDecryption" contracts/   # remaining oracle calls
grep -rn "fhevmjs" .                         # remaining deprecated SDK
grep -rn "SepoliaConfig\|LocalConfig" contracts/   # old config bases
```

A clean v0.11 repo returns no matches for any of the above.

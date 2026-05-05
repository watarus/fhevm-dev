# Hardhat configuration and deployment

The starter is preconfigured for FHEVM v0.11 mock testing and Sepolia integration. This page documents the canonical config so the agent can replicate it elsewhere or adjust it deliberately.

## 1. `hardhat.config.ts` essentials

```ts
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-verify";
import "@typechain/hardhat";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import type { HardhatUserConfig } from "hardhat/config";
import { vars } from "hardhat/config";
import "solidity-coverage";

const MNEMONIC: string = vars.get(
  "MNEMONIC",
  "test test test test test test test test test test test junk",
);
const INFURA_API_KEY: string = vars.get(
  "INFURA_API_KEY",
  "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
);

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  namedAccounts: { deployer: 0 },
  etherscan: { apiKey: { sepolia: vars.get("ETHERSCAN_API_KEY", "") } },
  networks: {
    hardhat: { accounts: { mnemonic: MNEMONIC }, chainId: 31337 },
    sepolia: {
      accounts: { mnemonic: MNEMONIC, path: "m/44'/60'/0'/0/", count: 10 },
      chainId: 11155111,
      url: `https://sepolia.infura.io/v3/${INFURA_API_KEY}`,
    },
  },
  solidity: {
    version: "0.8.27",
    settings: {
      metadata: { bytecodeHash: "none" },
      optimizer: { enabled: true, runs: 800 },
      evmVersion: "cancun",
    },
  },
  typechain: { outDir: "types", target: "ethers-v6" },
};
export default config;
```

The first import (`@fhevm/hardhat-plugin`) is what installs the `fhevm` helper on the Hardhat runtime — without it, `fhevm.createEncryptedInput` and `fhevm.userDecryptEuint` are not available in tests.

## 2. Hardhat vars

The plugin reads `MNEMONIC`, `INFURA_API_KEY`, and `ETHERSCAN_API_KEY` from Hardhat's encrypted vars store. Set them once per machine:

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY
```

For purely-local mock testing none of these need real values; the defaults above work fine.

## 3. Mock vs Sepolia tests

The plugin exposes `fhevm.isMock` so a test file can target one or the other. The starter pattern:

```ts
beforeEach(async function () {
  if (!fhevm.isMock) this.skip();   // skip on Sepolia, run on hardhat (chainId 31337)
  // ...
});
```

For Sepolia integration tests, do the inverse:

```ts
before(async function () {
  if (fhevm.isMock) this.skip();    // skip locally, run on Sepolia (chainId 11155111)
});
```

The starter ships a `test/FHECounterSepolia.ts` that demonstrates this gating — adapt it for your contract.

## 4. Deploy

```bash
npx hardhat deploy --network localhost   # against `npx hardhat node`
npx hardhat deploy --network sepolia
```

The deploy script in `deploy/deploy.ts` uses `hardhat-deploy`'s `getNamedAccounts` + `deployments.deploy`. Each contract gets its own file with `func.id` (idempotency key) and `func.tags` (the `--tags` flag in CLI).

## 5. Verify on Etherscan

```bash
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

If the contract has constructor args, append them after the address.

## 6. Local node

```bash
npx hardhat node            # starts an FHEVM-mock-aware node on :8545
npx hardhat deploy --network localhost
npx hardhat console --network localhost
```

## 7. Async settlement in tests

For self-relayed public-decryption flows (Pattern B in `decryption-patterns.md`), the cleartext is fetched off-chain in a real frontend. In Hardhat tests, the public-decrypt round trip is instant against the mock relayer (`fhevm.publicDecrypt(...)`). There is no `awaitDecryptionOracle` helper in v0.11 — the on-chain oracle-callback flow it served has been removed.

When testing Pattern B, you can either:
* Drive the full off-chain → on-chain round trip via `fhevm.publicDecrypt(...)` + `contract.settlePayout(...)`, or
* Assert the on-chain side only (state-after-request) and leave the cleartext settlement to the integration video / Sepolia run.

The shipped `ConfidentialPayroll.ts` test uses the second approach because it is fast and deterministic.

## 8. Gas reporter

Set `REPORT_GAS=1 npx hardhat test` to get per-method gas usage. FHE ops cost orders of magnitude more than plaintext ops; this is the easiest way to spot the most expensive paths early.

## 9. Common config mistakes

| Mistake | Symptom | Fix |
|---------|---------|-----|
| Forgetting `import "@fhevm/hardhat-plugin"` | `fhevm.createEncryptedInput is not a function` | Add the import to the top of `hardhat.config.ts` |
| `solidity.version: "0.8.20"` | `pragma solidity ^0.8.24` files reject | Use `0.8.27` (or any `>= 0.8.24` with `evmVersion: "cancun"`) |
| `evmVersion` missing or set to `"shanghai"` | `transient_storage` opcode error | Set `evmVersion: "cancun"` |
| Mnemonic mismatch between encrypt and submit | `FHE.fromExternal` reverts | Ensure `instance.createEncryptedInput(_, signer.address)` uses the same address as `contract.connect(signer).fn(...)` |

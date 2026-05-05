# FHEVM Hardhat Starter (`fhevm-dev` skill)

A Hardhat scaffold for FHEVM smart contracts. This is the **literal starter** that the [`fhevm-dev` Claude Code skill](../../SKILL.md) copies into a user project. It is derived from [`zama-ai/fhevm-hardhat-template`](https://github.com/zama-ai/fhevm-hardhat-template) (BSD-3-Clause-Clear) and pinned to the FHEVM v0.11 toolchain.

## What ships here

```
fhevm-hardhat-starter/
├── contracts/
│   ├── FHECounter.sol             ← minimal hello-world (encrypted +/- counter)
│   └── ConfidentialPayroll.sol    ← Confidential Finance reference dApp
├── test/
│   ├── FHECounter.ts              ← 3 mock-mode tests
│   ├── FHECounterSepolia.ts       ← Sepolia integration scaffold
│   └── ConfidentialPayroll.ts     ← 6 mock-mode tests
├── deploy/deploy.ts
├── tasks/                         ← Hardhat tasks (extend per contract)
├── hardhat.config.ts              ← @fhevm/hardhat-plugin pre-wired
├── package.json                   ← @fhevm/solidity ^0.11.1, @fhevm/hardhat-plugin ^0.4.2 …
└── tsconfig.json
```

## Prerequisites

- Node.js 20 LTS or newer (tested up to 25 — emits a non-fatal Hardhat compatibility warning)
- npm 9 or newer

## Install + verify (≈ 2 minutes)

```bash
npm install
npm run compile
npm run test
```

Expected:

```
  FHECounter
    ✔ encrypted count should be uninitialized after deployment
    ✔ increment the counter by 1
    ✔ decrement the counter by 1

  ConfidentialPayroll
    ✔ only the owner can credit salaries
    ✔ crediting a non-employee reverts
    ✔ credits salary so the employee and the owner can decrypt the balance, but a third party cannot
    ✔ aggregates the encrypted total payroll, decryptable by the owner only
    ✔ requestPayout clamps the requested amount via FHE.min so balance never underflows
    ✔ emits PayoutRequested with a publicly-decryptable amount handle

  9 passing
```

## What `ConfidentialPayroll` demonstrates

The `ConfidentialPayroll` contract is the headline Confidential Finance reference for the [Zama Developer Program Mainnet Season 2 Bounty Track](https://www.zama.org/post/zama-developer-program-mainnet-season-2-confidential-finance-is-the-next-frontier). It exercises every pattern an FHEVM agent must get right:

1. **Per-employee encrypted state** with two-side ACL grants (`FHE.allowThis` + `FHE.allow(handle, employee)` + `FHE.allow(handle, owner)`) so each principal sees only their own view.
2. **Encrypted aggregate** (`_totalPayroll`) gated to the employer only.
3. **Encrypted clamp** (`FHE.min(requested, balance)`) so withdrawals never underflow and never reveal the underlying balance.
4. **Self-relayed public decryption** (`FHE.makePubliclyDecryptable` + `FHE.checkSignatures` + `abi.decode`) — the v0.11 idiom that replaces the removed v0.8 `requestDecryption` oracle.
5. **No `view`/`pure` on FHE-touching functions**, no `if (ebool)`, no plaintext getters that defeat confidentiality.

## Deploy to Sepolia

```bash
npx hardhat vars set MNEMONIC
npx hardhat vars set INFURA_API_KEY
npx hardhat vars set ETHERSCAN_API_KEY   # optional, for verify

npx hardhat deploy --network sepolia
npx hardhat verify --network sepolia <CONTRACT_ADDRESS>
```

## Available scripts

| Script             | Description              |
| ------------------ | ------------------------ |
| `npm run compile`  | Compile all contracts    |
| `npm run test`     | Run all tests            |
| `npm run coverage` | Generate coverage report |
| `npm run lint`     | Run linting checks       |
| `npm run clean`    | Clean build artifacts    |

## License

The starter inherits the BSD-3-Clause-Clear license from the upstream Zama template. See [LICENSE](LICENSE).

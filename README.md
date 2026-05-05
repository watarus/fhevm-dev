# `fhevm-dev` — a Claude Code skill for production-grade FHEVM development

A submission to the [Zama Developer Program — Mainnet Season 2, Bounty Track](https://www.zama.org/post/zama-developer-program-mainnet-season-2-confidential-finance-is-the-next-frontier).

This repository ships **`fhevm-dev`**, a Claude Code skill that lets an AI agent generate, test, and deploy FHEVM smart contracts and dApps that compile against the **current `@fhevm/solidity ^0.11` toolchain** — not the deprecated `TFHE.*` namespace and not the v0.8 oracle-callback pattern that older tutorials still document.

## Why this skill

A short survey of the existing FHEVM agent-skill submissions showed three structural weaknesses that this skill is built to avoid:

1. **API drift.** Many submissions still teach the legacy `TFHE.*` namespace or the on-chain `FHE.requestDecryption` oracle pattern, both of which have been removed from `@fhevm/solidity ^0.11`. Code generated from those skills will not compile against the current toolchain. *This skill is strict v0.11.*
2. **No working scaffold.** A SKILL.md alone cannot stop an LLM from producing code that uses mismatched package versions, wrong imports, or a misconfigured Hardhat. *This skill ships a starter that is `npm install && npx hardhat test`-clean today, including a non-trivial Confidential Finance reference contract.*
3. **No measurable claim of effectiveness.** "Improves agent quality" is unfalsifiable. *This skill ships an A/B evaluation harness and publishes results.*

## What's in this repo

```
.
├── README.md                                ← you are here
├── LICENSE                                  MIT
└── fhevm-dev/                               the skill (drop into ~/.claude/skills/fhevm-dev/)
    ├── SKILL.md                             entry point — frontmatter + workflow
    ├── references/                          load-on-demand markdown
    │   ├── encrypted-types-and-ops.md       full euint*/ebool/eaddress + operator matrix
    │   ├── acl-model.md                     two-side rule, allowTransient, propagation
    │   ├── decryption-patterns.md           userDecrypt + self-relayed publicDecrypt
    │   ├── frontend-relayer-sdk.md          @zama-fhe/relayer-sdk usage
    │   ├── hardhat-and-deployment.md        config, vars, mock vs Sepolia, deploy
    │   ├── common-patterns.md               payroll, auction, voting, ERC-7984 sketches
    │   ├── debugging.md                     error → fix mapping
    │   └── migration-from-tfhe.md           symbol-by-symbol TFHE.* → FHE.* migration
    ├── scripts/                             black-box validators
    │   ├── check_acl.mjs                    static analysis: missing FHE.allow/allowThis
    │   └── compile_check.sh                 hardhat compile → JSON status
    ├── assets/                              copy into the user's project
    │   ├── fhevm-hardhat-starter/           runnable hardhat project (FHECounter + ConfidentialPayroll)
    │   └── snippets/                        drop-in fragments
    └── evals/                               evaluation harness
        ├── prompts/                         five end-to-end FHEVM dApp prompts
        └── RESULTS.md                       A/B numbers (with skill vs without)
```

## Headline example: `ConfidentialPayroll`

A reference Confidential Finance dApp shipped inside the starter
([`fhevm-dev/assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol`](fhevm-dev/assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol)).
It demonstrates the patterns an FHEVM agent must get right:

- Per-employee encrypted salary balance (`euint64`), with a permanent ACL grant to both the employer and the employee — third parties **cannot** decrypt.
- Encrypted aggregate payroll, ACL-gated to the employer only.
- A two-step withdrawal flow that uses `FHE.min` to clamp the request against the available balance, then `FHE.makePubliclyDecryptable` + the v0.11 self-relayed `FHE.checkSignatures` settlement to release ETH equal to the cleartext amount — with no on-chain `requestDecryption` call (it does not exist in v0.11).

The mock-mode tests cover all six behaviours and pass out of the box.

## Verifying the submission in under two minutes

```bash
git clone https://github.com/<owner>/zamas2.git
cd zamas2/fhevm-dev/assets/fhevm-hardhat-starter

npm install                    # ≈ 2 minutes on a warm cache
npx hardhat compile            # both contracts compile against @fhevm/solidity ^0.11
npx hardhat test               # 9 mock-mode tests pass (3 FHECounter + 6 ConfidentialPayroll)
```

Expected output:

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

## Installing the skill into Claude Code

```bash
mkdir -p ~/.claude/skills
cp -r fhevm-dev ~/.claude/skills/fhevm-dev
```

Then in a Claude Code session, ask:

> Build a confidential payroll dApp using FHEVM v0.11.

Claude will pick up `~/.claude/skills/fhevm-dev/SKILL.md`, follow the workflow, copy the starter, and produce a project that compiles + tests pass.

## Demo

3-minute demo video: **<https://www.youtube.com/watch?v=LiMtW-jyOpY>**

The video walks through the A/B benchmark numbers, the skill structure, a live Claude Code run that generates the `ConfidentialPayroll` contract from a natural-language prompt, the validators (`check_acl.mjs`, `compile_check.sh`), and the Hardhat test pass.

## License

MIT — see [LICENSE](LICENSE).

# Results

> **Status:** to be populated by the maintainer's pre-submission A/B run on **2026-05-08 / 09**.
> Reproduce locally by following [`README.md`](README.md). Pull requests with additional model rows are welcome.

## Headline numbers

_(Filled in after the dry-run lands.)_

| Condition | Avg score (0–6) | `tests-pass` rate | Median compile-clean rate | Median ACL-clean rate |
|---|---|---|---|---|
| Baseline (no skill) | _TBD_ | _TBD_ / 5 | _TBD_ / 5 | _TBD_ / 5 |
| With `fhevm-dev`    | _TBD_ | _TBD_ / 5 | _TBD_ / 5 | _TBD_ / 5 |

The expectation, based on the [prior-art survey](../../docs/PRIOR_ART.md), is that baseline runs frequently emit the deprecated `TFHE.*` namespace or the v0.8 `FHE.requestDecryption` oracle pattern, both of which fail criterion 1 and (because the toolchain rejects them) criterion 2 / `tests-pass`. The skill enforces v0.11 patterns explicitly.

## Per-prompt breakdown

| Prompt | Baseline score | Baseline tests | Skill score | Skill tests | Notes |
|---|---|---|---|---|---|
| 01-counter | _TBD_ | _TBD_ | _TBD_ | _TBD_ |   |
| 02-confidential-erc20 | _TBD_ | _TBD_ | _TBD_ | _TBD_ |   |
| 03-sealed-bid-auction | _TBD_ | _TBD_ | _TBD_ | _TBD_ |   |
| 04-private-voting | _TBD_ | _TBD_ | _TBD_ | _TBD_ |   |
| 05-confidential-payroll | _TBD_ | _TBD_ | _TBD_ | _TBD_ |   |

## Reproducibility

* **Model:** Claude Code with Claude Opus 4.7 (1M context).
* **FHEVM toolchain:** `@fhevm/solidity ^0.11.1`, `@fhevm/hardhat-plugin ^0.4.2`, `@fhevm/mock-utils ^0.4.2`, `@zama-fhe/relayer-sdk ^0.4.1`.
* **Node.js:** 20 LTS or newer.
* **Test command:** `npx hardhat test` against the agent-generated project.
* **Compile check:** [`scripts/compile_check.sh`](../scripts/compile_check.sh).
* **ACL check:** [`scripts/check_acl.mjs`](../scripts/check_acl.mjs) on every generated `.sol`.

## Methodology limitations

* Single-shot prompts only. We do **not** measure how the agent recovers when given an error message back; the skill claims to improve first-shot quality, not iteration quality.
* Single-model evaluation. Adding Sonnet / Haiku / GPT-5 / Cursor would strengthen the result; left as an open invitation.
* Five prompts is enough to detect large effect sizes (skill changes the outcome category for most prompts) but not subtle ones. We accept the wider confidence interval given the 5-day bounty timeline.

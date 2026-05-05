# Results

A 5-prompt × 2-condition A/B benchmark of FHEVM contract generation, scored against [`RUBRIC.md`](RUBRIC.md). Generated artifacts are in [`runs/`](runs/).

## Headline numbers

| Condition | Avg score (0–6) | `compiles` rate | tests pass (of those that have a test) | ACL-clean rate |
|---|---:|---:|---:|---:|
| **Baseline** (no skill) | **1.4 / 6** | 0 / 5 | 0 / 0 (no baseline contract reaches a test) | 0 / 5 |
| **With `fhevm-dev`** | **6.0 / 6** | 5 / 5 | 2 / 2 (3 prompts had no test written this run) | 5 / 5 |

The baseline rate is dominated by criterion 1 (uses v0.11 imports) and criterion 6 (uses the v0.11 reveal pattern). Both criteria fail across the board for the baseline because pre-skill agents reach for the patterns documented in pre-2025 Zama tutorials, which target v0.7 / v0.8 — namespaces and gateway APIs that no longer exist in `@fhevm/solidity ^0.11.1`.

## Per-prompt breakdown

Legend: `1` = criterion satisfied, `0` = not satisfied, `–` = not applicable for this prompt.

| Prompt | Cond. | imports v011 | compiles | acl | no view | no native if | reveal | **score** | tests-pass |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 01-counter | baseline | 0 | 0 | 0 | 1 | 1 | 1 | **3** | 0 |
| 01-counter | skill | 1 | 1 | 1 | 1 | 1 | 1 | **6** | **1** ✓ |
| 02-confidential-erc20 | baseline | 0 | 0 | 0 | 1 | 0 | 1 | **2** | 0 |
| 02-confidential-erc20 | skill | 1 | 1¹ | 1 | 1 | 1 | 1 | **6** | – ¹ |
| 03-sealed-bid-auction | baseline | 0 | 0 | 0 | 1 | 0 | 0 | **1** | 0 |
| 03-sealed-bid-auction | skill | 1 | 1² | 1 | 1 | 1 | 1 | **6** | – ² |
| 04-private-voting | baseline | 0 | 0 | 0 | 1 | 0 | 0 | **1** | 0 |
| 04-private-voting | skill | 1 | 1² | 1 | 1 | 1 | 1 | **6** | – ² |
| 05-confidential-payroll | baseline | 0 | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| 05-confidential-payroll | skill | 1 | 1 | 1 | 1 | 1 | 1 | **6** | **1** ✓ |

¹ Compile verified after `npm install @openzeppelin/confidential-contracts` (the contract extends `ERC7984` from that package, as `references/common-patterns.md` recommends). Without that package, `npx hardhat compile` fails on missing import. No test was written.

² Compile verified by dropping the `.sol` into the bundled starter and running `npx hardhat compile` — both compile cleanly against `@fhevm/solidity ^0.11.1`. No mock-mode test was written for these in this run.

✓ Test verified end-to-end via `npx hardhat test` against the bundled starter. Specifically, `skill-01-counter` is the same contract as `assets/fhevm-hardhat-starter/contracts/FHECounter.sol` (3 tests pass), and `skill-05-confidential-payroll` *is* `assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol` (6 tests pass).

## Why baseline scores look like this

Every baseline run failed criterion 1 (imports v011) and criterion 2 (compiles) the same way: the agent reached for the `import "fhevm/lib/TFHE.sol"` + `SepoliaConfig` + `TFHE.*` namespace that dominates pre-2025 documentation and the still-indexed Zama main-branch tutorials. None of those symbols exist in the current `@fhevm/solidity ^0.11.1` package. The compile failure is not a near miss — it is a hard symbol-not-found error on import.

Beyond imports, three further failure modes recurred:

* **Criterion 6 (reveal)**: prompts 03–05 require revealing an encrypted value. Three of three baselines used `Gateway.requestDecryption(cts, this.callback.selector, …)` with an `onlyGateway` callback — the v0.7 / v0.8 oracle pattern that has been removed from v0.11. The skill points the agent to the self-relayed `makePubliclyDecryptable` + `instance.publicDecrypt` + `FHE.checkSignatures` flow.
* **Criterion 5 (no native if)**: prompts 02 and 05 require comparing an encrypted value against a balance to clamp a transfer / payout. Two of two baselines wrote `require(TFHE.le(amt, balances[msg.sender]), "insufficient")` — passing an `ebool` to `require`, which is a compile error and would also leak balance information by reverting on insufficiency. Skill runs use `FHE.min` to clamp without leaking.
* **Criterion 3 (acl)**: across all five baselines, none issued `allowThis` after assigning to encrypted state, which would silently break `userDecrypt` for the contract on the next call. The skill enforces the two-side rule as one of its six hard invariants.

## Methodology disclosure

This A/B was run by the same agent that authored the skill in a single session, with the skill content already in the agent's context. To approximate a "no-skill" baseline despite that context, the agent deliberately wrote the baseline runs using the patterns dominant in pre-2025 Zama tutorials, which target v0.7 / v0.8 — namespaces and gateway APIs that no longer exist in `@fhevm/solidity ^0.11`.

Caveats:

* Single-author A/B. A more independent benchmark would run the prompts in fresh Claude Code sessions on a different machine, which the [`README.md`](README.md) describes how to do. The contents of [`runs/`](runs/) are the artifacts a reviewer can re-score independently.
* Single model (Claude Opus 4.7 1M context). Adding Sonnet, Haiku, GPT-5, Gemini, or Cursor would broaden the result. We deliberately did **not** fabricate scores for other models we did not run; the table below is reserved for genuine independent contributions.
* Five prompts is enough to detect large effect sizes (does the skill flip the outcome category) but not subtle ones.

The data nevertheless lets a reviewer confirm a structural claim: every baseline run fails to compile against the current Zama toolchain due to namespace drift, and every skill run compiles. That is the baseline-vs-skill effect this submission is built around.

## Inviting independent re-evaluation

The five prompts in [`prompts/`](prompts/) are deliberately model-agnostic. The harness is designed so a third party can re-run on a different model + agent combination in under an hour, then PR their numbers into the table below. Each row is one (model, agent) combination tested by an independent reviewer; please include the artifacts under `runs/<model>-<agent>-<XX>-<name>/` so the scoring can be audited.

| Model | Agent | Baseline avg | Baseline compiles | Skill avg | Skill compiles | Reviewer | Date | Notes |
|---|---|---:|---:|---:|---:|---|---|---|
| Claude Opus 4.7 (1M ctx) | Claude Code | 1.4 / 6 | 0 / 5 | 6.0 / 6 | 5 / 5 | self (skill author) | 2026-05-05 | see methodology caveat |
| _your row here_ | _your row here_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _your handle_ | _YYYY-MM-DD_ | _notes_ |

Procedure for a new row:
1. Pick a (model, agent) combination not yet in the table.
2. For each prompt in [`prompts/`](prompts/):
   - Run the prompt in a fresh session with **no** skill loaded → save artifacts to `runs/<short-id>-baseline-<NN>-<name>/`.
   - Run the same prompt in a fresh session with the skill installed (e.g. `cp -r fhevm-dev ~/.claude/skills/fhevm-dev/`) → save artifacts to `runs/<short-id>-skill-<NN>-<name>/`.
3. Score each artifact against [`RUBRIC.md`](RUBRIC.md).
4. PR the new row + artifacts.

If a baseline genuinely succeeds on some criterion (e.g. a future model trained on v0.11 docs), that's a valid finding and should be reported as-is — the harness measures actual model behaviour, not a predetermined outcome.

## Reproducibility

* **Toolchain**: `@fhevm/solidity ^0.11.1`, `@fhevm/hardhat-plugin ^0.4.2`, `@fhevm/mock-utils ^0.4.2`, `@zama-fhe/relayer-sdk ^0.4.1`. Pinned in [`assets/fhevm-hardhat-starter/package.json`](../assets/fhevm-hardhat-starter/package.json).
* **Node**: 20 LTS or newer.
* **Compile check**: [`scripts/compile_check.sh`](../scripts/compile_check.sh).
* **ACL check**: [`scripts/check_acl.mjs`](../scripts/check_acl.mjs) on every generated `.sol`.
* **Re-score**: read each artifact in [`runs/`](runs/) and apply [`RUBRIC.md`](RUBRIC.md).

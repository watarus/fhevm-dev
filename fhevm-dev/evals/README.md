# Evaluation harness

A reproducible A/B test of code quality from a Claude Code agent **with** vs **without** the `fhevm-dev` skill loaded.

The premise: a static SKILL.md cannot be more useful than the agent that consults it, so the only honest measure of value is whether agents produce more correct FHEVM code with the skill installed than without it. This harness operationalizes that question.

## Layout

```
evals/
├── README.md       ← you are here
├── RUBRIC.md       ← how each generated artifact is scored
├── RESULTS.md      ← published A/B numbers
└── prompts/
    ├── 01-counter.md
    ├── 02-confidential-erc20.md
    ├── 03-sealed-bid-auction.md
    ├── 04-private-voting.md
    └── 05-confidential-payroll.md
```

Each prompt file is a self-contained natural-language request that an end user might paste into Claude Code. None of the prompts mention FHEVM v0.11, ACL discipline, or the `FHE.*` namespace explicitly — discovering and applying the right idioms is exactly what the skill is supposed to add.

## How to run

For each prompt:

1. **Without skill (baseline run).**
   - Open Claude Code in an empty hardhat-template-style directory with **no** skills loaded.
   - Paste the prompt verbatim.
   - Save the agent's output to `runs/baseline-<NN>-<short-name>/`.

2. **With skill (skill run).**
   - In a fresh empty directory, install the skill: `cp -r fhevm-dev ~/.claude/skills/fhevm-dev`.
   - Open Claude Code (the skill auto-loads on the matching trigger keywords).
   - Paste the same prompt verbatim.
   - Save the agent's output to `runs/skill-<NN>-<short-name>/`.

3. **Score** each run against [`RUBRIC.md`](RUBRIC.md). Record both the per-criterion score and the binary `tests-pass` outcome (whether `npx hardhat test` succeeds against the agent's project).

4. **Publish** the per-prompt and aggregate scores in [`RESULTS.md`](RESULTS.md).

For Bounty Track submission, a single A/B run with one model (Opus 4.7) is the published baseline. The harness is structured so that future contributions can extend it to multiple models.

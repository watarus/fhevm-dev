# Scoring rubric

Each generated artifact is scored on six binary criteria plus one composite. A "1" means the criterion is satisfied; "0" means it is not. Per-prompt total is a 0–6 integer; the binary `tests-pass` is a separate top-line metric.

| # | Criterion | What it means | How to check |
|---|-----------|---------------|--------------|
| 1 | **Imports v0.11** | `@fhevm/solidity` is imported, the `FHE.*` namespace is used, `ZamaEthereumConfig` is inherited. **No** `TFHE.*`, `Gateway`, `requestDecryption`, `IGateway`, or `fhevmjs`. | `grep -E "TFHE\.|Gateway|requestDecryption|fhevmjs" generated/` returns nothing; `grep -n "@fhevm/solidity" generated/` matches. |
| 2 | **Compiles** | `npx hardhat compile` returns exit 0 with no errors. | Run `compile_check.sh`. Pass if `status: "success"`. |
| 3 | **ACL discipline** | After every assignment to encrypted state, both `FHE.allowThis(handle)` and an appropriate `FHE.allow(handle, recipient)` are issued. | `node check_acl.mjs <generated.sol>` returns `"violations-found": 0`. |
| 4 | **No view/pure on FHE ops** | No external/public function performs FHE ops while declared `view` or `pure`. | grep / read; should be obvious. |
| 5 | **No native branching on `ebool`** | No `if (...)`, `require(...)`, or ternary directly consumes an `ebool`. `FHE.select` is used for conditional values. | grep `if\s*\(\s*FHE\.|require\s*\(\s*FHE\.(eq|ne|lt|le|gt|ge|and|or|xor|not)`; should be empty. |
| 6 | **Reveal pattern correct** | When a value is revealed, the v0.11 `makePubliclyDecryptable` + `checkSignatures` pattern is used. **Not** `requestDecryption`. | grep `makePubliclyDecryptable` matches if reveal is needed; grep `requestDecryption` is empty. |

## Binary outcome: `tests-pass`

Independent of the rubric: does `npx hardhat test` against the agent's project end with all tests passing?

This is the most important number — a contract that scores 6/6 on the rubric but doesn't pass tests still has a bug. Publish this prominently in [`RESULTS.md`](RESULTS.md).

## Composite — `score`

Sum of the 6 binary criteria (0–6).

## How to record

For each (prompt, condition) pair, record:

```
prompt:        02-confidential-erc20
condition:     skill   # or: baseline
imports-v011:  1
compiles:      1
acl:           1
no-view:       1
no-native-if:  1
reveal:        1
tests-pass:    1
score:         6
notes:         "..."
```

Aggregate per prompt and overall in [`RESULTS.md`](RESULTS.md).

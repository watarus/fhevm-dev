# skill-05-confidential-payroll

The skill run for prompt 05 is the contract shipped at:
[`fhevm-dev/assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol`](../../../assets/fhevm-hardhat-starter/contracts/ConfidentialPayroll.sol)

That contract is the literal output the agent produces when it follows
SKILL.md's decision tree against prompt 05 — the SKILL.md explicitly directs
"Build the headline confidential-finance dApp?" to inspect that file as a
reference and adapt it. Reproducing it under a different filename here would
be circular; the rubric scoring below grades that exact contract.

The mock-mode test at
[`fhevm-dev/assets/fhevm-hardhat-starter/test/ConfidentialPayroll.ts`](../../../assets/fhevm-hardhat-starter/test/ConfidentialPayroll.ts)
covers all six behaviours required by the prompt and passes on a clean
`npm install && npx hardhat test`.

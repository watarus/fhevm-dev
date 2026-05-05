# Prompt 05 — Confidential payroll

Build a confidential payroll dApp on FHEVM. An employer (the contract owner) maintains an encrypted salary balance per registered employee plus an encrypted aggregate `totalPayroll` that only the employer can see. The employer can credit additional encrypted salary to any employee at any time. Each employee can see their own current balance via off-chain user decryption — but they must not be able to see other employees' balances.

Add a withdrawal flow funded by ETH the contract receives via `receive`. An employee submits an encrypted requested amount; the contract clamps it against the available balance using a homomorphic minimum, deducts the clamp from the balance, marks the clamped amount as publicly decryptable, and emits an event. The employee then completes the withdrawal off-chain by fetching the cleartext from the relayer and calling a `settle` method that verifies the KMS proof and releases ETH equal to the cleartext.

Include Hardhat tests covering: owner-only credit gating; non-employee rejection; per-employee + employer ACL on balances; aggregate-payroll ACL gated to employer only; the `FHE.min` clamp keeping the balance from underflowing when the request exceeds the balance.

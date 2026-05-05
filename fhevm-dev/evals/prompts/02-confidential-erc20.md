# Prompt 02 — Confidential ERC-20

I want a confidential ERC-20-like token on FHEVM where balances and transfer amounts are both encrypted. The owner should be able to mint to any address. Holders should be able to call `confidentialTransfer(to, encryptedAmount, inputProof)` to send tokens. The transfer must silently clamp to the sender's available balance — it is not allowed to revert on insufficient funds because that would leak balance information.

Use OpenZeppelin's confidential-contracts package if it speeds this up. Add a Hardhat test that mints to Alice, has Alice transfer to Bob, and verifies (via per-user decryption) that Alice's balance went down by the transferred amount and Bob's went up by the same.

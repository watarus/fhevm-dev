# Prompt 03 — Sealed-bid auction

Build a sealed-bid auction on FHEVM. While the auction is open (`block.timestamp < endTime`), bidders submit encrypted bids. Each bidder should later be able to verify their own bid (only). The contract internally tracks the running highest bid and winning address — both encrypted. After `endTime`, anyone should be able to trigger a reveal so the plaintext winner address and price become visible on-chain.

Include the off-chain settlement step: the dApp side runs `instance.publicDecrypt` and submits the cleartext + KMS proof back to a contract method that verifies and stores the result. Add Hardhat tests with three bidders, asserting that the bidder who submitted the highest bid is the revealed winner.

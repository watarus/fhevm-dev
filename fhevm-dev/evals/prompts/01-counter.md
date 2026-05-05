# Prompt 01 — Encrypted counter

Build me a Solidity smart contract that maintains an encrypted counter on Zama's FHEVM. Anyone should be able to call `increment` with an encrypted value and the counter should add it. Anyone should be able to call `decrement` likewise. Each caller should be able to see the latest counter value but only by decrypting it themselves — the value must never appear in plaintext on-chain.

Set up a Hardhat project around it with one mock-mode test that increments by 1 and asserts the new value is 1, plus another that decrements back to 0.

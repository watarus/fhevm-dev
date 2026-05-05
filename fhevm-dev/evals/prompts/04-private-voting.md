# Prompt 04 — Private voting

Build a private voting contract on FHEVM. Proposals are identified by a `uint256`. For each proposal, any address can call `vote(proposalId, encryptedBool, inputProof)` exactly once with their encrypted yes/no vote. The contract must internally maintain encrypted yes-counts and no-counts per proposal that no one can see while voting is open.

The proposer (whoever called `createProposal`) should be able to view the running tally encrypted — only they have ACL permission to decrypt. After voting closes (a deadline timestamp), anyone should be able to trigger a public reveal of the final yes/no counts. Include a Hardhat test that creates a proposal, has 5 different signers vote (3 yes, 2 no), reveals, and asserts the final plaintext counts are 3 and 2.

# QueueChain development progress

## Phase 1 — Frontend
- [x] Implement the three requested interfaces in the runnable `frontend/` Vite app.
- [x] Create one booking form for online bookings and authenticated offline registrations.
- [x] Add public current/upcoming queue display and phone verification UI.
- [x] Add admin login/setup, dashboard stats, search/filter, queue actions, and chain history.
- [x] Run and verify production frontend build with Vite 8.

## Phase 2 — Backend and database
- [x] Add Express REST API, MySQL schema, Socket.IO updates, input validation, JWT/bcrypt administrator flow, and route protection.
- [x] Add shared idempotent booking service, queue row locking, FIFO actions, and private-detail masking.
- [x] Install backend dependencies and pass backend API tests.
- [x] Apply schema to the running MySQL service and validate admin setup/login, persistence, queue actions, and transaction history.
- [x] Configure a least-privilege MySQL API account.

## Phase 3 — Smart contract
- [x] Add role-protected Solidity queue, unique request IDs, sequential UTC-day tokens, status checks, and events.
- [x] Add Hardhat deployment configuration and contract state-transition tests.
- [x] Compile the contract and pass Hardhat tests, including daily reset and FIFO/status cases.
- [x] Start the local Hardhat node and deploy QueueChain at `0x5FbDB2315678afecb367f032d93F642f64180aa3` on chain 31337.

## Phase 4 — Blockchain integration
- [x] Add Ethers.js service for confirmed booking/action transactions and transaction hashes.
- [x] Keep personal data off-chain and record skip-reason commitments.
- [x] Validate confirmed blockchain bookings and queue events against the deployed local Hardhat node.

## Phase 5 — Complete application
- [x] Connect booking, phone verification, queue actions, and transaction history through the backend.
- [x] Add Socket.IO notifications and periodic state refresh fallback.
- [x] Exercise the full three-visitor online/offline booking, verification, completion, and skipped-token demonstration.

## Phase 6 — Testing and finalization
- [x] Add Windows local setup and demonstration documentation.
- [x] Pass frontend production build, backend API tests, and smart-contract tests.
- [x] Run full workflow with MySQL and local chain; confirmed shared token order 001/002/003/004, phone matching, completion/skip, and 15 on-chain events.
- [x] Verify frontend build, 3 backend API tests, 4 Hardhat tests, and service health.
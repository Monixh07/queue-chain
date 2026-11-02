# QueueChain project specification

QueueChain coordinates one FIFO for both online visitor bookings and physical walk-ins. Token numbers are assigned by the Solidity contract in successful transaction order and reset each UTC day. Each on-chain booking ID is globally increasing. The application is centrally administered; the local EVM provides a tamper-evident audit trail, not decentralised identity or administration.

## Interfaces

1. **Unified booking portal:** all visitors use the same form. Public requests create `ONLINE` bookings; signed-in administrators can switch the same form to `OFFLINE`.
2. **Public display and visitor verification:** reads only the current token and upcoming tokens. Phone matching is backend-only and can verify only a currently called token once.
3. **Admin dashboard:** requires JWT auth and manages call, skip-with-reason, and verified completion, plus booking records and transaction history.

## State and privacy

Booking personal details are stored in MySQL only. The contract stores a request commitment, internal integer ID, daily token, source enum, timestamp, status, and actor address for administrative events. Skip reasons are private to the database; a hash commitment is recorded on chain.

Queue status transitions:

```text
WAITING -> CALLED -> VERIFIED -> COMPLETED
                   \-> SKIPPED (only from CALLED)
```

Only one token can be active. A skipped token remains in both histories. Backend queue-session row locks serialize same-day booking and queue operations; MySQL uniqueness on request IDs makes retries idempotent.

## Fixed stack

React/Vite/JavaScript, Express REST API, Socket.IO, MySQL, Solidity, Hardhat, Ethers.js, bcrypt, and JWT. A local Hardhat node is used for development.

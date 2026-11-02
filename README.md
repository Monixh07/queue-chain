# QueueChain

QueueChain is a centrally administered queue-management prototype with a Solidity-backed, auditable FIFO booking sequence. Online bookings and administrator-entered walk-ins use the same booking service and smart-contract method. Names, phone numbers, emails, and skip reasons stay in MySQL; chain records contain booking references, queue state, action metadata, and a commitment to a skip reason.

The application has three interfaces: a unified booking portal, a public queue display with phone matching for the current call, and an administrator dashboard. Phone matching is a prototype check, not secure identity verification for a government service.

## Requirements

- Node.js 20+ and npm
- MySQL 8.0+
- Windows PowerShell (commands below use `npm.cmd` to work with restrictive PowerShell execution policies)

## Local setup

1. Install the project dependencies:

   ```powershell
   npm.cmd --prefix frontend install
   npm.cmd --prefix backend install
   npm.cmd --prefix blockchain install
   ```

2. Create the database and tables in MySQL:

   ```powershell
   $mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
   Get-Content database\schema.sql -Raw | & $mysql --user=root --password
   ```

   If `mysql` is not on `PATH`, run the same SQL file in MySQL Workbench.

3. Use a least-privilege MySQL account for the API. In MySQL Workbench or a root MySQL session, create a unique local password and grant only the needed database access:

   ```sql
   CREATE USER 'queuechain_app'@'127.0.0.1' IDENTIFIED BY 'replace_with_a_unique_local_password';
   GRANT SELECT, INSERT, UPDATE ON queuechain.* TO 'queuechain_app'@'127.0.0.1';
   ```

4. Copy `.env.example` to `backend\.env`. Set `DB_USER=queuechain_app`, set `DB_PASSWORD` to the password from the prior step, and generate separate random values for `JWT_SECRET` and `ADMIN_SETUP_KEY`:

   ```powershell
   Copy-Item .env.example backend\.env
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

5. Start the local Hardhat chain in a dedicated terminal:

   ```powershell
   npm.cmd --prefix blockchain run node
   ```

   Hardhat prints local development accounts and their test-only private keys. Copy account 0's private key into `BLOCKCHAIN_PRIVATE_KEY` in `backend\.env`. Never use these keys outside the local test chain.

6. In a second terminal, compile, test, and deploy the contract:

   ```powershell
   npm.cmd --prefix blockchain run compile
   npm.cmd --prefix blockchain test
   npm.cmd --prefix blockchain run deploy:local
   ```

   Copy the deployed address printed by the deployment command into `QUEUECHAIN_CONTRACT_ADDRESS` in `backend\.env`. Restart the backend after changing environment variables.

7. Start the API and real-time socket server:

   ```powershell
   npm.cmd --prefix backend start
   ```

8. Start the frontend in another terminal and open the displayed local URL:

   ```powershell
   npm.cmd --prefix frontend run dev
   ```

The frontend is served at `http://localhost:5173`; the API is at `http://localhost:4000`. The first administrator is created from Admin → “First time? Set up administrator” using `ADMIN_SETUP_KEY`. Choose a unique password of at least 12 characters. There are no hard-coded production application credentials.

## Demonstration

1. Submit an online booking in Booking portal. It receives the next daily token and a confirmed transaction hash.
2. Sign in as administrator and choose “Create offline booking”. This reuses the same form and allocates from the same sequence.
3. In Admin, call next. Public display updates through Socket.IO; registered phone matching verifies only the active token.
4. Only a verified token can be completed. A called visitor can be skipped with a required reason. The skipped token stays in database and contract history; it is not deleted or renumbered.
5. Open blockchain transaction history to review confirmed operation hashes.

## Checks

```powershell
npm.cmd --prefix frontend run build
npm.cmd --prefix backend test
npm.cmd --prefix blockchain run compile
npm.cmd --prefix blockchain test
```

The frontend build does not require MySQL or a running chain. Full booking and queue actions require MySQL, the local Hardhat node, a deployed contract, and backend environment configuration.

## Important prototype limitations

- The queue date is UTC, matching the local EVM timestamp. Daily visible tokens reset at UTC midnight; internal on-chain booking IDs remain global.
- The backend signs transactions using one local development wallet. Secure production key management, backup, multi-centre support, operational monitoring, and hardened identity verification are intentionally outside this single-centre prototype.
- If a chain booking succeeds but its MySQL transaction fails, retrying the same request ID checks the contract for the existing booking and reconciles its token and transaction hash into MySQL instead of minting another token.
- A confirmed queue-action transaction followed by a MySQL commit failure is not automatically reconciled yet; verify the contract and event history before retrying administrative queue actions after a database outage.
- Admin actions require the API and database to be available. Do not expose the development server or Hardhat node to the public internet.

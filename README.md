# QueueChain

QueueChain is a centrally administered queue-management prototype with a Solidity-backed, auditable FIFO booking sequence. Online bookings and administrator-entered walk-ins use the same booking service and smart-contract method. Names, phone numbers, emails, and skip reasons stay in MySQL; chain records contain booking references, queue state, action metadata, and a commitment to a skip reason.

The application has three interfaces: a unified booking portal, a public queue display with phone matching for the current call, and an administrator dashboard. Phone matching is a prototype check, not secure identity verification for a government service.

## Requirements

- Node.js 20+ and npm
- MySQL 8.0+
- Windows PowerShell (commands below use `npm.cmd` to work with restrictive PowerShell execution policies)

## Local setup

### One-time setup

1. Install Node.js 20+ and MySQL 8+, and make sure the MySQL server is running.
2. Create the database and tables by running `database\schema.sql` in MySQL Workbench. Alternatively, if the MySQL command-line client is installed:

   ```powershell
   $mysql = 'C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe'
   Get-Content database\schema.sql -Raw | & $mysql --user=root --password
   ```

3. If `backend\.env` does not exist, copy `.env.example` to create it. Otherwise, edit the existing file without overwriting it. Set your MySQL username/password, plus random values for `JWT_SECRET` and `ADMIN_SETUP_KEY`. Generate a random value with:

   ```powershell
   Copy-Item .env.example backend\.env
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

4. Install blockchain dependencies and start the Hardhat node once to get its first local account private key:

   ```powershell
   npm.cmd --prefix blockchain install
   npm.cmd --prefix blockchain run node
   ```

   Copy account 0's private key into `BLOCKCHAIN_PRIVATE_KEY` in `backend\.env`. This is a test-only key; never use it outside the local Hardhat chain. Stop the node with Ctrl+C after setup.

### Start the project

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\start-local.ps1
   ```

The launcher installs missing dependencies, starts the local blockchain if needed, deploys the contract when one is not already deployed, and opens the API and frontend in separate terminals. Open `http://localhost:5173`. The contract address is saved to `backend\.env` automatically. Keep all service terminals open while using the app.

The first administrator is created from Admin → “First time? Set up administrator” using `ADMIN_SETUP_KEY`. Choose a unique password of at least 12 characters. There are no hard-coded production application credentials.

Hardhat's local chain is in-memory. Keep its terminal running between app restarts. If you stop the chain, restarting it creates a fresh chain; previously stored database bookings will not exist on that new chain.

## Deploy the frontend to Vercel

The Vite frontend can be deployed to Vercel independently; the API, MySQL database, and blockchain node/contract must be hosted separately. Do not use a local Hardhat node or local MySQL instance for a public deployment.

1. Import this repository into Vercel and set the project **Root Directory** to `frontend`.
2. Vercel uses `frontend/vercel.json` to build the app into `dist` and serve the frontend for all paths.
3. In the Vercel project settings, add `VITE_API_URL` for the Production environment with the public HTTPS origin of the deployed backend, for example `https://queuechain-api.example.com`. Do not include `/api` at the end. Redeploy after setting or changing it.
4. Configure the backend's `FRONTEND_ORIGIN` to the exact Vercel frontend origin, such as `https://queuechain.vercel.app`, and set the backend's database, JWT, admin setup, and blockchain environment variables on its host. The backend must support persistent Socket.IO connections.
5. Deploy the backend to a server/runtime that supports the project's Express and Socket.IO server, then check its `/api/health` endpoint before testing booking, admin, and live queue updates.

`VITE_API_URL` is included in the public frontend bundle, so it must only contain the backend's public URL—never credentials or private keys. Without it, the frontend uses relative URLs, which is intended for local development through the Vite proxy and will not connect to a separately hosted production API.

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

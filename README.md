![UPAD — powered by UCASH](docs/upad-banner.svg)

<p align="center"><img src="public/assets/logo.png" width="120" alt="UCash ninja logo"></p>

# UPAD — powered by UCASH

A Solana token launchpad with UCash's bubble-inspired interface, token artwork uploads, wallet selection, and on-chain launch/trading transaction preparation.

[Visit UPAD](https://www.upad.cash/) · [UCash ecosystem](https://www.ucash.finance/)

## What is included

- Solana Wallet Standard discovery and the official wallet-adapter picker, plus Phantom, Solflare, Coinbase, Trust, Coin98 and Ledger adapters.
- iPhone links that open UPAD inside Phantom or Solflare's app browser.
- Token artwork upload and hosted metadata; creators do not need to supply a metadata JSON URL.
- Meteora bonding-curve launches, trading, receipt verification and graduated-pool support.
- Durable PostgreSQL storage for Vercel; local SQLite for development.
- Saved X contract-address mention counts, with capped, explicit administrator scans.

## Honest feature status

This repository packages the currently deployed wallet release, not the unfinished Privy/X-claim work. Automated community payouts, X-linked claim wallets, holder distribution and automated buyback/burn are **not enabled**. Saved mention counts are not proof of a funded reward balance.

Transaction construction, signatures, simulation and confirmation checks are implemented. A real funded mainnet launch, trade, fee claim and graduation have not all been verified end to end. Publishing this source does not constitute a security audit or a guarantee of safe mainnet operation.

The configured fee split is 20% to the platform and 80% to the creator, after underlying protocol deductions—not 20% of trade volume. Mainnet activity requires SOL and approval in the user's wallet. No wallet private keys belong in the server configuration.

## Run locally

Use Node.js 24.12 or newer. Install dependencies with `npm ci`, copy `.env.example` to `.env`, then run `npm start`. Open `http://localhost:8798/`.

Run `npm test` for fixture-based tests. These tests do not make paid X searches or submit funded transactions. Run `npm run build:wallet` after changing the wallet client; the output is self-hosted in `public/`.

Public Solana RPC can be rate-limited. A dedicated private RPC is recommended before relying on this for production traffic.

## Deploy

Use Vercel with the included `vercel.json`: static assets are in `public/` and the launch API runs through `api/launchpad.js`. GitHub Pages alone cannot run this backend.

Configure private `DATABASE_URL`, `SOLANA_NETWORK`, `SOLANA_RPC_URL`, `UCASH_PUBLIC_HOST`, and an independently generated, long `LAUNCHPAD_ADMIN_TOKEN` in the hosting dashboard. Optional `X_BEARER_TOKEN` belongs only in private server environment variables. Never commit `.env`, credentials, database files or `.vercel`.

X scans are not scheduled automatically. The current hard caps are 10 posts per request, one request per hour and five requests per rolling 24 hours. X credit exhaustion pauses scanning; refreshes display saved data rather than silently purchasing more results. API pricing and external policies still apply.

## Security and ownership

Do not report vulnerabilities by posting secrets or exploit details in public issues. Keep dependency auditing and mainnet validation part of release review. Some upstream dependencies currently have reported vulnerabilities; no claim of a clean audit is made.

No open-source license has been selected. Public access to this repository is not a grant of an additional license.

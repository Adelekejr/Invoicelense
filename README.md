# Invoice Lens

**Clarity before payment.** Paste an invoice, inspect editable payment details, and approve a native NEAR testnet transfer in your own wallet. A receipt is issued only after a final, successful transaction matches the reviewed signer, recipient, and amount.

This is a local evaluation/learning build, not a hackathon submission or a production payment product. It uses the selected IL Aperture branding and supplied monochrome technical UI design.

## Important wallet limitation

[MyNearWallet's testnet site](https://testnet.mynearwallet.com/) currently announces planned deprecation on **31 October 2026**. This evaluation retains its NEAR testnet adapter, but wallet availability and a supported NEAR-testnet replacement must be reassessed before a November rebuild or demo. No other chain, mainnet, or cross-chain path is included.

## Run locally

Use Node.js **22.12+** (Node 24 recommended) and npm. Tested with Node 24.19.0 and npm 11.17.0.

```sh
npm ci
npm run dev -- --port 8084
```

Open `http://localhost:8084`. No environment variables, API keys, backend, contract deployment, or private keys are required. Use the same origin and browser tab throughout a wallet rehearsal: drafts and payment intents are tab-scoped. Allow wallet popups; the installed MyNearWallet adapter uses a popup and message response, with a callback URL for recovery.

To inspect the production build locally:

```sh
npm run build
npm run preview -- --port 8085
```

## Try it without a wallet

1. Choose **Try a sample**, then **Extract details**.
2. Inspect the payee, invoice reference, and amount. The sample deliberately has no recipient; extraction never invents one.
3. Enter an account confirmed with the intended recipient, such as your own existing `.testnet` account. A correctly formatted account is not proof of ownership or existence.
4. Try USD or `someone.near`; payment review is blocked. Restore NEAR and the correct testnet account.
5. Choose **Review payment**. Check the exact amount, recipient, signer, testnet network, and additional wallet fee. Close the dialog without connecting if you only want to review the UI.

The parser is **local and rule-based, not AI or OCR**. It reads explicit labels such as `Payee:`, `Invoice number:`, `Total: 0.10 NEAR`, and `Recipient:`. Ambiguous or missing values remain blank. All extracted fields are editable.

## Owner-only testnet rehearsal

A complete real payment has **not** been rehearsed. Automated wallet/RPC fixtures are not blockchain payments.

Use a wallet with testnet NEAR, and an existing recipient testnet account you control or have independently verified. Create/import the wallet yourself using its trusted interface; never send a seed phrase or private key to this app or an assistant.

1. Choose **Connect wallet**, allow the wallet popup, and personally complete wallet account access. Keep the app tab open.
2. Review a small amount of your choice, such as `0.001 NEAR`, with the correct testnet recipient and a new invoice reference.
3. Confirm the review checkbox and personally choose **Request wallet signature**. Inspect the wallet's network, recipient, amount, and fee before signing. Only you may initiate and sign the actual transfer.
4. After the wallet responds, the app queries `https://rpc.testnet.near.org`. Verification requires `FINAL` execution, success, the matching transaction hash, signer and recipient, and exactly one native Transfer action for the reviewed yoctoNEAR amount.
5. Check **FINAL TRANSFER VERIFIED**, download the receipt, and open its testnet explorer link. Confirm the same invoice is blocked locally.

If interrupted, rejected, or the RPC is unavailable, the pending intent remains and another payment is blocked. Check wallet activity first. Paste the existing transaction hash into **Verify transfer**; do not send the payment again. Discarding an intent deletes only local state and never cancels a blockchain transfer. If receipt storage fails, download the in-memory receipt immediately.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit
```

Browser tests use Chromium at `/usr/bin/chromium` by default. On another system, install a compatible Chromium and set `CHROMIUM_PATH` to its absolute executable path. Playwright starts Vite on port 8084, or reuses an existing local server. For a clean isolated run, set `CI=1` and ensure that port is free.

The browser matrix covers 1440px desktop, 820px tablet, 390px phone, and 320px small phone. Tests exercise extraction/editing/review, persistence, keyboard focus, callback rejection, pending recovery, failed RPC verification, exact-match fixture receipts, downloads, duplicates, and storage failures. Mock transactions are explicitly labelled as fixtures.

Dependency audit currently reports **10 low-severity findings**, with no moderate/high/critical findings. A non-breaking `npm audit fix --dry-run` changes nothing; suggested force fixes include a wallet SDK major downgrade. Do not force-change dependencies without revalidating the wallet flow. Production bundling also reports upstream wallet dependency `eval`/browser-compatibility and large-chunk warnings. These are unresolved dependency risks, not a clean security audit.

## Data and trust boundaries

- Draft invoice text and pending intent: this tab's session storage. Verified receipts: browser local storage. No invoice-text upload or analytics backend.
- Public account IDs, transfer amount, fees, and transaction activity are visible to the NEAR testnet RPC/wallet and on-chain. Payee name, invoice number, and source text are not added to the transfer.
- Receipt JSON downloads contain private invoice fields. Store and share them deliberately.
- Local history can be altered or cleared. Duplicate detection is a convenience for this browser only, not global or on-chain enforcement. Verify the explorer when independent proof matters.
- Native NEAR only; no fiat conversion, token contracts, AI parsing, OCR, or automated signatures. This prototype is not independently security-audited.

## Project map

- `src/domain.ts`: extraction, validation, exact decimal conversion, local duplicate detection.
- `src/near.ts`: fixed testnet adapter, account checks, native transfer request, finality verification.
- `src/App.tsx`: review gate, pending recovery, local receipts and downloads.
- `src/*.test.ts`: unit and mocked wallet/RPC checks.
- `e2e/`: responsive browser and recovery regressions.
- `docs/BUILD_PLAN.md`: acceptance checklist, decisions, and remaining evaluation gate.

Work remains local on `feature/invoice-lens-mvp`. `main` is preserved. Committing, pushing the public branch, deployment, and hackathon submission are separate owner decisions.

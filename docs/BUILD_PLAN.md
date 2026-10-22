# Invoice Lens — evaluation checklist

A focused invoice-to-testnet-payment workspace. The differentiator is a visible, editable payment intent and a receipt issued only after matching the final on-chain transfer.

## Implemented and checked

- [x] Paste text and extract explicit invoice fields locally; missing or ambiguous fields stay blank. No AI or OCR claims.
- [x] Edit every field; block missing data, unsupported currency, invalid/mainnet accounts, precision/range errors, and known local duplicates.
- [x] Review exact amount, recipient, signer and fixed testnet network; require explicit approval before requesting a wallet signature.
- [x] Integrate MyNearWallet's real testnet adapter using one native Transfer through the contract-free batch API; keep intent before calling the wallet.
- [x] Verify exact transaction hash, final execution, success, signer, recipient, amount, and one-action shape before creating a receipt.
- [x] Keep invoice source, payee and invoice number off-chain. Request no contract access key or automatic signing permission.
- [x] Empty, loading, blocked, failed, pending and verified states; local history and private JSON receipt download.
- [x] Keyboard/focus support, reduced motion, mobile navigation and responsive layouts.
- [x] Regression tests cover callback failures, reload recovery, blocked storage, failed verification, fixture receipts, downloads and duplicates. Mock wallet checks do not broadcast transactions.

## Remaining gate

- [ ] Owner personally connects a funded testnet wallet, initiates and signs one small native transfer to a verified existing testnet recipient, then confirms the app's real final receipt and explorer match.

No real transfer, signature, wallet account creation, or private-key handling was performed. A Connect wallet smoke check reached a waiting state, but no account authorization or completed connection was established; it does not prove an end-to-end wallet path. Reloaded the app back to a usable unsigned state. The README gives the exact owner-only rehearsal.

## Decisions and review fixes

React + TypeScript + Vite, with no backend or custom contract. Local explicit-label parsing is deliberately not represented as AI. The near-white grid, Space Grotesk / IBM Plex Mono, thin borders, restrained signal green, and supplied IL Aperture branding remain intact.

The follow-up review strengthened RPC error handling using a real, read-only testnet unknown-account response (`error.cause.name`, not generic `Server error`). It also blocked mainnet-style signers, enforced u128 amount bounds, normalized equivalent decimal totals, limited payment-based duplicate matching to valid NEAR testnet identities, fixed pending hash editing, and prevented false “receipt saved” claims when browser storage fails. The signature gate refuses to proceed when it cannot preserve the pending intent.

## Dependency risks

[MyNearWallet's live testnet site](https://testnet.mynearwallet.com/) announces planned deprecation on **31 October 2026**. Retained only for this evaluation; reassess a supported NEAR-testnet wallet before a November rebuild. No alternate chain or mainnet path was added.

`npm audit` reports 10 low-severity findings in the wallet dependency tree and no moderate/high/critical findings. A non-breaking audit fix dry run makes no changes; proposed force remediation includes a major SDK downgrade and was not applied. Build warnings remain for upstream `eval`, browser `util` externalization, and a large JS chunk. This is not an independent security audit or a production-readiness claim.

Duplicate checks only cover local history, which can be cleared or edited. They are not an on-chain policy. Receipt downloads include private invoice fields. Testnet RPC reads confirmed `chain_id: testnet`; no transaction was broadcast.

## Delivery boundary

The owner approved committing and pushing `feature/invoice-lens-mvp` to the existing public `Adelekejr/Invoicelense` repository. Preserve `main` and existing history. This approval does not authorize a merge, production deployment, new repository, or hackathon submission.

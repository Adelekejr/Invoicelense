import { actionCreators, setupWalletSelector, type FinalExecutionOutcome, type InjectedWallet, type WalletSelector } from "@near-wallet-selector/core";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";

const RPC_URL = "https://rpc.testnet.near.org";
const NETWORK = "testnet" as const;
const FETCH_TIMEOUT_MS = 12_000;

type TransferRequest = {
  destination: string;
  amountYocto: string;
  signer: string;
};

type VerifiedTransfer = { transactionHash: string; verifiedAt: string };

let selectorPromise: Promise<WalletSelector> | undefined;

class NearRpcError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

async function selector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = setupWalletSelector({
      network: NETWORK,
      // v10.1.4 gets the redirect URL from window.location at sign-in/transfer
      // time; successUrl/failureUrl are not consumed by setupMyNearWallet.
      modules: [setupMyNearWallet({ walletUrl: "https://testnet.mynearwallet.com" })],
    });
  }
  return selectorPromise;
}

function validAccountId(accountId: string): boolean {
  // NEAR account IDs are lowercase, 2–64 characters, and may contain dots,
  // dashes and underscores. This deliberately rejects URLs and whitespace.
  return typeof accountId === "string" && accountId.length >= 2 && accountId.length <= 64 &&
    /^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(accountId) &&
    !/[._-]{2}/.test(accountId);
}

function validYocto(amount: string): boolean {
  return typeof amount === "string" && /^[0-9]+$/.test(amount) && BigInt(amount) > 0n && BigInt(amount) <= (1n << 128n) - 1n;
}

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`NEAR RPC HTTP ${response.status}`);
    const body = await response.json() as { result?: T; error?: { message?: string; cause?: { name?: string } } };
    if (body.error || body.result === undefined) throw new NearRpcError(body.error?.message || "NEAR RPC error", body.error?.cause?.name);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

async function accountExists(accountId: string): Promise<boolean> {
  try {
    await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
    return true;
  } catch (error) {
    // UNKNOWN_ACCOUNT is the only expected negative result. Network, HTTP,
    // timeout, and malformed-RPC errors must reach the caller unchanged.
    if (error instanceof NearRpcError && error.code === "UNKNOWN_ACCOUNT") return false;
    throw error;
  }
}

function testnetAccountId(accountId: string): boolean {
  return validAccountId(accountId) && (accountId.endsWith(".testnet") || /^[a-f0-9]{64}$/.test(accountId));
}

export async function connectWallet(): Promise<string> {
  const s = await selector();
  const wallet = await s.wallet<InjectedWallet>("my-near-wallet");
  const accounts = await wallet.signIn({});
  const account = accounts?.[0]?.accountId;
  if (!account) throw new Error("Wallet did not return an account");
  return account;
}

export async function getConnectedAccount(): Promise<string | null> {
  try {
    const s = await selector();
    if (!s.isSignedIn()) return null;
    const accounts = await (await s.wallet()).getAccounts();
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

export async function disconnectWallet(): Promise<void> {
  const s = await selector();
  const wallet = await s.wallet();
  await wallet.signOut();
}

export async function sendTransfer({ destination, amountYocto, signer }: TransferRequest): Promise<string | null> {
  if (!testnetAccountId(destination)) throw new Error("Invalid NEAR destination account");
  if (!testnetAccountId(signer)) throw new Error("Invalid NEAR signer account");
  if (!validYocto(amountYocto)) throw new Error("Invalid yoctoNEAR amount");
  if (!(await accountExists(signer))) throw new Error("Signer account does not exist on testnet");
  if (!(await accountExists(destination))) throw new Error("Destination account does not exist on testnet");

  const s = await selector();
  const wallet = await s.wallet();
  const accounts = await wallet.getAccounts();
  if (!accounts.some((a) => a.accountId === signer)) throw new Error("Connected wallet signer mismatch");
  // My NEAR Wallet v10's singular API requires a contract in selector state.
  // Its batch API supports native transfers without requesting a contract key.
  const results = await wallet.signAndSendTransactions({
    transactions: [{
      signerId: signer,
      receiverId: destination,
      actions: [actionCreators.transfer(BigInt(amountYocto))],
    }],
  });
  const result = results?.[0];
  if (!result) return null;
  return result.transaction.hash || result.transaction_outcome.id || null;
}

export async function verifyTransfer(hash: string, expected: { signer: string; destination: string; amountYocto: string }): Promise<VerifiedTransfer> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(hash)) throw new Error("Invalid transaction hash");
  if (!validAccountId(expected.signer) || !validAccountId(expected.destination) || !validYocto(expected.amountYocto)) throw new Error("Invalid expected transfer");
  const tx = await rpc<FinalExecutionOutcome>("tx", {
    tx_hash: hash,
    sender_account_id: expected.signer,
    wait_until: "FINAL",
  });
  const transaction = tx?.transaction;
  const status = tx?.status;
  if (tx?.final_execution_status !== "FINAL" || transaction?.hash !== hash || !status || typeof status !== "object" || !Object.prototype.hasOwnProperty.call(status, "SuccessValue")) throw new Error("Transaction is not final and successful");
  if (transaction?.signer_id !== expected.signer || transaction?.receiver_id !== expected.destination) throw new Error("Transfer parties do not match");
  const actions = transaction?.actions;
  if (!Array.isArray(actions) || actions.length !== 1 || !actions[0]?.Transfer || actions[0].Transfer.deposit !== expected.amountYocto) throw new Error("Transaction is not exactly the expected transfer");
  return { transactionHash: hash, verifiedAt: new Date().toISOString() };
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  signIn: vi.fn(), signOut: vi.fn(), getAccounts: vi.fn(), send: vi.fn(),
  setup: vi.fn(), select: vi.fn(), myNear: vi.fn(),
}));
vi.mock('@near-wallet-selector/core', () => ({
  setupWalletSelector: mock.setup,
  actionCreators: { transfer: (amount: bigint) => ({ enum: 'transfer', transfer: { deposit: amount } }) },
}));
vi.mock('@near-wallet-selector/my-near-wallet', () => ({ setupMyNearWallet: mock.myNear }));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  const wallet = { signIn: mock.signIn, getAccounts: mock.getAccounts, signOut: mock.signOut, signAndSendTransactions: mock.send };
  mock.select.mockResolvedValue(wallet);
  mock.setup.mockResolvedValue({ wallet: mock.select, isSignedIn: () => true });
  mock.getAccounts.mockResolvedValue([{ accountId: 'sender.testnet' }]);
  mock.signIn.mockResolvedValue([{ accountId: 'sender.testnet' }]);
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ result: { amount: '1' } }), { status: 200 })));
});

describe('wallet adapter wiring (mock wallet, no signing)', () => {
  it('selects My NEAR Wallet explicitly and signs in without contract/key permissions', async () => {
    const near = await import('./near');
    expect(await near.connectWallet()).toBe('sender.testnet');
    expect(mock.select).toHaveBeenCalledWith('my-near-wallet');
    expect(mock.signIn).toHaveBeenCalledWith({});
    expect(mock.setup).toHaveBeenCalledWith(expect.objectContaining({ network: 'testnet' }));
    expect(mock.myNear).toHaveBeenCalledWith({ walletUrl: 'https://testnet.mynearwallet.com' });
    expect(mock.myNear).not.toHaveBeenCalledWith(expect.objectContaining({ walletUrl: 'https://mynearwallet.com' }));
  });
  it('requests exactly one native transfer through the contract-free batch API', async () => {
    const hash = '1'.repeat(44);
    mock.send.mockResolvedValue([{ transaction: { hash }, transaction_outcome: { id: hash } }]);
    const near = await import('./near');
    expect(await near.sendTransfer({ signer: 'sender.testnet', destination: 'recipient.testnet', amountYocto: '1000' })).toBe(hash);
    expect(mock.send).toHaveBeenCalledWith({ transactions: [{ signerId: 'sender.testnet', receiverId: 'recipient.testnet', actions: [{ enum: 'transfer', transfer: { deposit: 1000n } }] }] });
  });
  it('blocks a signer mismatch before wallet signature', async () => {
    mock.getAccounts.mockResolvedValue([{ accountId: 'other.testnet' }]);
    const near = await import('./near');
    await expect(near.sendTransfer({ signer: 'sender.testnet', destination: 'recipient.testnet', amountYocto: '1000' })).rejects.toThrow('Connected wallet signer mismatch');
    expect(mock.send).not.toHaveBeenCalled();
  });
  it('blocks an unavailable recipient before wallet signature', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ result: {} }))).mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Server error', cause: { name: 'UNKNOWN_ACCOUNT' } } })));
    const near = await import('./near');
    await expect(near.sendTransfer({ signer: 'sender.testnet', destination: 'recipient.testnet', amountYocto: '1000' })).rejects.toThrow('Destination account does not exist on testnet');
    expect(mock.send).not.toHaveBeenCalled();
  });
});

import { test, expect, type Page } from '@playwright/test';

// These fixtures exercise UI recovery only; they do not sign or broadcast a transfer.
const hash = '1'.repeat(44);
const invoice = { payee: 'RECOVERY TEST FIXTURE', invoiceNumber: 'RECOVERY-001', amount: '0.1', currency: 'NEAR', destination: 'recipient.testnet' };
async function pending(page: Page, savedHash = false) {
  await page.addInitScript(({ invoice, hash, savedHash }) => {
    if (!sessionStorage.getItem('fixture-initialized')) {
      sessionStorage.setItem('invoice-lens:pending:v1', JSON.stringify({ invoice, signer: 'sender.testnet', ...(savedHash ? { hash } : {}) }));
      sessionStorage.setItem('invoice-lens:draft:v1', JSON.stringify({ text: 'RECOVERY TEST FIXTURE', invoice, extracted: true }));
      sessionStorage.setItem('fixture-initialized', 'true');
    }
  }, { invoice, hash, savedHash });
}
async function finalRPC(page: Page) {
  await page.route('https://rpc.testnet.near.org/', route => {
    if (route.request().postDataJSON().method !== 'tx') return route.fulfill({ json: { result: {} } });
    return route.fulfill({ json: { result: { final_execution_status: 'FINAL', status: { SuccessValue: '' }, transaction: { hash, signer_id: 'sender.testnet', receiver_id: invoice.destination, actions: [{ Transfer: { deposit: '100000000000000000000000' } }] } } } });
  });
}

test('wallet cancellation preserves intent and locks edits across reload', async ({ page }) => {
  await pending(page);
  await page.goto('/?errorCode=UserRejected&errorMessage=untrusted');
  await expect(page.getByRole('alert')).toContainText('did not complete signing');
  await expect(page.getByLabel('AMOUNT', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review payment', exact: true })).toBeDisabled();
  await expect(page).toHaveURL(/\/$/);
  await page.reload();
  await expect(page.getByText('PENDING VERIFICATION', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Discard local intent' }).click();
  await expect(page.getByText('PENDING VERIFICATION', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Discard local intent' }).click();
  await expect(page.getByText('PENDING VERIFICATION', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('AMOUNT', { exact: true })).toBeEnabled();
});

test('saved transaction hash is editable and RPC failures never produce receipts', async ({ page }) => {
  await pending(page, true);
  await page.route('https://rpc.testnet.near.org/', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await page.goto('/');
  const input = page.getByLabel('TRANSACTION HASH', { exact: true });
  await expect(input).toHaveValue(hash);
  await input.fill('');
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Verify transfer', exact: true })).toBeDisabled();
  await input.fill(hash);
  await page.getByRole('button', { name: 'Verify transfer', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('503');
  await expect(page.getByText('FINAL TRANSFER VERIFIED', { exact: true })).toHaveCount(0);
  await expect(page.getByText('PENDING VERIFICATION', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('invoice-lens:receipts:v1'))).toBeNull();
});

test('wallet callback verifies exact intent and removes callback parameters', async ({ page }) => {
  await pending(page);
  await finalRPC(page);
  await page.goto(`/?transactionHashes=${hash}`);
  await expect(page.getByText('FINAL TRANSFER VERIFIED', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => sessionStorage.getItem('invoice-lens:pending:v1'))).toBeNull();
  await page.reload();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('invoice-lens:receipts:v1') || '[]').length)).toBe(1);
});

test('multiple callback hashes cannot produce a receipt', async ({ page }) => {
  await pending(page);
  await page.goto(`/?transactionHashes=${hash},${hash}`);
  await expect(page.getByRole('alert')).toContainText('Unexpected multiple transactions');
  await expect(page.getByText('PENDING VERIFICATION', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('invoice-lens:receipts:v1'))).toBeNull();
});

test('verified transfer with storage failure offers download without false saved claim', async ({ page }) => {
  await pending(page);
  await finalRPC(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'invoice-lens:receipts:v1') throw new DOMException('Quota exceeded', 'QuotaExceededError');
      original.call(this, key, value);
    };
  });
  await page.goto(`/?transactionHashes=${hash}`);
  await expect(page.getByText('FINAL TRANSFER VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText(/Browser storage could not save the receipt/)).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download receipt', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('invoice-lens-RECOVERY-001.json');
});

test('corrupt saved data falls back safely and keyboard focus returns from review', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('invoice-lens:draft:v1', '{broken');
    sessionStorage.setItem('invoice-lens:pending:v1', JSON.stringify({ invoice: null, signer: 12 }));
    localStorage.setItem('invoice-lens:receipts:v1', JSON.stringify([null, {}, { invoice: 'bad' }]));
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await page.getByRole('button', { name: 'Extract details', exact: true }).click();
  await page.getByLabel('RECIPIENT ACCOUNT', { exact: false }).fill('recipient.testnet');
  const review = page.getByRole('button', { name: 'Review payment', exact: true });
  await review.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(review).toBeFocused();
  expect(errors).toEqual([]);
});

async function fixtureWallet(page: Page) {
  await page.route('**/src/near.ts*', route => route.fulfill({ contentType: 'application/javascript', body: `
    export async function getConnectedAccount(){return 'sender.testnet'}
    export async function connectWallet(){return 'sender.testnet'}
    export async function disconnectWallet(){}
    export async function sendTransfer(){window.__fixtureRequests=(window.__fixtureRequests||0)+1; throw new Error('TEST FIXTURE: signing rejected')}
    export async function verifyTransfer(){throw new Error('TEST FIXTURE ONLY')}
  ` }));
}
async function reviewFixture(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await page.getByRole('button', { name: 'Extract details', exact: true }).click();
  await page.getByLabel('RECIPIENT ACCOUNT', { exact: false }).fill('recipient.testnet');
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
}

test('mock wallet requires explicit review approval and rejection never auto-retries', async ({ page }) => {
  await fixtureWallet(page);
  await reviewFixture(page);
  const sign = page.getByRole('button', { name: 'Request wallet signature', exact: true });
  await expect(sign).toBeDisabled();
  await expect(page.locator('dialog')).toContainText('sender.testnet');
  await page.getByRole('checkbox').check();
  await expect(sign).toBeEnabled();
  await sign.click();
  await expect(page.getByRole('alert')).toContainText('TEST FIXTURE: signing rejected');
  await expect(page.getByText('PENDING VERIFICATION', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review payment', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as Window & { __fixtureRequests?: number }).__fixtureRequests)).toBe(1);
});

test('blocked session storage prevents even a mocked wallet signature request', async ({ page }) => {
  await fixtureWallet(page);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'invoice-lens:pending:v1') throw new DOMException('Storage blocked', 'SecurityError');
      original.call(this, key, value);
    };
  });
  await reviewFixture(page);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Request wallet signature', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Browser session storage is unavailable');
  expect(await page.evaluate(() => (window as Window & { __fixtureRequests?: number }).__fixtureRequests || 0)).toBe(0);
});

test('long identifiers and full-precision amounts stay inside the screen', async ({ page }) => {
  await fixtureWallet(page);
  await reviewFixture(page);
  await page.keyboard.press('Escape');
  await page.getByLabel('PAYEE', { exact: true }).fill('PAYEE'.repeat(70));
  await page.getByLabel('INVOICE NUMBER', { exact: true }).fill('REFERENCE'.repeat(60));
  await page.getByLabel('AMOUNT', { exact: true }).fill('1.123456789012345678901234');
  await page.getByLabel('RECIPIENT ACCOUNT', { exact: false }).fill('a'.repeat(56) + '.testnet');
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  await expect(page.locator('dialog')).toBeVisible();
  expect(await page.evaluate(() => {
    const d = document.querySelector('dialog')!;
    return document.documentElement.scrollWidth <= innerWidth && d.scrollWidth <= d.clientWidth;
  })).toBe(true);
});

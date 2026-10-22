import { test, expect } from '@playwright/test';

async function sample(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'Try a sample', exact: true }).click();
  await page.getByRole('button', { name: 'Extract details', exact: true }).click();
  await expect(page.getByLabel('PAYEE', { exact: true })).toHaveValue('Northstar Studio');
}
async function navigateReceipts(page: import('@playwright/test').Page) {
  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: /^Receipts/ }).click();
}

test('fresh session → extraction → editing → exact review gate; no signing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Extract details', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Review payment', exact: true })).toBeDisabled();
  await sample(page);
  await expect(page.getByLabel('AMOUNT', { exact: true })).toHaveValue('0.10');
  await expect(page.getByLabel('RECIPIENT ACCOUNT', { exact: false })).toHaveValue('');
  await expect(page.getByText('Destination must be a valid testnet account.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review payment', exact: true })).toBeDisabled();
  await page.getByLabel('RECIPIENT ACCOUNT', { exact: false }).fill('recipient.testnet');
  await page.getByLabel('AMOUNT', { exact: true }).fill('0.025');
  await page.getByLabel('CURRENCY', { exact: true }).selectOption('USD');
  await expect(page.getByText('Only NEAR payments are supported.')).toBeVisible();
  await page.getByLabel('CURRENCY', { exact: true }).selectOption('NEAR');
  await page.getByRole('button', { name: 'Review payment', exact: true }).click();
  const dialog = page.locator('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('0.025');
  await expect(dialog).toContainText('recipient.testnet');
  await expect(dialog).toContainText('Not connected');
  await expect(dialog.getByRole('button', { name: 'Connect testnet wallet' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByLabel('AMOUNT', { exact: true })).toHaveValue('0.025');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigateReceipts(page);
  await expect(page.getByText('No verified receipts. Yet.')).toBeVisible();
  await page.getByRole('button', { name: 'How it works' }).click();
  await expect(page.locator('dialog')).toContainText('not AI');
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('untrusted callback without saved intent cannot mint a receipt', async ({ page }) => {
  await page.goto('/?transactionHashes=11111111111111111111111111111111');
  await expect(page.getByRole('alert')).toContainText('No matching payment intent');
  await navigateReceipts(page);
  await expect(page.getByText('No verified receipts. Yet.')).toBeVisible();
});

test('mocked RPC pending → final exact match → receipt → local duplicate block (test fixture only)', async ({ page }) => {
  const hash = '1'.repeat(44);
  const invoice = { payee: 'TEST FIXTURE ONLY', invoiceNumber: 'FIXTURE-001', amount: '0.1', currency: 'NEAR', destination: 'recipient.testnet' };
  await page.addInitScript(({ invoice }) => {
    sessionStorage.setItem('invoice-lens:pending:v1', JSON.stringify({ invoice, signer: 'sender.testnet' }));
    sessionStorage.setItem('invoice-lens:draft:v1', JSON.stringify({ text: 'TEST FIXTURE ONLY', invoice, extracted: true }));
  }, { invoice });
  let final = false;
  await page.route('https://rpc.testnet.near.org/', async route => {
    const request = route.request().postDataJSON();
    if (request.method !== 'tx' && request.method !== 'EXPERIMENTAL_tx_status') return route.fulfill({ json: { result: {} } });
    await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result: { final_execution_status: final ? 'FINAL' : 'EXECUTED_OPTIMISTIC', status: { SuccessValue: '' }, transaction: { hash, signer_id: 'sender.testnet', receiver_id: 'recipient.testnet', actions: [{ Transfer: { deposit: '100000000000000000000000' } }] } } } });
  });
  await page.goto('/');
  await page.getByLabel('TRANSACTION HASH', { exact: true }).fill(hash);
  await page.getByRole('button', { name: 'Verify transfer', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('FINAL TRANSFER VERIFIED', { exact: true })).toHaveCount(0);
  final = true;
  await page.getByRole('button', { name: 'Verify transfer', exact: true }).click();
  await expect(page.getByText('FINAL TRANSFER VERIFIED', { exact: true })).toBeVisible();
  await expect(page.getByText('This invoice matches an existing receipt in this browser. Payment is blocked.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review payment', exact: true })).toBeDisabled();
  await navigateReceipts(page);
  await expect(page.getByRole('heading', { name: 'TEST FIXTURE ONLY' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download receipt FIXTURE-001' }).click();
  expect((await download).suggestedFilename()).toBe('invoice-lens-FIXTURE-001.json');
});

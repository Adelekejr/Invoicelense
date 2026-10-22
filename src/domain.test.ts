import { describe, expect, it } from 'vitest';
import { extractInvoice, findDuplicate, nearToYocto, validateInvoice, type Invoice, type Receipt } from './domain';

const valid: Invoice = {
  payee: 'Acme Ltd', amount: '0.1', currency: 'NEAR', invoiceNumber: 'INV-1', destination: 'alice.testnet',
};
const receipt: Receipt = {
  id: 'r1', invoice: valid, signer: 'alice.testnet', transactionHash: 'hash', verifiedAt: '2025-01-01T00:00:00Z', network: 'testnet',
};

describe('extractInvoice', () => {
  it('extracts explicit labelled invoice fields and a NEAR total', () => {
    expect(extractInvoice('Payee: Acme Ltd\nInvoice Number: INV-42\nTotal: 0.1 NEAR\nDestination: alice.testnet')).toEqual({
      payee: 'Acme Ltd', amount: '0.1', currency: 'NEAR', invoiceNumber: 'INV-42', destination: 'alice.testnet',
    });
  });
  it('supports ordinary fiat currency labels but does not convert them', () => {
    expect(extractInvoice('Vendor: Store\nInvoice #: A-7\nTotal: 25 USD')).toMatchObject({ amount: '25', currency: 'USD' });
  });
  it('does not invent ambiguous fields or destinations', () => {
    expect(extractInvoice('Acme Ltd\nInvoice 77\n25\nPay using your account')).toEqual({ payee: '', amount: '', currency: '', invoiceNumber: '', destination: '' });
  });
  it('only reads an implicit account when it is a labelled destination', () => {
    const account = 'a'.repeat(64);
    expect(extractInvoice(`Account: ${account}`).destination).toBe(account);
    expect(extractInvoice(`Reference ${account}`).destination).toBe('');
  });
  it('requires explicit destinations to be complete valid values', () => {
    expect(extractInvoice('Destination: alice.testnet is the recipient').destination).toBe('');
    expect(extractInvoice('Destination: treasury.ops.testnet').destination).toBe('treasury.ops.testnet');
    expect(extractInvoice('Destination: Alice.testnet').destination).toBe('');
    expect(extractInvoice('Destination: alice..testnet').destination).toBe('');
    expect(extractInvoice('Destination: alice.testnet\nDestination: bob.testnet').destination).toBe('');
  });
  it('does not use billed-to as payee and blanks conflicting labelled fields', () => {
    expect(extractInvoice('Billed to: Customer LLC\nTotal: 0.10 NEAR').payee).toBe('');
    expect(extractInvoice('Payee: Northstar Studio\nInvoice number: NS-2026-042\nTotal: 0.10 NEAR')).toMatchObject({
      payee: 'Northstar Studio', amount: '0.10', currency: 'NEAR', invoiceNumber: 'NS-2026-042',
    });
    expect(extractInvoice('Payee: A\nPayee: B').payee).toBe('');
    expect(extractInvoice('Total: 1 NEAR\nTotal: 2 NEAR').amount).toBe('');
  });
  it('keeps amount parsing on one line and supports currency before or as a symbol', () => {
    expect(extractInvoice('Subtotal: 1 NEAR\nTotal: USD\n10').amount).toBe('');
    expect(extractInvoice('Total: USD 10')).toMatchObject({ amount: '10', currency: 'USD' });
    expect(extractInvoice('Total: $10')).toMatchObject({ amount: '10', currency: 'USD' });
    expect(extractInvoice('Total: 10\nCurrency: NEAR')).toMatchObject({ amount: '10', currency: 'NEAR' });
  });
  it('treats equivalent decimal spellings as one amount candidate', () => {
    expect(extractInvoice('Total: 1.0 NEAR\nTotal: 1.00 NEAR')).toMatchObject({ amount: '1.0', currency: 'NEAR' });
  });
});

describe('nearToYocto', () => {
  it('converts decimals exactly without floating point', () => {
    expect(nearToYocto('0.1')).toBe('100000000000000000000000');
    expect(nearToYocto('1.000000000000000000000000')).toBe('1000000000000000000000000');
    expect(nearToYocto('123')).toBe('123000000000000000000000000');
  });
  it('rejects zero, negative values, exponent notation, and excess precision', () => {
    for (const amount of ['0', '0.000', '-1', '1e-2', '1.0000000000000000000000001', '']) {
      expect(() => nearToYocto(amount)).toThrow();
    }
  });
  it('rejects amounts whose yoctoNEAR value exceeds the u128 transfer bound', () => {
    expect(nearToYocto('340282366920')).toBe('340282366920000000000000000000000000');
    expect(() => nearToYocto('340282366921000000000')).toThrow(/maximum transferable/);
  });
});

describe('validateInvoice', () => {
  it('accepts a valid testnet NEAR invoice', () => expect(validateInvoice(valid)).toEqual([]));
  it('blocks fiat payment, mainnet names, invalid destinations, and invalid amounts', () => {
    expect(validateInvoice({ ...valid, currency: 'USD' }).join(' ')).toContain('NEAR');
    expect(validateInvoice({ ...valid, destination: 'alice.near' }).join(' ')).toContain('Mainnet');
    expect(validateInvoice({ ...valid, destination: 'not-an-account' }).join(' ')).toContain('valid testnet');
    expect(validateInvoice({ ...valid, amount: '1e-2' }).join(' ')).toContain('positive decimal');
    expect(validateInvoice({ ...valid, amount: '1.0000000000000000000000001' }).join(' ')).toContain('24');
    expect(validateInvoice({ ...valid, amount: '340282366921000000000' }).join(' ')).toContain('maximum');
  });
});

describe('findDuplicate', () => {
  it('matches payee and invoice number case/space insensitively', () => {
    expect(findDuplicate({ ...valid, payee: '  ACME   LTD ', invoiceNumber: 'inv-1' }, [receipt])).toBe(receipt);
  });
  it('matches a complete explicit payment identity, but not partial data', () => {
    expect(findDuplicate({ ...valid, payee: 'Other', invoiceNumber: 'Other-2' }, [receipt])).toBe(receipt);
    expect(findDuplicate({ ...valid, destination: '', invoiceNumber: 'Other-2', payee: 'Other' }, [receipt])).toBeUndefined();
    expect(findDuplicate({ ...valid, payee: 'Other', invoiceNumber: 'Other-2', amount: '0.2' }, [receipt])).toBeUndefined();
  });
  it('normalizes equivalent NEAR decimal spellings for payment identity', () => {
    expect(findDuplicate({ ...valid, amount: '0.10' }, [receipt])).toBe(receipt);
  });
  it('does not treat a non-NEAR or malformed payment as a payment duplicate', () => {
    const usdReceipt = { ...receipt, invoice: { ...receipt.invoice, currency: 'USD' } };
    expect(findDuplicate({ ...valid, currency: 'USD', payee: 'Other', invoiceNumber: 'Other-2' }, [usdReceipt])).toBeUndefined();
    expect(findDuplicate({ ...valid, destination: 'not-an-account', payee: 'Other', invoiceNumber: 'Other-2' }, [receipt])).toBeUndefined();
  });
});

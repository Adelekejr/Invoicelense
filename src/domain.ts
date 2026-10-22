export type Invoice = {
  payee: string;
  amount: string;
  currency: string;
  invoiceNumber: string;
  destination: string;
};

export type Receipt = {
  id: string;
  invoice: Invoice;
  signer: string;
  transactionHash: string;
  verifiedAt: string;
  network: 'testnet';
};

const EMPTY_INVOICE: Invoice = {
  payee: '',
  amount: '',
  currency: '',
  invoiceNumber: '',
  destination: '',
};

// NEAR testnet accounts are lowercase, have no adjacent separators, and are at most 64 chars.
// A raw 64-character hexadecimal account is also accepted.
const TESTNET_DESTINATION = /^(?=.{1,64}$)(?:[a-z0-9]+(?:[-_][a-z0-9]+)*\.)+testnet$/;
const IMPLICIT_DESTINATION = /^[a-f0-9]{64}$/;
const MAX_U128_YOCTO = '340282366920938463463374607431768211455';

function labelledValues(pattern: RegExp, text: string): string[] {
  return [...text.matchAll(pattern)].map((match) => cleanTextValue(match[1] ?? '')).filter(Boolean);
}

function cleanTextValue(value: string): string {
  return value.replace(/^[\s:#-]+/, '').replace(/[\s,;|]+$/, '').trim();
}

function uniqueNormalized(values: string[]): string[] {
  const result: string[] = [];
  for (const value of values) if (!result.some((other) => normalized(other) === normalized(value))) result.push(value);
  return result;
}

function normalizedDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.');
  const normalizedWhole = whole.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

function oneUnambiguous(values: string[]): string {
  const unique = uniqueNormalized(values);
  return unique.length === 1 ? unique[0] : '';
}

function parseAmount(text: string): { amount: string; currency: string } {
  // Match only the complete line after an exact monetary label. This excludes "Subtotal" and
  // prevents a currency or amount from consuming words on the next line.
  const lines = text.split(/\r?\n/);
  const candidates: Array<{ amount: string; currency: string }> = [];
  const label = /^\s*(?:total|amount|balance\s+due|amount\s+due|due)\s*(?:[:#=-]|is)?\s*(.*?)\s*$/i;
  const monetary = /^(?:([$€£])\s*)?([+-]?\d+(?:\.\d+)?)\s*([A-Za-z]{2,6})?\s*$/;
  const leadingCurrency = /^([A-Za-z]{2,6})\s*([+-]?\d+(?:\.\d+)?)$/;

  for (const line of lines) {
    const labelled = label.exec(line);
    if (!labelled) continue;
    const value = labelled[1].trim();
    const match = monetary.exec(value) ?? leadingCurrency.exec(value);
    if (!match) continue;
    const isLeading = Boolean(leadingCurrency.exec(value)) && !monetary.exec(value);
    const symbol = isLeading ? '' : (match[1] ?? '');
    const amount = isLeading ? match[2] : match[2];
    let currency = isLeading ? match[1] : (match[3] ?? '');
    if (!currency && symbol === '$') currency = 'USD';
    if (!currency && symbol === '€') currency = 'EUR';
    if (!currency && symbol === '£') currency = 'GBP';
    candidates.push({ amount, currency: currency.toUpperCase() });
  }

  if (!candidates.length) return { amount: '', currency: '' };
  // Different decimal spellings represent the same payment and must not make
  // otherwise identical extracted totals ambiguous.
  const amounts = [...new Set(candidates.map((candidate) => normalizedDecimal(candidate.amount)))];
  const currencies = uniqueNormalized(candidates.map((candidate) => candidate.currency).filter(Boolean));
  if (amounts.length !== 1 || currencies.length > 1) return { amount: '', currency: '' };
  return { amount: candidates[0].amount, currency: currencies[0] ?? '' };
}

export function extractInvoice(text: string): Invoice {
  const source = text ?? '';
  const invoice = { ...EMPTY_INVOICE };

  // "Billed to" identifies the customer, not the payee, and is intentionally never a fallback.
  const payees = labelledValues(/(?:^|\n)\s*(?:payee|vendor|merchant|billed\s+by|from)\s*[:#-]\s*([^\r\n]+)/gi, source);
  invoice.payee = oneUnambiguous(payees);
  invoice.invoiceNumber = oneUnambiguous(labelledValues(/(?:^|\n)\s*(?:invoice\s*(?:number|no\.?|id)|invoice\s*#)\s*[:#-]?\s*([^\r\n]+)/gi, source));

  const parsedAmount = parseAmount(source);
  invoice.amount = parsedAmount.amount;
  invoice.currency = parsedAmount.currency;
  const currencyLabels = labelledValues(/(?:^|\n)\s*currency\s*[:#-]\s*([A-Za-z]{2,6})/gi, source).map((value) => value.toUpperCase());
  const explicitCurrency = oneUnambiguous(currencyLabels);
  if (currencyLabels.length && !explicitCurrency) invoice.currency = '';
  else if (explicitCurrency && invoice.currency && explicitCurrency !== invoice.currency) invoice.currency = '';
  else if (explicitCurrency) invoice.currency = explicitCurrency;

  const destinationValues = labelledValues(/(?:^|\n)\s*(?:destination|account|recipient)\s*[:#-]\s*([^\r\n]+)/gi, source);
  const destinations = destinationValues.filter((value) => validDestination(value));
  // A labelled but malformed destination is not rescued by an account mentioned elsewhere.
  invoice.destination = destinationValues.length === destinations.length ? oneUnambiguous(destinations) : '';
  return invoice;
}

function normalized(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function validDestination(destination: string): boolean {
  const value = destination.trim();
  return TESTNET_DESTINATION.test(value) || IMPLICIT_DESTINATION.test(value);
}

function validDecimal(amount: string): boolean {
  return /^\d+(?:\.\d+)?$/.test(amount) && amount !== '0' && !/^0+(?:\.0+)?$/.test(amount);
}

export function validateInvoice(invoice: Invoice): string[] {
  const errors: string[] = [];
  if (!invoice.payee.trim()) errors.push('Payee is required.');
  if (!invoice.invoiceNumber.trim()) errors.push('Invoice number is required.');
  if (!invoice.amount.trim() || !validDecimal(invoice.amount.trim())) errors.push('Amount must be a positive decimal.');
  else {
    try {
      nearToYocto(invoice.amount.trim());
    } catch (error) {
      errors.push(error instanceof Error && error.message.includes('maximum')
        ? 'Amount exceeds the maximum transferable NEAR value.'
        : 'Amount must have no more than 24 decimal places.');
    }
  }
  if (invoice.currency.trim().toUpperCase() !== 'NEAR') errors.push('Only NEAR payments are supported.');
  if (!validDestination(invoice.destination)) errors.push('Destination must be a valid testnet account.');
  if (/\.near$/i.test(invoice.destination.trim())) errors.push('Mainnet destinations are not allowed.');
  return errors;
}

export function findDuplicate(invoice: Invoice, receipts: Receipt[]): Receipt | undefined {
  const payee = normalized(invoice.payee);
  const number = normalized(invoice.invoiceNumber);
  const destination = normalized(invoice.destination);
  const currency = invoice.currency.trim().toUpperCase();
  let amount: string;
  try { amount = nearToYocto(invoice.amount.trim()); } catch { amount = ''; }
  const validPayment = currency === 'NEAR' && validDestination(invoice.destination) && Boolean(amount);
  return receipts.find((receipt) => {
    const other = receipt.invoice;
    const sameNumber = Boolean(payee && number && normalized(other.payee) === payee && normalized(other.invoiceNumber) === number);
    let otherAmount = '';
    try { otherAmount = nearToYocto(other.amount.trim()); } catch { /* incomplete receipt cannot match a payment */ }
    const samePayment = validPayment && other.currency.trim().toUpperCase() === 'NEAR' && validDestination(other.destination) && Boolean(otherAmount) &&
      Boolean(destination && normalized(other.destination) === destination && otherAmount === amount);
    return sameNumber || samePayment;
  });
}

export function nearToYocto(amount: string): string {
  const value = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Invalid NEAR amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > 24) throw new Error('NEAR amounts support at most 24 decimal places.');
  const yocto = `${whole}${fraction.padEnd(24, '0')}`.replace(/^0+(?=\d)/, '');
  if (/^0+$/.test(yocto)) throw new Error('NEAR amount must be greater than zero.');
  if (yocto.length > MAX_U128_YOCTO.length || (yocto.length === MAX_U128_YOCTO.length && yocto > MAX_U128_YOCTO)) {
    throw new Error('NEAR amount exceeds the maximum transferable u128 value.');
  }
  return yocto;
}

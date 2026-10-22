import { useEffect, useEffectEvent, useId, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, FileCheck2, FileText, Fingerprint, History, LockKeyhole, Menu, Plus, ScanLine, ShieldCheck, Wallet, X } from 'lucide-react';
import { extractInvoice, validateInvoice, findDuplicate, nearToYocto } from './domain';
import type { Invoice, Receipt } from './domain';
import { connectWallet, disconnectWallet, getConnectedAccount, sendTransfer, verifyTransfer } from './near';

const EMPTY: Invoice = { payee: '', amount: '', currency: '', invoiceNumber: '', destination: '' };
const SAMPLE = 'INVOICE\nPayee: Northstar Studio\nInvoice number: NS-2026-042\nDescription: Brand identity · final milestone\nTotal: 0.10 NEAR\n\nSample only. Add your own recipient testnet account before payment.';
const DRAFT_KEY = 'invoice-lens:draft:v1';
const HISTORY_KEY = 'invoice-lens:receipts:v1';
const PENDING_KEY = 'invoice-lens:pending:v1';
type Pending = { invoice: Invoice; signer: string; hash?: string };
function readJSON<T>(key: string, fallback: T, local = false): T {
  try { return JSON.parse((local ? localStorage : sessionStorage).getItem(key) || 'null') ?? fallback; } catch { return fallback; }
}
function persist(key: string, value: unknown, local = false) {
  try { (local ? localStorage : sessionStorage).setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
function removePending() {
  try { sessionStorage.removeItem(PENDING_KEY); return true; } catch { return false; }
}
function isInvoice(value: unknown): value is Invoice {
  return !!value && typeof value === 'object' && Object.keys(EMPTY).every(key => typeof (value as Record<string, unknown>)[key] === 'string');
}
function initialDraft() {
  const d = readJSON<{ text?: string; invoice?: Invoice; extracted?: boolean }>(DRAFT_KEY, {});
  return { text: typeof d.text === 'string' ? d.text : '', invoice: isInvoice(d.invoice) ? d.invoice : EMPTY, extracted: !!d.extracted && isInvoice(d.invoice) };
}
function initialHistory(): Receipt[] {
  const d = readJSON<unknown>(HISTORY_KEY, [], true);
  return Array.isArray(d) ? d.filter((r): r is Receipt => !!r && isInvoice(r.invoice) && typeof r.id === 'string' && typeof r.signer === 'string' && typeof r.transactionHash === 'string' && typeof r.verifiedAt === 'string' && r.network === 'testnet') : [];
}
function initialPending(): Pending | null {
  const p = readJSON<Pending | null>(PENDING_KEY, null);
  return p && isInvoice(p.invoice) && typeof p.signer === 'string' && (!p.hash || typeof p.hash === 'string') ? p : null;
}
const messageOf = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Your payment has not been verified.';
function downloadReceipt(receipt: Receipt) {
  const blob = new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `invoice-lens-${receipt.invoice.invoiceNumber.replace(/[^a-z0-9_-]/gi, '_')}.json`; a.click(); URL.revokeObjectURL(url);
}

function Dialog({ title, children, close }: { title: string; children: React.ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={close} className="dialog"><div className="dialog-head"><span className="eyebrow">INVOICE LENS / REVIEW GATE</span><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20}/></button></div><h2 id={titleId}>{title}</h2>{children}</dialog>;
}

export default function App() {
  const [draft] = useState(initialDraft);
  const [text, setText] = useState(draft.text);
  const [invoice, setInvoice] = useState<Invoice>(draft.invoice);
  const [extracted, setExtracted] = useState(draft.extracted);
  const [history, setHistory] = useState<Receipt[]>(initialHistory);
  const [pending, setPending] = useState<Pending | null>(initialPending);
  const [account, setAccount] = useState<string | null>(null);
  const [view, setView] = useState<'workspace' | 'receipts'>('workspace');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [modal, setModal] = useState<'review' | 'help' | null>(null);
  const [approved, setApproved] = useState(false);
  const [menu, setMenu] = useState(false);
  const [hash, setHash] = useState(() => initialPending()?.hash || '');
  const [latest, setLatest] = useState<Receipt | null>(null);
  const booted = useRef(false);
  const validation = extracted ? validateInvoice(invoice) : [];
  const duplicate = extracted ? findDuplicate(invoice, history) : undefined;
  const issues = duplicate ? [...validation, 'This invoice matches an existing receipt in this browser. Payment is blocked.'] : validation;
  const ready = extracted && issues.length === 0;
  const step = latest ? 4 : ready ? 2 : extracted ? 1 : 0;

  const verifyCallback = useEffectEvent((intent: Pending, txHash: string) => { void completeVerification(intent, txHash); });
  useEffect(() => { persist(DRAFT_KEY, { text, invoice, extracted }); }, [text, invoice, extracted]);
  useEffect(() => {
    if (booted.current) return; booted.current = true;
    void getConnectedAccount().then(setAccount).catch(() => setNotice('Wallet not connected. You can still review an invoice.'));
    const params = new URLSearchParams(window.location.search);
    const callbackHash = params.get('transactionHashes');
    const walletError = params.get('errorCode');
    const saved = initialPending();
    if (walletError) setError('The wallet did not complete signing. No payment is verified. Check your wallet before retrying.');
    if (callbackHash && saved) {
      const hashes = callbackHash.split(',');
      if (hashes.length === 1) {
        const updated = { ...saved, hash: hashes[0] }; setPending(updated); persist(PENDING_KEY, updated); setHash(hashes[0]);
        verifyCallback(updated, hashes[0]);
      } else setError('Unexpected multiple transactions. No receipt was issued.');
    } else if (callbackHash) setError('No matching payment intent is saved in this tab. This transaction cannot be issued a receipt here.');
    if (callbackHash || walletError) {
      for (const key of ['transactionHashes', 'errorCode', 'errorMessage']) params.delete(key);
      window.history.replaceState(null, '', `${location.pathname}${params.size ? '?' + params : ''}${location.hash}`);
    }
  }, []); // Initial callback is processed once, including React Strict Mode.

  async function completeVerification(intent: Pending, txHash: string) {
    setBusy('Verifying final transaction'); setError('');
    try {
      const verified = await verifyTransfer(txHash.trim(), { signer: intent.signer, destination: intent.invoice.destination.trim(), amountYocto: nearToYocto(intent.invoice.amount) });
      const receipt: Receipt = { id: verified.transactionHash, invoice: { ...intent.invoice }, signer: intent.signer, transactionHash: verified.transactionHash, verifiedAt: verified.verifiedAt, network: 'testnet' };
      const updated = [receipt, ...history.filter(r => r.transactionHash !== receipt.transactionHash)];
      const saved = persist(HISTORY_KEY, updated, true);
      setHistory(updated); setLatest(receipt); setPending(null); setHash('');
      const cleared = removePending();
      setNotice(`Final transfer verified against your reviewed payment. ${saved ? 'Receipt saved in this browser.' : 'Browser storage could not save the receipt. Download it now; it will not survive a reload.'}${cleared ? '' : ' The saved intent could not be cleared; re-verify it after reload, do not pay again.'}`); setModal(null);
    } catch (e) { setError(messageOf(e)); } finally { setBusy(''); }
  }
  async function walletAction() {
    setError(''); setBusy(account ? 'Disconnecting wallet' : 'Connecting wallet');
    try { if (account) { await disconnectWallet(); setAccount(null); } else setAccount(await connectWallet()); } catch (e) { setError(messageOf(e)); } finally { setBusy(''); }
  }
  function parse() {
    if (!text.trim()) { setError('Paste your invoice text first, or load the sample.'); return; }
    setBusy('Extracting explicit invoice fields'); setError(''); setNotice(''); setLatest(null);
    window.setTimeout(() => { setInvoice(extractInvoice(text)); setExtracted(true); setBusy(''); }, 180);
  }
  function reset() {
    if (pending) { setError('Resolve or discard the pending payment intent before starting a new invoice.'); return; }
    setText(''); setInvoice(EMPTY); setExtracted(false); setError(''); setNotice(''); setLatest(null); setView('workspace');
  }
  async function sign() {
    if (!account || !ready || !approved || pending || busy) return;
    const intent: Pending = { invoice: { ...invoice, destination: invoice.destination.trim() }, signer: account };
    // Persist before opening the wallet. Never automatically retry an ambiguous submission.
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(intent)); } catch { setError('Browser session storage is unavailable. Enable it before signing so a redirect cannot lose your payment intent.'); setModal(null); return; }
    setPending(intent); setBusy('Awaiting your wallet signature'); setError(''); setModal(null);
    try {
      const txHash = await sendTransfer({ signer: account, destination: intent.invoice.destination, amountYocto: nearToYocto(intent.invoice.amount) });
      if (txHash) { const updated = { ...intent, hash: txHash }; persist(PENDING_KEY, updated); setPending(updated); setHash(txHash); await completeVerification(updated, txHash); }
      else setNotice('Complete the signature in your wallet. A receipt will appear only after final verification.');
    } catch (e) { setError(`${messageOf(e)} No receipt was issued. Check your wallet activity before discarding this intent.`); } finally { setBusy(''); }
  }
  function edit(key: keyof Invoice, value: string) { setInvoice(i => ({ ...i, [key]: value })); setLatest(null); }
  function loadSample() { setText(SAMPLE); setInvoice(EMPTY); setExtracted(false); setLatest(null); setError(''); setNotice('Sample loaded. The recipient is intentionally blank; no destination is invented.'); }
  function openReview() { setApproved(false); setModal('review'); }
  const nav = (target: 'workspace' | 'receipts') => { setView(target); setMenu(false); };

  return <>
    <a className="skip-link" href="#main">Skip to workspace</a>
    <header className="header"><a className="brand" href="#" onClick={e => { e.preventDefault(); nav('workspace'); }} aria-label="Invoice Lens workspace"><img src="/brand-mark.png" alt=""/><span>invoice<span className="brand-light">lens</span><sup> /</sup></span></a><span className="header-divider"/><span className="workspace-label eyebrow">PERSONAL WORKSPACE</span><nav aria-label="Main navigation" className={menu ? 'nav open' : 'nav'}><button className={view === 'workspace' ? 'nav-link active' : 'nav-link'} onClick={() => nav('workspace')}>Workspace</button><button className={view === 'receipts' ? 'nav-link active' : 'nav-link'} onClick={() => nav('receipts')}>Receipts <span className="nav-count">{history.length.toString().padStart(2, '0')}</span></button></nav><div className="header-actions"><span className="network"><i/> TESTNET</span><button className="button wallet-button" onClick={walletAction} disabled={!!busy}><Wallet size={15}/><span>{account || 'Connect wallet'}</span>{!account && <ArrowUpRight size={14}/>}</button><button className="icon-button mobile-menu" aria-label="Toggle navigation" aria-expanded={menu} onClick={() => setMenu(!menu)}><Menu size={20}/></button></div></header>

    <main id="main" className="page">
      <div className="page-topline"><span className="eyebrow">{view === 'workspace' ? 'PAYMENT OPERATIONS / NEW INVOICE' : 'PAYMENT OPERATIONS / LOCAL RECEIPTS'}</span><span className="eyebrow version">INVOICE LENS — V.01</span></div>
      <section className="intro"><div><div className="intro-index eyebrow"><span className="tiny-cross">+</span> CLARITY BEFORE PAYMENT</div><h1>{view === 'workspace' ? <>Every detail.<br/>Before you <span className="underlined">pay.</span></> : <>A record.<br/>Not just a promise.</>}</h1><p>{view === 'workspace' ? 'Turn invoice text into a payment you can inspect.\nReview the details. You make the final call.' : 'Final, matched testnet transfers. Stored only in this browser.'}</p></div><aside className="intro-note"><ShieldCheck size={25} strokeWidth={1.3}/><span className="eyebrow">HUMAN IN THE LOOP</span><p>Nothing moves<br/>without your signature.</p><span className="small-muted">NEAR testnet only. No real funds.</span></aside></section>
      {view === 'workspace' && <ol className="steps" aria-label="Payment progress">{['Import invoice', 'Inspect details', 'Review & sign', 'Verified receipt'].map((label, index) => <li key={label} className={step === index || (index === 3 && latest) ? 'current' : step > index ? 'complete' : ''}><span className="step-number">{step > index || (index === 3 && latest) ? <Check size={13}/> : `0${index + 1}`}</span><span>{label}</span><ChevronRight size={13} className="step-chevron"/></li>)}</ol>}
      <div className="message"><CircleHelp size={15}/><span>Evaluation build: MyNearWallet announces planned deprecation on 31 October 2026. This wallet adapter needs reassessment before any November demo. NEAR testnet only.</span></div>
      <div className="announcements" aria-live="polite">{busy && <div className="message processing"><span className="status-cursor"/>{busy}…</div>}{error && <div className="message error" role="alert"><span className="error-dot"/><span>{error}</span><button aria-label="Dismiss error" className="icon-button" onClick={() => setError('')}><X size={16}/></button></div>}{notice && <div className="message"><Check size={15}/><span>{notice}</span><button aria-label="Dismiss notice" className="icon-button" onClick={() => setNotice('')}><X size={16}/></button></div>}</div>
      {pending && <section className="pending-panel"><div className="section-head"><div><span className="eyebrow">PAYMENT INTENT / UNVERIFIED</span><h3>A signature is not a receipt.</h3></div><span className="badge">PENDING VERIFICATION</span></div><p>{pending.invoice.amount} NEAR → <span className="mono">{pending.invoice.destination}</span>. Check your wallet activity. Do not submit this payment again.</p><label className="field-label" htmlFor="transaction-hash">TRANSACTION HASH</label><div className="pending-actions"><input id="transaction-hash" value={hash} disabled={!!busy} onChange={e => setHash(e.target.value)} placeholder="Paste the transaction hash from your wallet"/><button className="button primary" disabled={!!busy || !hash.trim()} onClick={() => completeVerification(pending, hash)}>Verify transfer <ArrowRight size={15}/></button><button className="text-button" disabled={!!busy} onClick={() => { if (window.confirm('Discard only this local intent? This does not cancel any on-chain transfer. Check your wallet first to avoid paying twice.')) { if (!removePending()) { setError('Browser storage could not clear this intent. Keep it pending and do not pay again.'); return; } setPending(null); setHash(''); setError(''); } }}>Discard local intent</button></div></section>}
      {view === 'workspace' ? <>
        <div className="workbench">
          <section className="source-panel"><div className="section-head"><div className="section-title"><span className="panel-index">01 /</span><h2>Invoice source</h2></div><span className="badge"><FileText size={12}/> TEXT INPUT</span></div><p className="section-description">Paste the invoice. Keep the original in view.</p><div className="input-wrap"><div className="editor-top"><span className="eyebrow">SOURCE.TXT</span><span className="eyebrow">{text.length.toLocaleString()} CHARS</span></div><label className="sr-only" htmlFor="invoice-source">Invoice text</label><textarea id="invoice-source" value={text} maxLength={20000} disabled={!!pending || !!busy} onChange={e => { setText(e.target.value); setExtracted(false); setLatest(null); }} placeholder={'Paste your invoice text here…\n\nPayee: Studio name\nInvoice number: INV-001\nTotal: 0.10 NEAR\nRecipient: your-recipient.testnet'} spellCheck={false}/><div className="editor-bottom"><LockKeyhole size={12}/><span>Parsed locally. No invoice text sent to a server.</span></div></div><div className="source-actions"><button className="button primary" onClick={parse} disabled={!!busy || !!pending || !text.trim()}><ScanLine size={16}/>{extracted ? 'Extract again' : 'Extract details'}<ArrowRight size={16}/></button><button className="text-button" onClick={loadSample} disabled={!!busy || !!pending}>Try a sample <ArrowUpRight size={14}/></button></div><div className="method-note"><span className="eyebrow">PARSER / RULE-BASED</span><p>Reads explicit fields, not between the lines.<br/>Missing details stay blank. This is not AI or OCR.</p></div></section>
          <section className="details-panel"><div className="section-head"><div className="section-title"><span className="panel-index">02 /</span><h2>Payment details</h2></div><span className={ready ? 'badge green' : 'badge'}>{ready ? <Check size={12}/> : <span className="small-dot"/>}{ready ? 'READY TO REVIEW' : extracted ? 'REVIEW REQUIRED' : 'AWAITING INPUT'}</span></div><p className="section-description">Your payment intent. Always editable, never assumed.</p>
            {!extracted ? <div className="empty-details"><div className="scan-motif"><ScanLine size={44} strokeWidth={1}/><span className="scan-node"/></div><h3>The details belong here.</h3><p>Extract an invoice to inspect its amount,<br/>recipient, and anything that needs a second look.</p><span className="eyebrow">NO INVOICE LOADED</span></div> : <div className="fields reveal"><div className="field-row"><label htmlFor="payee">PAYEE<input id="payee" value={invoice.payee} disabled={!!pending || !!busy} onChange={e => edit('payee', e.target.value)} placeholder="Who issued this invoice?"/></label><label htmlFor="invoice-number">INVOICE NUMBER<input id="invoice-number" value={invoice.invoiceNumber} disabled={!!pending || !!busy} onChange={e => edit('invoiceNumber', e.target.value)} placeholder="e.g. INV-001"/></label></div><div className="field-row amount-row"><label htmlFor="amount">AMOUNT<input id="amount" inputMode="decimal" value={invoice.amount} disabled={!!pending || !!busy} onChange={e => edit('amount', e.target.value)} placeholder="0.00"/></label><label htmlFor="currency">CURRENCY<select id="currency" aria-label="CURRENCY" value={invoice.currency} disabled={!!pending || !!busy} onChange={e => edit('currency', e.target.value)}><option value="">Select currency</option>{[...new Set(['NEAR', 'USD', 'EUR', 'GBP', 'NGN', ...(invoice.currency ? [invoice.currency] : [])])].map(c => <option value={c} key={c}>{c}</option>)}</select></label></div><label className="destination-label" htmlFor="destination">RECIPIENT ACCOUNT<input id="destination" className="mono" value={invoice.destination} disabled={!!pending || !!busy} onChange={e => edit('destination', e.target.value)} placeholder="recipient.testnet"/><span className="field-help">Verify this account with your payee outside Invoice Lens.</span></label><div className="network-row"><span className="eyebrow">NETWORK</span><span className="mono"><i className="green-dot"/> NEAR Testnet</span><LockKeyhole size={13}/></div><div className={issues.length ? 'checks' : 'checks all-clear'} role="status"><span className="eyebrow">{issues.length ? `${issues.length.toString().padStart(2, '0')} / NEEDS ATTENTION` : 'REQUIRED FIELDS / COMPLETE'}</span>{issues.length ? <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p><CheckCheck size={16}/> Format checks passed. Recipient ownership is not verified.</p>}</div></div>}
            <div className="review-action"><span><Fingerprint size={16}/> You approve. Your wallet signs.</span><button className="button primary" disabled={!ready || !!busy || !!pending || !!latest} onClick={openReview}>Review payment <ArrowRight size={16}/></button></div>
          </section>
        </div>
        {latest && <section className="verified-panel reveal"><div><span className="badge green"><CheckCheck size={13}/> FINAL TRANSFER VERIFIED</span><h2>{latest.invoice.amount} NEAR. Matched on-chain.</h2><p>Recipient, signer and transfer amount match the reviewed intent.</p><a className="inline-link mono hash-link" href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(latest.transactionHash)}`} target="_blank" rel="noreferrer">{latest.transactionHash}<ArrowUpRight size={14}/></a></div><button className="button" onClick={() => downloadReceipt(latest)}><ArrowDownToLine size={16}/> Download receipt</button></section>}
        <section className="principles"><div><span className="principle-number">[01]</span><h3>Inspect, then act.</h3><p>No hidden destination. No automatic signing.</p></div><div><span className="principle-number">[02]</span><h3>Private by design.</h3><p>Invoice text stays off-chain, in this tab.</p></div><div><span className="principle-number">[03]</span><h3>Proof over promises.</h3><p>A receipt only after a final, matched transfer.</p></div></section>
      </> : <section className="history-section"><div className="section-head"><div className="section-title"><History size={18}/><h2>Verified receipts</h2><span className="badge">{history.length} LOCAL</span></div><button className="button" onClick={reset}><Plus size={15}/> New invoice</button></div><p className="section-description">Receipts include private invoice fields and stay in this browser. Downloads contain those fields too. Local history can be edited or cleared; re-check the explorer when proof matters.</p>{!history.length ? <div className="history-empty"><FileCheck2 size={42} strokeWidth={1}/><h3>No verified receipts. Yet.</h3><p>Review and sign your first testnet invoice.<br/>Only a final, matched transfer earns a place here.</p><button className="button primary" onClick={() => nav('workspace')}>Open workspace <ArrowRight size={16}/></button></div> : <><div className="receipt-list">{history.map(r => <article className="receipt-row" key={r.transactionHash}><FileCheck2 size={22} strokeWidth={1}/><div><h3>{r.invoice.payee}</h3><span className="mono">{r.invoice.invoiceNumber} / {new Date(r.verifiedAt).toLocaleDateString()}</span></div><div className="receipt-amount mono">{r.invoice.amount} NEAR<span className="eyebrow">TESTNET · LOCAL RECEIPT</span></div><a className="icon-button" aria-label={`View transaction for ${r.invoice.invoiceNumber}`} href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(r.transactionHash)}`} target="_blank" rel="noreferrer"><ArrowUpRight size={18}/></a><button className="icon-button" aria-label={`Download receipt ${r.invoice.invoiceNumber}`} onClick={() => downloadReceipt(r)}><ArrowDownToLine size={18}/></button></article>)}</div><button className="text-button clear-history" onClick={() => { if (window.confirm('Clear local receipt history? This does not erase blockchain transactions. Duplicate detection will no longer know about these invoices. Download any receipts you need first.')) { setHistory([]); persist(HISTORY_KEY, [], true); } }}>Clear local history</button></>}</section>}
      <footer><div><span className="footer-logo">IL /</span><span className="eyebrow">LESS GUESSWORK. MORE CERTAINTY.</span></div><div><button className="text-button" onClick={() => setModal('help')}><CircleHelp size={14}/> How it works</button><span className="eyebrow footer-status"><i/> TESTNET WORKSPACE</span></div></footer>
    </main>
    {modal === 'help' && <Dialog title="Clarity, step by step." close={() => setModal(null)}><ol className="help-list"><li><b>Import.</b> Paste invoice text or try the labelled sample. Extraction is local and rule-based, not AI.</li><li><b>Inspect.</b> Correct the fields and confirm the destination with the payee. Missing data and known local duplicates block payment.</li><li><b>Approve.</b> Connect a NEAR testnet wallet, check the exact amount and recipient, then sign inside your wallet. No real-money payments.</li><li><b>Verify.</b> The app checks a final, successful transfer for the exact signer, recipient and amount. Only then is a receipt issued.</li></ol><div className="privacy-note"><LockKeyhole size={17}/><p>Drafts stay in this tab's session storage. Receipts stay in this browser's local storage. Only public account IDs and the native NEAR transfer amount go on-chain. Never share your seed phrase or private key.</p></div><a className="button" href="https://testnet.mynearwallet.com/" target="_blank" rel="noreferrer">Create a testnet wallet <ArrowUpRight size={15}/></a></Dialog>}
    {modal === 'review' && <Dialog title="Your final look." close={() => setModal(null)}><p className="dialog-intro">Check every detail. This requests a real <b>testnet</b> transfer, not a simulation.</p><div className="review-amount"><span className="eyebrow">YOU WILL SEND</span><strong>{invoice.amount}<small> NEAR</small></strong><span className="badge">NEAR TESTNET / NO REAL VALUE</span></div><dl className="review-summary"><div><dt>PAYEE</dt><dd>{invoice.payee}</dd></div><div><dt>INVOICE</dt><dd>{invoice.invoiceNumber}</dd></div><div><dt>RECIPIENT</dt><dd className="mono">{invoice.destination}</dd></div><div><dt>FROM WALLET</dt><dd className="mono">{account || 'Not connected'}</dd></div><div><dt>NETWORK FEE</dt><dd>Additional · shown in your wallet</dd></div></dl><label className="approval"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)}/><span>I checked the recipient with the payee and reviewed the amount and network.</span></label>{!account ? <button className="button primary full" onClick={walletAction} disabled={!!busy}><Wallet size={16}/> Connect testnet wallet <ArrowUpRight size={16}/></button> : <button className="button primary full" onClick={sign} disabled={!approved || !!busy || !ready || !!pending}>Request wallet signature <ArrowUpRight size={16}/></button>}<p className="fine-print">You sign in your wallet. Invoice details stay off-chain. Returning from a wallet does not mean a payment succeeded.</p></Dialog>}
  </>;
}

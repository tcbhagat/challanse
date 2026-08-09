import { FormEvent, useEffect, useState } from 'react';
import type { InvoiceFields } from '@challanse/contracts';
import { emailRegister, emailSignIn, googleSignIn, logout, observeUser, resetPassword } from './auth';
import { acceptTerms, cancelSubscription, confirmInvoice, deleteInvoice, downloadExport, getInvoice, getUsage, listInvoices, openPaidCheckout, uploadInvoice, type Invoice, type Usage } from './api';
import { ImagePrepare } from './ImagePrepare';

const emptyFields: InvoiceFields = { vendor: '', invoiceNumber: '', invoiceDate: '', material: '', quantity: null, unit: null };

export function App() {
  const [user, setUser] = useState<{ email: string; verified: boolean } | null>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [message, setMessage] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [active, setActive] = useState<Invoice | null>(null);
  const [progress, setProgress] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => observeUser((current) => setUser(current ? { email: current.email || '', verified: current.emailVerified } : null)), []);
  useEffect(() => { if (!user?.verified) return; void Promise.all([getUsage(), listInvoices()]).then(([nextUsage, result]) => { setUsage(nextUsage); setInvoices(result.invoices); }).catch((error: Error) => setMessage(error.message)); }, [user]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage('');
    const data = new FormData(event.currentTarget); const email = String(data.get('email')); const password = String(data.get('password'));
    try { if (authMode === 'register') { await emailRegister(email, password); setMessage('Check your email, verify the address, then sign in.'); } else await emailSignIn(email, password); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Sign-in failed.'); }
  }

  async function receiveFile(file: File | undefined) {
    if (!file) return; setMessage(''); setProgress(0);
    try { const invoice = await uploadInvoice(file, setProgress); setInvoices((current) => [invoice, ...current]); setUsage(await getUsage()); setActive(invoice); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Upload failed.'); }
  }

  async function acceptCurrentTerms() {
    if (!usage) return;
    try { await acceptTerms(usage.consentVersion); setUsage(await getUsage()); setMessage('Privacy and retention terms accepted.'); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Terms could not be accepted.'); }
  }

  if (!user) return <main className="auth-shell"><section className="auth-card"><p className="eyebrow">Invoice capture</p><h1>ChallanSe</h1><p>Sign in to scan, upload and confirm an invoice.</p><button className="primary" onClick={() => void googleSignIn()}>Continue with Google</button><div className="divider">or</div><form onSubmit={submitAuth}><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" minLength={12} required autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'} /></label><button className="primary" type="submit">{authMode === 'signin' ? 'Sign in' : 'Create account'}</button></form><button className="link" onClick={() => setAuthMode(authMode === 'signin' ? 'register' : 'signin')}>{authMode === 'signin' ? 'Create an account' : 'Use an existing account'}</button>{authMode === 'signin' && <button className="link" onClick={() => { const email = window.prompt('Enter your verified email'); if (email) void resetPassword(email).then(() => setMessage('Password reset email sent.')).catch(() => setMessage('Password reset could not be sent.')); }}>Forgot password?</button>}<Status text={message} /></section></main>;
  if (!user.verified) return <main className="auth-shell"><section className="auth-card"><h1>Verify your email</h1><p>Open the verification message sent to {user.email}, then sign in again.</p><button className="secondary" onClick={() => void logout()}>Back to sign in</button></section></main>;

  return <main className="app-shell"><header><div><span className="brand">ChallanSe</span><span className="plan">{usage?.plan || 'FREE'}</span></div><button className="link" onClick={() => void logout()}>Sign out</button></header>{pendingFile && <ImagePrepare file={pendingFile} onCancel={() => setPendingFile(null)} onConfirm={(file) => { setPendingFile(null); void receiveFile(file); }} />}{active ? <Confirm invoice={active} onBack={() => setActive(null)} onSaved={(invoice) => { setInvoices((items) => items.map((item) => item.id === invoice.id ? invoice : item)); setActive(invoice); }} /> : <><section className="hero"><p className="eyebrow">Today</p><h1>Add an invoice</h1><p>{usage ? `${usage.usedToday} of ${usage.dailyLimit} used` : 'Loading allowance…'}</p>{usage?.consentRequired ? <section className="terms"><h2>Before your first upload</h2><p>Invoice images and results are private. Free invoices are deleted after 7 days; paid invoices after 90 days. You can delete an invoice sooner.</p><button className="primary" onClick={() => void acceptCurrentTerms()}>I accept and continue</button></section> : <div className="capture-actions"><label className="primary file-button">Scan invoice<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => setPendingFile(event.target.files?.[0] || null)} /></label><label className="secondary file-button">Upload image<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPendingFile(event.target.files?.[0] || null)} /></label></div>}{progress > 0 && progress < 100 && <progress value={progress} max="100" aria-label="Upload progress" />}{usage?.plan === 'FREE' && <button className="link upgrade" onClick={() => void openPaidCheckout().catch((error: Error) => setMessage(error.message))}>Upgrade to 25 invoices daily — ₹499/month</button>}{usage?.plan === 'PAID' && <button className="link" onClick={() => void cancelSubscription().then(() => setMessage('Cancellation scheduled for the billing-period end.')).catch((error: Error) => setMessage(error.message))}>Cancel at period end</button>}<Status text={message} /></section><section className="history"><h2>Recent invoices</h2>{invoices.length === 0 ? <p className="empty">No invoices yet.</p> : invoices.map((invoice) => <article key={invoice.id}><button className="invoice-row" onClick={() => setActive(invoice)}><span><strong>{invoice.fields.vendor || invoice.filename}</strong><small>{invoice.state.replaceAll('_', ' ')}</small></span><span aria-hidden="true">›</span></button><button className="delete" onClick={() => void deleteInvoice(invoice.id).then(() => setInvoices((items) => items.filter((item) => item.id !== invoice.id)))}>Delete</button></article>)}</section></>}</main>;
}

function Confirm({ invoice, onBack, onSaved }: { invoice: Invoice; onBack: () => void; onSaved: (invoice: Invoice) => void }) {
  const [fields, setFields] = useState(invoice.fields || emptyFields); const [message, setMessage] = useState('');
  useEffect(() => {
    if (invoice.state !== 'PROCESSING' && invoice.state !== 'UPLOADING') return;
    const timer = window.setInterval(() => void getInvoice(invoice.id).then((updated) => { if (updated.state !== invoice.state) { setFields(updated.fields); onSaved(updated); } }).catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
  }, [invoice.id, invoice.state, onSaved]);
  if (invoice.state === 'PROCESSING' || invoice.state === 'UPLOADING') return <section className="confirm"><button className="back" onClick={onBack}>← Back</button><p className="eyebrow">Processing</p><h1>Reading invoice</h1><p role="status">Your upload is safe. You can leave this screen and return later.</p></section>;
  async function submit(event: FormEvent) { event.preventDefault(); try { onSaved(await confirmInvoice(invoice.id, { ...fields, version: invoice.version })); setMessage('Invoice completed.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save.'); } }
  const update = (key: keyof InvoiceFields, value: string) => setFields((current) => ({ ...current, [key]: key === 'quantity' ? (value ? Number(value) : null) : value || (key === 'unit' ? null : '') }));
  return <section className="confirm"><button className="back" onClick={onBack}>← Back</button><p className="eyebrow">{invoice.state.replaceAll('_', ' ')}</p><h1>Confirm invoice</h1><form onSubmit={submit}><label>Vendor<input value={fields.vendor} onChange={(event) => update('vendor', event.target.value)} /></label><label>Invoice or challan number<input value={fields.invoiceNumber} onChange={(event) => update('invoiceNumber', event.target.value)} /></label><label>Date<input type="date" value={fields.invoiceDate} onChange={(event) => update('invoiceDate', event.target.value)} /></label><label>Material<input value={fields.material} onChange={(event) => update('material', event.target.value)} /></label><div className="pair"><label>Quantity<input type="number" min="0" step="any" value={fields.quantity ?? ''} onChange={(event) => update('quantity', event.target.value)} /></label><label>Unit<select value={fields.unit ?? ''} onChange={(event) => update('unit', event.target.value)}><option value="">Select</option>{['BAG','KG','TON','NOS','LTR','M3','UNIT'].map((unit) => <option key={unit}>{unit}</option>)}</select></label></div><button className="primary" type="submit">Complete</button></form>{invoice.state === 'COMPLETED' && <div className="exports"><button className="secondary" onClick={() => void downloadExport(invoice.id, 'csv')}>Download CSV</button><button className="secondary" onClick={() => void downloadExport(invoice.id, 'json')}>Download JSON</button></div>}<Status text={message} /></section>;
}
function Status({ text }: { text: string }) { return text ? <p className="status" role="status">{text}</p> : null; }

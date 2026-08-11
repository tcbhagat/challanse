import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InvoiceFields } from '@challanse/contracts';
import { emailRegister, emailSignIn, googleSignIn, logout, observeUser, resetPassword } from './auth';
import { acceptTerms, cancelSubscription, confirmInvoice, deleteInvoice, downloadExport, getInvoice, getUsage, Invoice, listInvoices, openPaidCheckout, uploadInvoice, Usage } from './api';
import { ImagePrepare } from './ImagePrepare';

const emptyFields: InvoiceFields = { vendor: '', invoiceNumber: '', invoiceDate: '', material: '', quantity: null, unit: null };
const units = ['BAG', 'KG', 'TON', 'NOS', 'LTR', 'M3', 'UNIT'] as const;
const sampleFields: InvoiceFields = { vendor: 'Shree Cement Supplies', invoiceNumber: 'SAMPLE-1042', invoiceDate: '2026-08-10', material: 'OPC Cement', quantity: 25, unit: 'BAG' };

type UserState = { email: string; verified: boolean } | null;
type Route =
  | { name: 'entry' | 'auth' | 'demo' | 'capture' | 'history' | 'account' }
  | { name: 'verify' | 'result'; invoiceId: string };

function readRoute(): Route {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const invoiceRoute = path.match(/^\/(verify|result)\/([^/]+)$/);
  if (invoiceRoute) return { name: invoiceRoute[1] as 'verify' | 'result', invoiceId: decodeURIComponent(invoiceRoute[2]) };
  if (path === '/signin') return { name: 'auth' };
  if (path === '/demo') return { name: 'demo' };
  if (path === '/capture') return { name: 'capture' };
  if (path === '/history') return { name: 'history' };
  if (path === '/account') return { name: 'account' };
  return { name: 'entry' };
}

function routePath(route: Route) {
  if (route.name === 'entry') return '/';
  if (route.name === 'auth') return '/signin';
  if (route.name === 'demo') return '/demo';
  if (route.name === 'verify' || route.name === 'result') return `/${route.name}/${encodeURIComponent(route.invoiceId)}`;
  return `/${route.name}`;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<UserState>(null);
  const [authMode, setAuthMode] = useState<'signin' | 'register'>('signin');
  const [message, setMessage] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [progress, setProgress] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const navigate = useCallback((next: Route, replace = false) => {
    window.history[replace ? 'replaceState' : 'pushState']({}, '', routePath(next));
    setRoute(next);
    setMessage('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const stop = observeUser((current) => {
      setUser(current ? { email: current.email || '', verified: current.emailVerified } : null);
      setAuthReady(true);
    });
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => { stop(); window.removeEventListener('popstate', onPopState); };
  }, []);

  const refreshClientData = useCallback(async () => {
    const [nextUsage, result] = await Promise.all([getUsage(), listInvoices()]);
    setUsage(nextUsage);
    setInvoices(result.invoices);
  }, []);

  useEffect(() => {
    if (!user?.verified) return;
    void refreshClientData().catch((error: Error) => setMessage(error.message));
    if (route.name === 'entry' || route.name === 'auth' || route.name === 'demo') navigate({ name: 'capture' }, true);
  }, [navigate, refreshClientData, route.name, user]);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email'));
    const password = String(data.get('password'));
    try {
      if (authMode === 'register') {
        await emailRegister(email, password);
        setMessage('Verification email sent. Open it before signing in.');
      } else {
        await emailSignIn(email, password);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sign-in failed.');
    }
  }

  async function receiveFile(file: File) {
    setMessage('');
    setProgress(0);
    try {
      const invoice = await uploadInvoice(file, setProgress);
      setInvoices((current) => [invoice, ...current.filter((item) => item.id !== invoice.id)]);
      setUsage(await getUsage());
      navigate({ name: 'verify', invoiceId: invoice.id });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Upload failed. Please try again.');
    }
  }

  if (!authReady) return <LoadingScreen />;
  if (!user) {
    if (route.name === 'demo') return <PublicDemo onBack={() => navigate({ name: 'entry' })} onClient={() => navigate({ name: 'auth' })} />;
    if (route.name === 'auth') return <AuthScreen mode={authMode} message={message} onMode={setAuthMode} onSubmit={submitAuth} onGoogle={() => void googleSignIn()} onBack={() => navigate({ name: 'entry' })} onReset={() => { const email = window.prompt('Enter your verified email'); if (email) void resetPassword(email).then(() => setMessage('Password reset email sent.')).catch(() => setMessage('Password reset could not be sent.')); }} />;
    return <EntryScreen onDemo={() => navigate({ name: 'demo' })} onClient={() => navigate({ name: 'auth' })} />;
  }
  if (!user.verified) return <VerifyEmail email={user.email} onBack={() => void logout()} />;

  const activeInvoice = 'invoiceId' in route ? invoices.find((invoice) => invoice.id === route.invoiceId) : undefined;
  return <main className="app-shell">
    <ClientHeader route={route} onNavigate={navigate} onLogout={() => void logout()} />
    {pendingFile && <ImagePrepare file={pendingFile} onCancel={() => setPendingFile(null)} onConfirm={(file) => { setPendingFile(null); void receiveFile(file); }} />}
    {(route.name === 'capture' || route.name === 'verify' || route.name === 'result') && <StepProgress route={route} />}
    {route.name === 'capture' && <CaptureScreen usage={usage} progress={progress} message={message} onFile={setPendingFile} onAcceptTerms={async () => { if (!usage) return; try { await acceptTerms(usage.consentVersion); await refreshClientData(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Terms could not be accepted.'); } }} />}
    {route.name === 'history' && <HistoryScreen invoices={invoices} onOpen={(invoice) => navigate({ name: invoice.state === 'COMPLETED' ? 'result' : 'verify', invoiceId: invoice.id })} onDelete={async (invoice) => { await deleteInvoice(invoice.id); setInvoices((items) => items.filter((item) => item.id !== invoice.id)); }} />}
    {route.name === 'account' && <AccountScreen email={user.email} usage={usage} message={message} onUpgrade={() => void openPaidCheckout().catch((error: Error) => setMessage(error.message))} onCancel={() => void cancelSubscription().then(() => setMessage('Cancellation scheduled for the billing-period end.')).catch((error: Error) => setMessage(error.message))} />}
    {route.name === 'verify' && <InvoiceLoader invoice={activeInvoice} invoiceId={route.invoiceId} onLoaded={(invoice) => setInvoices((items) => [invoice, ...items.filter((item) => item.id !== invoice.id)])}>{(invoice) => <VerifyScreen invoice={invoice} suggestions={invoices} onBack={() => navigate({ name: 'capture' })} onSaved={(saved) => { setInvoices((items) => [saved, ...items.filter((item) => item.id !== saved.id)]); navigate({ name: 'result', invoiceId: saved.id }, true); }} />}</InvoiceLoader>}
    {route.name === 'result' && <InvoiceLoader invoice={activeInvoice} invoiceId={route.invoiceId} onLoaded={(invoice) => setInvoices((items) => [invoice, ...items.filter((item) => item.id !== invoice.id)])}>{(invoice) => <ResultScreen invoice={invoice} onDone={() => navigate({ name: 'capture' })} onDelete={async () => { await deleteInvoice(invoice.id); setInvoices((items) => items.filter((item) => item.id !== invoice.id)); navigate({ name: 'capture' }, true); }} />}</InvoiceLoader>}
  </main>;
}

function EntryScreen({ onDemo, onClient }: { onDemo: () => void; onClient: () => void }) {
  return <main className="entry-shell"><section className="entry-card"><div className="wordmark">ChallanSe</div><h1>Process an invoice</h1><div className="entry-actions"><button className="primary action-button" onClick={onDemo}>Public Demo</button><button className="secondary action-button" onClick={onClient}>Client Sign Up / Sign In</button></div></section></main>;
}

function PublicDemo({ onBack, onClient }: { onBack: () => void; onClient: () => void }) {
  return <main className="entry-shell"><section className="flow-card"><button className="back" onClick={onBack}>← Back</button><StepProgress route={{ name: 'demo' }} demo /><h1>Sample demonstration</h1><ResultFields fields={sampleFields} /><div className="stack-actions"><button className="primary" onClick={onClient}>Client Sign Up / Sign In</button><button className="link" onClick={onBack}>Done</button></div></section></main>;
}

function AuthScreen({ mode, message, onMode, onSubmit, onGoogle, onBack, onReset }: { mode: 'signin' | 'register'; message: string; onMode: (mode: 'signin' | 'register') => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onGoogle: () => void; onBack: () => void; onReset: () => void }) {
  return <main className="entry-shell"><section className="auth-card"><button className="back" onClick={onBack}>← Back</button><h1>{mode === 'signin' ? 'Client sign in' : 'Create client account'}</h1><button className="primary" onClick={onGoogle}>Continue with Google</button><div className="divider">or</div><form onSubmit={onSubmit}><label>Email<input name="email" type="email" required autoComplete="email" /></label><label>Password<input name="password" type="password" minLength={12} required autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label><button className="primary" type="submit">{mode === 'signin' ? 'Sign in' : 'Create account'}</button></form><div className="quiet-actions"><button className="link" onClick={() => onMode(mode === 'signin' ? 'register' : 'signin')}>{mode === 'signin' ? 'Create an account' : 'Use an existing account'}</button>{mode === 'signin' && <button className="link" onClick={onReset}>Forgot password?</button>}</div><Status text={message} /></section></main>;
}

function VerifyEmail({ email, onBack }: { email: string; onBack: () => void }) {
  return <main className="entry-shell"><section className="auth-card"><h1>Verify your email</h1><p>Open the verification email sent to <strong>{email}</strong>.</p><button className="secondary" onClick={onBack}>Back to sign in</button></section></main>;
}

function ClientHeader({ route, onNavigate, onLogout }: { route: Route; onNavigate: (route: Route) => void; onLogout: () => void }) {
  return <header className="client-header"><button className="brand-button" onClick={() => onNavigate({ name: 'capture' })}>ChallanSe</button><nav aria-label="Client navigation"><button aria-current={route.name === 'capture' ? 'page' : undefined} onClick={() => onNavigate({ name: 'capture' })}>New Invoice</button><button aria-current={route.name === 'history' ? 'page' : undefined} onClick={() => onNavigate({ name: 'history' })}>History</button><button aria-current={route.name === 'account' ? 'page' : undefined} onClick={() => onNavigate({ name: 'account' })}>Account</button><button onClick={onLogout}>Sign Out</button></nav></header>;
}

function StepProgress({ route, demo = false }: { route: Route; demo?: boolean }) {
  const current = demo ? 4 : route.name === 'capture' ? 2 : route.name === 'verify' ? 3 : route.name === 'result' ? 4 : 1;
  const labels = ['Access', 'Choose', 'Verify', 'Result'];
  return <ol className="step-progress" aria-label="Invoice progress">{labels.map((label, index) => <li className={index + 1 <= current ? 'active' : ''} aria-current={index + 1 === current ? 'step' : undefined} key={label}><span>{index + 1}</span><small>{label}</small></li>)}</ol>;
}

function CaptureScreen({ usage, progress, message, onFile, onAcceptTerms }: { usage: Usage | null; progress: number; message: string; onFile: (file: File) => void; onAcceptTerms: () => Promise<void> }) {
  return <section className="flow-card capture-screen"><h1>Choose an invoice</h1><p className="allowance">{usage ? `${Math.max(usage.dailyLimit - usage.usedToday, 0)} invoices remaining today` : 'Loading allowance…'}</p><div className="capture-actions"><FileAction label="Scan Invoice" capture onFile={onFile} variant="primary" /><FileAction label="Upload Image" onFile={onFile} variant="secondary" /></div>{progress > 0 && progress < 100 && <div className="upload-progress"><progress value={progress} max="100" aria-label="Upload progress" /><span>{progress}%</span></div>}<Status text={message} />{usage?.consentRequired && <ConsentDialog onAccept={onAcceptTerms} />}</section>;
}

function FileAction({ label, capture = false, onFile, variant }: { label: string; capture?: boolean; onFile: (file: File) => void; variant: 'primary' | 'secondary' }) {
  const input = useRef<HTMLInputElement>(null);
  return <><button className={variant} type="button" onClick={() => input.current?.click()}>{label}</button><input ref={input} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="image/jpeg,image/png,image/webp" capture={capture ? 'environment' : undefined} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile(file); event.currentTarget.value = ''; }} /></>;
}

function ConsentDialog({ onAccept }: { onAccept: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return <div className="modal" role="dialog" aria-modal="true" aria-labelledby="consent-title"><section className="consent-card"><h2 id="consent-title">Before your first upload</h2><p>Your invoice stays private and is deleted according to your account retention period.</p><button className="primary" disabled={busy} onClick={() => { setBusy(true); void onAccept().finally(() => setBusy(false)); }}>{busy ? 'Saving…' : 'I accept and continue'}</button></section></div>;
}

function InvoiceLoader({ invoice, invoiceId, onLoaded, children }: { invoice?: Invoice; invoiceId: string; onLoaded: (invoice: Invoice) => void; children: (invoice: Invoice) => React.ReactNode }) {
  const [error, setError] = useState('');
  useEffect(() => { if (invoice) return; void getInvoice(invoiceId).then(onLoaded).catch((reason: Error) => setError(reason.message)); }, [invoice, invoiceId, onLoaded]);
  if (error) return <section className="flow-card"><h1>Invoice unavailable</h1><Status text={error} /></section>;
  if (!invoice) return <LoadingScreen embedded />;
  return <>{children(invoice)}</>;
}

function VerifyScreen({ invoice, suggestions, onBack, onSaved }: { invoice: Invoice; suggestions: Invoice[]; onBack: () => void; onSaved: (invoice: Invoice) => void }) {
  const [current, setCurrent] = useState(invoice);
  const [fields, setFields] = useState(invoice.fields || emptyFields);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const vendorSuggestions = useMemo(() => [...new Set(suggestions.map((item) => item.fields.vendor).filter(Boolean))], [suggestions]);
  const materialSuggestions = useMemo(() => [...new Set(suggestions.map((item) => item.fields.material).filter(Boolean))], [suggestions]);

  useEffect(() => {
    if (current.state !== 'PROCESSING' && current.state !== 'UPLOADING') return;
    const timer = window.setInterval(() => void getInvoice(current.id).then((updated) => { setCurrent(updated); setFields(updated.fields || emptyFields); }).catch(() => undefined), 2000);
    return () => window.clearInterval(timer);
  }, [current.id, current.state]);

  if (current.state === 'PROCESSING' || current.state === 'UPLOADING') return <section className="flow-card processing-screen"><button className="back" onClick={onBack}>← Back</button><h1>Processing invoice</h1><div className="processing-indicator" aria-hidden="true" /><p role="status">Your invoice will be ready to verify shortly.</p></section>;
  if (current.state === 'COMPLETED') return <ResultScreen invoice={current} onDone={onBack} onDelete={async () => { await deleteInvoice(current.id); onBack(); }} />;

  const update = (key: keyof InvoiceFields, value: string) => setFields((existing) => ({ ...existing, [key]: key === 'quantity' ? (value ? Number(value) : null) : value || (key === 'unit' ? null : '') }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try { onSaved(await confirmInvoice(current.id, { ...fields, version: current.version })); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Invoice could not be verified.'); }
    finally { setBusy(false); }
  }

  return <section className="flow-card verify-screen"><button className="back" onClick={onBack}>← Back</button><h1>Verify details</h1><form onSubmit={submit}><SuggestedField label="Vendor" value={fields.vendor} suggestions={vendorSuggestions} missing={!fields.vendor} onChange={(value) => update('vendor', value)} /><label className={!fields.invoiceNumber ? 'needs-value' : ''}>Invoice or challan number<input required value={fields.invoiceNumber} onChange={(event) => update('invoiceNumber', event.target.value)} /></label><label className={!fields.invoiceDate ? 'needs-value' : ''}>Date<input required type="date" value={fields.invoiceDate} onChange={(event) => update('invoiceDate', event.target.value)} /></label><SuggestedField label="Material" value={fields.material} suggestions={materialSuggestions} missing={!fields.material} onChange={(value) => update('material', value)} /><div className="pair"><label className={fields.quantity === null ? 'needs-value' : ''}>Quantity<input required type="number" min="0" step="any" value={fields.quantity ?? ''} onChange={(event) => update('quantity', event.target.value)} /></label><label className={!fields.unit ? 'needs-value' : ''}>Unit<select required value={fields.unit ?? ''} onChange={(event) => update('unit', event.target.value)}><option value="">Select unit</option>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label></div><button className="primary" disabled={busy} type="submit">{busy ? 'Saving…' : 'Verify Invoice'}</button></form><Status text={message} /></section>;
}

function SuggestedField({ label, value, suggestions, missing, onChange }: { label: string; value: string; suggestions: string[]; missing: boolean; onChange: (value: string) => void }) {
  const id = `${label.toLowerCase()}-suggestions`;
  return <label className={missing ? 'needs-value' : ''}>{label}<input required list={suggestions.length ? id : undefined} value={value} onChange={(event) => onChange(event.target.value)} />{suggestions.length > 0 && <datalist id={id}>{suggestions.map((suggestion) => <option value={suggestion} key={suggestion} />)}</datalist>}</label>;
}

function ResultScreen({ invoice, onDone, onDelete }: { invoice: Invoice; onDone: () => void; onDelete: () => Promise<void> }) {
  const [message, setMessage] = useState('');
  return <section className="flow-card result-screen"><div className="result-heading"><div className="success-mark" aria-hidden="true">✓</div><div><h1>Service result</h1><p>Invoice completed</p></div><details className="more-menu"><summary aria-label="More invoice actions">•••</summary><button onClick={() => void onDelete().catch(() => setMessage('Invoice could not be deleted.'))}>Delete invoice</button></details></div><ResultFields fields={invoice.fields} /><div className="download-actions"><button className="secondary" onClick={() => void downloadExport(invoice.id, 'csv').catch(() => setMessage('CSV could not be downloaded.'))}>Download CSV</button><button className="secondary" onClick={() => void downloadExport(invoice.id, 'json').catch(() => setMessage('JSON could not be downloaded.'))}>Download JSON</button></div><button className="primary" onClick={onDone}>Done</button><Status text={message} /></section>;
}

function ResultFields({ fields }: { fields: InvoiceFields }) {
  return <dl className="result-fields"><div><dt>Vendor</dt><dd>{fields.vendor || 'Not provided'}</dd></div><div><dt>Invoice number</dt><dd>{fields.invoiceNumber || 'Not provided'}</dd></div><div><dt>Date</dt><dd>{fields.invoiceDate || 'Not provided'}</dd></div><div><dt>Material</dt><dd>{fields.material || 'Not provided'}</dd></div><div><dt>Quantity</dt><dd>{fields.quantity ?? 'Not provided'}</dd></div><div><dt>Unit</dt><dd>{fields.unit || 'Not provided'}</dd></div></dl>;
}

function HistoryScreen({ invoices, onOpen, onDelete }: { invoices: Invoice[]; onOpen: (invoice: Invoice) => void; onDelete: (invoice: Invoice) => Promise<void> }) {
  const [message, setMessage] = useState('');
  return <section className="flow-card history-screen"><h1>History</h1>{invoices.length === 0 ? <p className="empty">No invoices yet.</p> : <div className="invoice-list">{invoices.map((invoice) => <article key={invoice.id}><button className="invoice-row" onClick={() => onOpen(invoice)}><span><strong>{invoice.fields.vendor || invoice.filename}</strong><small>{invoice.state.replaceAll('_', ' ')}</small></span><span aria-hidden="true">›</span></button><button className="delete" aria-label={`Delete ${invoice.fields.vendor || invoice.filename}`} onClick={() => void onDelete(invoice).catch(() => setMessage('Invoice could not be deleted.'))}>Delete</button></article>)}</div>}<Status text={message} /></section>;
}

function AccountScreen({ email, usage, message, onUpgrade, onCancel }: { email: string; usage: Usage | null; message: string; onUpgrade: () => void; onCancel: () => void }) {
  return <section className="flow-card account-screen"><h1>Account</h1><dl className="account-details"><div><dt>Email</dt><dd>{email}</dd></div><div><dt>Plan</dt><dd>{usage?.plan || 'Loading…'}</dd></div><div><dt>Daily allowance</dt><dd>{usage ? `${usage.dailyLimit} invoices` : 'Loading…'}</dd></div></dl>{usage?.plan === 'FREE' ? <button className="primary" onClick={onUpgrade}>Upgrade to 25 invoices daily</button> : <button className="secondary" onClick={onCancel}>Cancel at period end</button>}<Status text={message} /></section>;
}

function LoadingScreen({ embedded = false }: { embedded?: boolean }) {
  const content = <section className="loading-card"><div className="processing-indicator" aria-hidden="true" /><p role="status">Loading…</p></section>;
  return embedded ? content : <main className="entry-shell">{content}</main>;
}

function Status({ text }: { text: string }) { return text ? <p className="status" role="status">{text}</p> : null; }

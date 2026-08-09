import { useEffect, useRef, useState } from 'react';
import {
  GuestApiError,
  confirmGuestResult,
  createGuestWorkspace,
  deleteGuestWorkspace,
  getGuestResult,
  guestExportUrl,
  resumeGuestSession,
  uploadGuestInvoice,
  type GuestFields,
  type GuestWorkspace,
} from './guest-api';

type Screen = 'CONSENT' | 'UPLOAD' | 'PROCESSING' | 'CONFIRM' | 'COMPLETED' | 'DELETED' | 'CAPACITY';
const emptyFields: GuestFields = { vendorName: '', challanNumber: '', materialDescription: '', quantity: null, unit: 'UNIT' };
const units = ['BAG', 'KG', 'TON', 'NOS', 'UNIT', 'M3', 'L'];

function messageFor(error: unknown): string {
  if (error instanceof GuestApiError) {
    if (error.code === 'DAILY_CAPACITY_REACHED') return 'Daily processing capacity reached. Please try tomorrow.';
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}

export default function GuestApp() {
  const [workspace, setWorkspace] = useState<GuestWorkspace | null>(null);
  const [screen, setScreen] = useState<Screen>('CONSENT');
  const [accepted, setAccepted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [fields, setFields] = useState<GuestFields>(emptyFields);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState('');
  const timer = useRef<number | null>(null);

  const poll = (activeWorkspace: GuestWorkspace) => {
    if (timer.current) window.clearTimeout(timer.current);
    const check = async () => {
      try {
        const result = await getGuestResult(activeWorkspace.workspaceId);
        if (result.state === 'PROCESSING') timer.current = window.setTimeout(check, 1800);
        else {
          setFields({ ...emptyFields, ...(result.fields ?? {}) });
          setScreen(result.state === 'COMPLETED' ? 'COMPLETED' : 'CONFIRM');
        }
      } catch (error) { setNotice(messageFor(error)); }
    };
    void check();
  };

  useEffect(() => {
    void resumeGuestSession().then(current => {
      if (!current) return;
      setWorkspace(current);
      if (current.state === 'READY') setScreen('UPLOAD');
      else if (current.state === 'PROCESSING') { setScreen('PROCESSING'); poll(current); }
      else if (current.state === 'COMPLETED') setScreen('COMPLETED');
      else { setScreen('CONFIRM'); void getGuestResult(current.workspaceId).then(result => setFields({ ...emptyFields, ...(result.fields ?? {}) })); }
    }).catch(error => setNotice(messageFor(error))).finally(() => setBusy(false));
    return () => { if (timer.current) window.clearTimeout(timer.current); };
  }, []);

  const begin = async () => {
    if (!accepted) return;
    setBusy(true); setNotice('');
    try { const created = await createGuestWorkspace(); setWorkspace(created); setScreen('UPLOAD'); }
    catch (error) { const message = messageFor(error); setNotice(message); if (message.startsWith('Daily processing')) setScreen('CAPACITY'); }
    finally { setBusy(false); }
  };

  const upload = async () => {
    if (!workspace || !file) return;
    setBusy(true); setNotice('');
    try { await uploadGuestInvoice(workspace, file, setProgress); setScreen('PROCESSING'); poll(workspace); }
    catch (error) { const message = messageFor(error); setNotice(message); if (message.startsWith('Daily processing')) setScreen('CAPACITY'); }
    finally { setBusy(false); }
  };

  const confirm = async (event: React.FormEvent) => {
    event.preventDefault(); if (!workspace) return;
    setBusy(true); setNotice('');
    try { await confirmGuestResult(workspace, fields); setScreen('COMPLETED'); }
    catch (error) { setNotice(messageFor(error)); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (!workspace) return;
    setBusy(true); setNotice('');
    try { await deleteGuestWorkspace(workspace); setWorkspace(null); setFile(null); setScreen('DELETED'); }
    catch (error) { setNotice(messageFor(error)); }
    finally { setBusy(false); }
  };

  return <div className="guest-shell">
    <header className="guest-header"><a href="https://challanse.constrovet.com/" className="brand"><span>▦</span> ChallanSe</a><strong>Private invoice workspace</strong></header>
    <main className="guest-main">
      {busy && screen === 'CONSENT' ? <section className="guest-card" aria-live="polite"><h1>Preparing your workspace</h1><p>Please wait.</p></section> : null}
      {!busy && screen === 'CONSENT' ? <section className="guest-card"><p className="guest-step">Step 1 of 3</p><h1>Before you upload</h1><p>Your invoice and result are private and deleted automatically after 24 hours. You can delete them sooner.</p><label className="guest-consent"><input type="checkbox" checked={accepted} onChange={event => setAccepted(event.target.checked)} /> <span>I accept the privacy and 24-hour retention terms.</span></label><button className="button primary guest-primary" disabled={!accepted || busy} onClick={begin}>Continue</button></section> : null}
      {screen === 'UPLOAD' ? <section className="guest-card"><p className="guest-step">Step 2 of 3</p><h1>Upload one invoice</h1><p>JPEG, PNG or WebP. Maximum 5 MB.</p><label className="guest-file"><input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setFile(event.target.files?.[0] ?? null)} /><span>{file ? file.name : 'Choose invoice image'}</span></label>{progress > 0 ? <div className="guest-progress" aria-label={`Upload ${progress}%`}><i style={{ width: `${progress}%` }} /></div> : null}<button className="button primary guest-primary" disabled={!file || busy} onClick={upload}>{busy ? 'Uploading…' : 'Upload invoice'}</button></section> : null}
      {screen === 'PROCESSING' ? <section className="guest-card" aria-live="polite"><div className="guest-spinner" aria-hidden="true" /><h1>Processing</h1><p>Your upload is safe. You can keep this page open while the result is prepared.</p></section> : null}
      {screen === 'CONFIRM' ? <form className="guest-card" onSubmit={confirm}><p className="guest-step">Step 3 of 3</p><h1>Confirm the details</h1><p>Correct any field before completing.</p><div className="guest-form"><label>Vendor<input required maxLength={160} value={fields.vendorName ?? ''} onChange={event => setFields({ ...fields, vendorName: event.target.value })} /></label><label>Invoice or challan number<input required maxLength={80} value={fields.challanNumber ?? ''} onChange={event => setFields({ ...fields, challanNumber: event.target.value })} /></label><label className="wide">Material<input required maxLength={240} value={fields.materialDescription ?? ''} onChange={event => setFields({ ...fields, materialDescription: event.target.value })} /></label><label>Quantity<input required type="number" min="0.001" step="any" value={fields.quantity ?? ''} onChange={event => setFields({ ...fields, quantity: Number(event.target.value) })} /></label><label>Unit<select value={fields.unit ?? 'UNIT'} onChange={event => setFields({ ...fields, unit: event.target.value })}>{units.map(unit => <option key={unit}>{unit}</option>)}</select></label></div><button className="button primary guest-primary" disabled={busy}>Complete</button></form> : null}
      {screen === 'COMPLETED' ? <section className="guest-card"><div className="guest-success" aria-hidden="true">✓</div><h1>Completed</h1><p>Your confirmed result is ready.</p>{workspace ? <div className="guest-actions"><a className="button primary" href={guestExportUrl(workspace.workspaceId, 'csv')}>Download CSV</a><a className="button secondary" href={guestExportUrl(workspace.workspaceId, 'json')}>Download JSON</a><button className="text-button danger" onClick={remove} disabled={busy}>Delete now</button></div> : null}</section> : null}
      {screen === 'CAPACITY' ? <section className="guest-card"><h1>Daily capacity reached</h1><p>Daily processing capacity reached. Please try tomorrow.</p><a className="button secondary" href="https://challanse.constrovet.com/">Try the sample instead</a></section> : null}
      {screen === 'DELETED' ? <section className="guest-card"><div className="guest-success" aria-hidden="true">✓</div><h1>Deleted</h1><p>Your invoice, result and temporary identifiers have been removed.</p><a className="button primary" href="https://challanse.constrovet.com/">Return to ChallanSe</a></section> : null}
      {notice && screen !== 'CAPACITY' ? <p className="guest-notice" role="alert">{notice}</p> : null}
    </main>
    <footer className="guest-footer">Private workspace · Automatically deleted after 24 hours</footer>
  </div>;
}

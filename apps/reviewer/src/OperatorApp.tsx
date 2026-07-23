import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  cancelLocalTestRun,
  createLocalTestRun,
  downloadLocalTestArtifact,
  explainLocalDiagnostic,
  getAdminSummary,
  getLocalStatus,
  getReviewerContext,
  listLocalTestArtifacts,
  listLocalTestRuns,
  logoutReviewer,
  refreshLocalTestData,
  revokeDevice,
  setActiveSiteId,
  type AdminSummary,
  type LocalStatus,
  type LocalTestRun,
} from './api';

type OperatorSection = 'OVERVIEW' | 'TEST' | 'DEVICES' | 'REVIEWER' | 'RECONCILIATION' | 'EVIDENCE' | 'MAINTENANCE';

const navigation: Array<{ id: OperatorSection; label: string; icon: string }> = [
  { id: 'OVERVIEW', label: 'Overview', icon: '⌂' },
  { id: 'TEST', label: 'Test Run', icon: '▶' },
  { id: 'DEVICES', label: 'Devices', icon: '▣' },
  { id: 'REVIEWER', label: 'Reviewer', icon: '◎' },
  { id: 'RECONCILIATION', label: 'Reconciliation', icon: '⇄' },
  { id: 'EVIDENCE', label: 'Evidence', icon: '▤' },
  { id: 'MAINTENANCE', label: 'Maintenance', icon: '◆' },
];

function formatBytes(value: number) {
  if (value < 1_000_000) return `${Math.round(value / 1_000)} KB`;
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
  return `${(value / 1_000_000_000).toFixed(2)} GB`;
}

function formatDate(value: string | null) {
  if (!value) return 'Not completed';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function StatusMark({ ready, pending = false }: { ready: boolean; pending?: boolean }) {
  return <span className={`status-mark ${ready ? 'ready' : pending ? 'pending' : 'blocked'}`} aria-hidden="true">{ready ? '✓' : pending ? '○' : '!'}</span>;
}

function OperatorLoading() {
  return <div className="operator-loading" role="status"><span /><strong>Loading local pilot status…</strong></div>;
}

export default function OperatorApp() {
  const [section, setSection] = useState<OperatorSection>('OVERVIEW');
  const [status, setStatus] = useState<LocalStatus | null>(null);
  const [runs, setRuns] = useState<LocalTestRun[]>([]);
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [activeRun, setActiveRun] = useState<LocalTestRun | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [artifacts, setArtifacts] = useState<Array<{ name: string; bytes: number }>>([]);
  const [diagnostic, setDiagnostic] = useState<{ guidance: string; advisory: string; modelAvailable: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const context = await getReviewerContext();
      const adminSite = context.sites.find((site) => site.role === 'ORG_ADMIN');
      if (!adminSite) {
        setAuthorized(false);
        return;
      }
      setActiveSiteId(adminSite.siteId);
      setAuthorized(true);
      const [nextStatus, nextRuns, nextSummary] = await Promise.all([
        getLocalStatus(),
        listLocalTestRuns(),
        getAdminSummary(),
      ]);
      setStatus(nextStatus);
      setRuns(nextRuns.runs);
      setSummary(nextSummary);
      const running = nextRuns.runs.find((run) => ['QUEUED', 'RUNNING', 'CANCEL_REQUESTED'].includes(run.status));
      setActiveRun((current) => running || (current ? nextRuns.runs.find((run) => run.id === current.id) || current : null));
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Local pilot status could not be loaded.');
      if (caught instanceof ApiError && caught.status === 403) setAuthorized(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const interval = window.setInterval(() => void load(), activeRun ? 2_000 : 15_000);
    return () => window.clearInterval(interval);
  }, [activeRun, load]);

  const startRun = async () => {
    setBusy(true); setMessage(''); setError('');
    try {
      const run = await createLocalTestRun();
      setActiveRun(run);
      setMessage('Synthetic acceptance queued. You can leave this page while it runs.');
      setSection('TEST');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The synthetic test could not start.');
    } finally { setBusy(false); }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    setBusy(true); setMessage(''); setError('');
    try {
      await cancelLocalTestRun(activeRun.id);
      setMessage('Cancellation requested. Temporary acceptance data will still be cleaned safely.');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The test could not be cancelled safely.');
    } finally { setBusy(false); }
  };

  const refreshFixtures = async () => {
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await refreshLocalTestData();
      setMessage(`${result.fixtureCount} deterministic receipt fixtures are ready.`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Test data could not be refreshed.');
    } finally { setBusy(false); }
  };

  const showArtifacts = async (run: LocalTestRun) => {
    setSection('EVIDENCE');
    setActiveRun(run);
    try {
      setArtifacts((await listLocalTestArtifacts(run.id)).artifacts);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Evidence could not be listed.');
    }
  };

  const explain = async (code: string) => {
    setDiagnostic(null); setBusy(true);
    try { setDiagnostic(await explainLocalDiagnostic(code)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Guidance is unavailable.'); }
    finally { setBusy(false); }
  };

  const readiness = useMemo(() => {
    if (!status) return [];
    const latestPassed = status.latestTestRun?.status === 'PASSED';
    return [
      { label: 'Storage', detail: status.storage.uploadsPaused ? 'Uploads paused' : `${status.storage.percent}% used`, ready: !status.storage.uploadsPaused },
      { label: 'Services', detail: status.database === 'ready' && status.objectStore === 'ready' ? 'Running' : 'Attention required', ready: status.database === 'ready' && status.objectStore === 'ready' },
      { label: 'OCR + Local LLM', detail: status.tesseract === 'ready' && status.ollama === 'ready' ? 'Ready' : 'Attention required', ready: status.tesseract === 'ready' && status.ollama === 'ready' },
      { label: 'Test data', detail: status.testData.ready ? 'Ready' : 'Refresh required', ready: status.testData.ready },
      { label: 'Acceptance', detail: latestPassed ? 'Passed' : activeRun ? `${activeRun.progress}%` : 'Pending', ready: latestPassed, pending: Boolean(activeRun) },
      { label: 'Evidence', detail: status.latestTestRun?.evidenceAvailable ? 'Generated' : 'Pending', ready: Boolean(status.latestTestRun?.evidenceAvailable) },
      { label: 'Safe shutdown', detail: status.queueDepth === 0 ? 'Queue drained' : `${status.queueDepth} queued`, ready: status.queueDepth === 0 },
    ];
  }, [activeRun, status]);
  const allReady = readiness.every((item) => item.ready);
  const diagnosticCode = !status ? '' :
    status.storage.uploadsPaused ? 'storage_warning' :
    status.ollama !== 'ready' ? 'ollama_unavailable' :
    status.tesseract !== 'ready' ? 'tesseract_unavailable' :
    status.queueDepth > 0 ? 'queue_stalled' :
    status.certificate.status !== 'ready' ? 'certificate_invalid' : '';

  if (!authorized) {
    return <main className="operator-denied"><h1>Administrator access required</h1><p>The local operator console is restricted to the organization administrator.</p><a className="button primary" href="/">Return to reviewer</a></main>;
  }
  if (authorized === null || !status) return <OperatorLoading />;

  return <div className="operator-shell">
    <aside className="operator-sidebar">
      <a className="operator-brand" href="/operator"><span>C</span><strong>ChallanSe</strong><small>Local Pilot</small></a>
      <nav aria-label="Operator sections">
        {navigation.map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}
      </nav>
      <div className="sidebar-safe"><StatusMark ready={allReady} /><div><strong>{allReady ? 'System ready' : 'Action required'}</strong><span>Synthetic demo</span></div></div>
    </aside>
    <div className="operator-workspace">
      <header className="operator-topbar">
        <div><strong>Local synthetic mode</strong><span>Data and inference remain on this PC</span></div>
        <div className={`operator-state ${allReady ? 'ready' : 'blocked'}`}><StatusMark ready={allReady} /><strong>{allReady ? 'Ready for supervised testing' : 'Readiness checks incomplete'}</strong></div>
        <button className="operator-signout" onClick={() => void logoutReviewer()}>Sign out</button>
      </header>
      <main className="operator-main">
        {message ? <div className="operator-notice success" role="status">{message}</div> : null}
        {error ? <div className="operator-notice error" role="alert">{error}<button onClick={() => void load()}>Retry</button></div> : null}

        {section === 'OVERVIEW' ? <>
          <section className="operator-heading"><div><p>Synthetic demo</p><h1>Demo readiness</h1><span>Complete every local gate before presenting ChallanSe.</span></div><button className="refresh-control" onClick={() => void load()} aria-label="Refresh local status">Refresh</button></section>
          <div className="operator-overview-grid">
            <section className="control-panel readiness-panel" aria-labelledby="readiness-title">
              <header><h2 id="readiness-title">Readiness sequence</h2><span>{readiness.filter((item) => item.ready).length}/{readiness.length} complete</span></header>
              <ol className="readiness-list">{readiness.map((item, index) => <li key={item.label}><span className="step-number">{index + 1}</span><StatusMark ready={item.ready} pending={'pending' in item && Boolean(item.pending)} /><div><strong>{item.label}</strong><small>{item.detail}</small></div></li>)}</ol>
            </section>
            <section className="control-panel health-panel">
              <header><h2>Live system health</h2><span>Real local status</span></header>
              {[
                ['PostgreSQL', status.database],
                ['Object store', status.objectStore],
                ['Tesseract OCR', status.tesseract],
                [status.model, status.ollama],
                ['Audit chain', status.auditChain.valid ? 'ready' : 'unavailable'],
                ['Pilot certificate', status.certificate.status],
              ].map(([label, value]) => <div className="health-row" key={label}><StatusMark ready={value === 'ready'} pending={value === 'warning'} /><strong>{label}</strong><span>{value}</span></div>)}
              <div className="health-row metric"><strong>Queue depth</strong><span>{status.queueDepth}</span></div>
              <div className="health-row metric"><strong>Encrypted storage</strong><span>{status.storage.percent}%</span></div>
            </section>
          </div>
          <section className="primary-test-action">
            <div><h2>Run the complete local test</h2><p>Uploads 50 isolated synthetic receipts, waits for OCR, verifies cleanup, and creates evidence.</p></div>
            <button className="button primary large" onClick={() => void startRun()} disabled={busy || Boolean(activeRun)}>{activeRun ? `${activeRun.stage.replaceAll('_', ' ')} · ${activeRun.progress}%` : 'Run complete synthetic test'}</button>
          </section>
          {diagnosticCode ? <section className="operator-guidance"><div><h2>Safe troubleshooting</h2><p>Deterministic guidance remains authoritative. The local model may explain only this allowlisted health code.</p></div><button className="button secondary" disabled={busy} onClick={() => void explain(diagnosticCode)}>Explain current blocker</button>{diagnostic ? <div className="diagnostic-result"><strong>{diagnostic.guidance}</strong>{diagnostic.advisory ? <p>{diagnostic.advisory}</p> : null}<small>{diagnostic.modelAvailable ? 'Local advisory generated by qwen2.5:7b' : 'Deterministic fallback shown; model unavailable'}</small></div> : null}</section> : null}
        </> : null}

        {section === 'TEST' ? <section className="operator-section">
          <div className="operator-heading"><div><p>Acceptance</p><h1>Complete synthetic test</h1><span>Temporary acceptance data is isolated and removed after every run.</span></div><button className="button secondary" onClick={() => void refreshFixtures()} disabled={busy || Boolean(activeRun)}>Refresh test data</button></div>
          {activeRun ? <div className="run-progress" aria-live="polite"><div><strong>{activeRun.stage.replaceAll('_', ' ')}</strong><span>{activeRun.progress}%</span></div><progress max="100" value={activeRun.progress}>{activeRun.progress}%</progress><p>You may leave this page. Progress is persisted in PostgreSQL.</p><button className="button danger" onClick={() => void cancelRun()} disabled={busy || activeRun.status === 'CANCEL_REQUESTED'}>{activeRun.status === 'CANCEL_REQUESTED' ? 'Cancellation requested' : 'Cancel safely'}</button></div> : <div className="empty operator-empty"><strong>No acceptance run is active.</strong><span>Run the complete test when all health checks are ready.</span><button className="button primary" onClick={() => void startRun()} disabled={busy}>Run complete synthetic test</button></div>}
          <RunHistory runs={runs} onArtifacts={showArtifacts} />
        </section> : null}

        {section === 'DEVICES' ? <section className="operator-section">
          <div className="operator-heading"><div><p>Local devices</p><h1>Enrolled Android devices</h1><span>Enrollment QR creation remains in Site setup on the reviewer screen.</span></div><a className="button primary" href="/?setup=1">Open Site setup</a></div>
          <div className="device-grid">{summary?.devices.length ? summary.devices.map((device) => <article className="operator-device" key={device.id}><div><StatusMark ready={device.active} /><h2>{device.name}</h2></div><dl><dt>App</dt><dd>{device.appVersion}</dd><dt>Last seen</dt><dd>{device.lastSeenAt ? formatDate(device.lastSeenAt) : 'Not yet'}</dd><dt>Status</dt><dd>{device.active ? 'Active' : 'Revoked'}</dd></dl>{device.active ? <button className="button danger" onClick={async () => { await revokeDevice(device.id); await load(); }}>Revoke device</button> : null}</article>) : <div className="empty operator-empty">No devices enrolled.</div>}</div>
        </section> : null}

        {section === 'REVIEWER' ? <OperatorLinkSection title="Reviewer workflow" description="Open the focused inbox to inspect private images, correct OCR fields, and verify or reject receipts." href="/" action="Open reviewer inbox" /> : null}
        {section === 'RECONCILIATION' ? <OperatorLinkSection title="Reconciliation" description="Import synthetic Tally CSV files and inspect verified quantities against purchase orders." href="/?view=DELTA" action="Open Delta view" /> : null}

        {section === 'EVIDENCE' ? <section className="operator-section">
          <div className="operator-heading"><div><p>Local evidence</p><h1>Acceptance artifacts</h1><span>Only successful evidence from the latest 24 hours should support a demonstration.</span></div></div>
          <RunHistory runs={runs} onArtifacts={showArtifacts} />
          {activeRun?.artifactsAvailable ? <div className="artifact-list"><h2>Artifacts for {activeRun.id.slice(0, 8)}</h2>{artifacts.length ? artifacts.map((artifact) => <button key={artifact.name} onClick={() => void downloadLocalTestArtifact(activeRun.id, artifact.name)}><span>{artifact.name}</span><small>{formatBytes(artifact.bytes)}</small></button>) : <p>Select “Evidence” on a passed run to load its files.</p>}</div> : null}
        </section> : null}

        {section === 'MAINTENANCE' ? <section className="operator-section">
          <div className="operator-heading"><div><p>Guarded operations</p><h1>Maintenance</h1><span>Privileged actions remain in the terminal. The browser never receives your storage passphrase.</span></div></div>
          <div className="maintenance-grid">
            <CommandCard title="Safe status" command="./scripts/local-pilot.sh status" />
            <CommandCard title="Safe shutdown" command="./scripts/local-pilot.sh stop && ./scripts/local-pilot.sh storage-close" />
            <CommandCard title="Open after reboot" command="./scripts/local-pilot.sh storage-open && ./scripts/local-pilot.sh start --lan" />
          </div>
          <div className="operator-notice warning">Storage preparation, firewall changes, reset and destroy are intentionally unavailable here.</div>
        </section> : null}
      </main>
      <nav className="operator-bottom-nav" aria-label="Mobile operator navigation">{navigation.filter((item) => ['OVERVIEW', 'TEST', 'DEVICES', 'EVIDENCE', 'MAINTENANCE'].includes(item.id)).map((item) => <button key={item.id} className={section === item.id ? 'active' : ''} onClick={() => setSection(item.id)}><span aria-hidden="true">{item.icon}</span>{item.label === 'MAINTENANCE' ? 'More' : item.label}</button>)}</nav>
    </div>
  </div>;
}

function RunHistory({ runs, onArtifacts }: { runs: LocalTestRun[]; onArtifacts: (run: LocalTestRun) => void }) {
  return <section className="control-panel run-history"><header><h2>Recent synthetic test runs</h2><span>Retained for 30 days</span></header>{runs.length ? <div className="run-table" role="table"><div className="run-table-head" role="row"><span>Started</span><span>Result</span><span>Acceptance</span><span>Evidence</span></div>{runs.map((run) => <div className="run-table-row" role="row" key={run.id}><span>{formatDate(run.startedAt || run.requestedAt)}</span><span className={`run-result ${run.status.toLowerCase()}`}>{run.status}</span><span>{run.report.passed === true ? 'Passed' : run.status === 'FAILED' ? 'Failed' : 'Pending'}</span><button disabled={!run.artifactsAvailable} onClick={() => onArtifacts(run)}>{run.artifactsAvailable ? 'View evidence' : 'Unavailable'}</button></div>)}</div> : <div className="empty operator-empty"><strong>No test runs yet.</strong><span>The first complete synthetic test will appear here.</span></div>}</section>;
}

function OperatorLinkSection({ title, description, href, action }: { title: string; description: string; href: string; action: string }) {
  return <section className="operator-section link-section"><div><p>Focused workspace</p><h1>{title}</h1><span>{description}</span></div><a className="button primary large" href={href}>{action}</a></section>;
}

function CommandCard({ title, command }: { title: string; command: string }) {
  const copy = async () => { await navigator.clipboard.writeText(command); };
  return <article className="command-card"><h2>{title}</h2><code>{command}</code><button className="button secondary" onClick={() => void copy()}>Copy command</button></article>;
}

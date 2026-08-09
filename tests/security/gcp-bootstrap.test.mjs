import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('GCP Terraform separates bootstrap from application resources', async () => {
  const [main, variables] = await Promise.all([read('infra/gcp/main.tf'), read('infra/gcp/variables.tf')]);
  assert.match(main, /backend "gcs"/);
  assert.match(main, /count\s+=\s+var\.bootstrap_only \? 0 : 1/);
  assert.match(main, /precondition[\s\S]*immutable container image digest/);
  assert.match(variables, /variable "bootstrap_only"/);
  assert.match(variables, /variable "billing_enabled"/);
});

test('GCP deployment CLI records immutable images and gates billing secrets', async () => {
  const script = await read('scripts/gcp-live.sh');
  assert.match(script, /bootstrap-state/);
  assert.match(script, /plan-bootstrap/);
  assert.match(script, /@sha256:\[a-f0-9\]\{64\}/);
  assert.match(script, /check_billing_secrets/);
  assert.match(script, /verify_state_bucket/);
  assert.match(script, /require_ci_success/);
  assert.match(script, /Recorded image belongs to a different commit/);
  assert.match(script, /Recorded image belongs to a different GCP project/);
  assert.match(script, /Production deploys only from main/);
  assert.doesNotMatch(script, /-auto-approve/);
});

test('GCP infrastructure preserves task, retention, deletion, backup, and budget controls', async () => {
  const main = await read('infra/gcp/main.tf');
  assert.match(main, /api_tasks_identity[\s\S]*roles\/iam\.serviceAccountUser/);
  assert.match(main, /billing-budget-notifications@system\.gserviceaccount\.com/);
  assert.match(main, /invoice_retention[\s\S]*expiresAt/);
  assert.match(main, /internal\/tasks\/backup/);
  assert.equal((main.match(/versioning \{ enabled = true \}/g) ?? []).length, 1);
  assert.doesNotMatch(main, /num_newer_versions/);
  assert.doesNotMatch(main, /outputUriPrefix\s*=\s*"gs:\/\/\$\{google_storage_bucket\.backups\.name\}\/firestore"/);
});

test('GCP API guards object size, deleted invoices, billing events, and spreadsheet exports', async () => {
  const [cloud, store, api] = await Promise.all([
    read('services/gcp-api/app/cloud.py'),
    read('services/gcp-api/app/store.py'),
    read('services/gcp-api/app/main.py'),
  ]);
  assert.match(cloud, /stored_size != expected_size or stored_size > MAX_UPLOAD_BYTES/);
  assert.match(cloud, /service_account_email/);
  assert.match(store, /UPLOAD_EXPIRED/);
  assert.match(store, /state.*not in \{"PROCESSING", "NEEDS_CORRECTION"\}/);
  assert.match(store, /def apply_billing_event/);
  assert.match(store, /def reserve_checkout/);
  assert.match(store, /def authorize_support_grant/);
  assert.match(api, /spreadsheet_safe/);
});

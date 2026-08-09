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
  assert.match(script, /Production deploys only from main/);
  assert.doesNotMatch(script, /-auto-approve/);
});

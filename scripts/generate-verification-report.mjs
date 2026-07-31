#!/usr/bin/env node
/**
 * generate-verification-report.mjs
 *
 * Generates the repository verification report from the ACTUAL exit codes of a
 * fixed list of validation commands. This script is the single source of truth
 * for the report at plans/verification-report.md (or an alternate --out path).
 *
 * The report is AUTO-GENERATED. It must not be hand-edited; any manual edit is
 * overwritten by the next run.
 *
 * Usage:
 *   node scripts/generate-verification-report.mjs [options]
 *
 * Options:
 *   --commit-sha <sha>   Commit SHA to record (default: `git rev-parse HEAD`)
 *   --tls-status <text>  Domain/TLS status line (default: informational)
 *   --out <path>         Output path, relative to repo root (default: plans/verification-report.md)
 *   --run-url <url>      GitHub run URL (alternative to GITHUB_* env vars)
 *   --help               Show this help
 *
 * Environment:
 *   GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID — used to build the
 *   GitHub run URL when all three are present (unless --run-url is given).
 *   AWS_DEPLOYMENT_FROZEN  — repo-var value; defaults to "true" when unset.
 *   PILOT_DEPLOY_ENABLED   — repo-var value; defaults to "false" when unset.
 *
 * Exit code:
 *   0 — all mandatory checks passed and the report was written.
 *   1 — at least one check failed, or the report could not be written.
 */

import { spawn, execSync } from 'node:child_process';
import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '..');

// Keep at most this many bytes of combined stdout/stderr per command in memory.
const MAX_CAPTURED_BYTES = 64 * 1024;
// Truncate each command's output shown in the report to this many characters.
const REPORT_OUTPUT_LIMIT = 2000;

/**
 * The exact validation sequence. A later CI-restoration subtask runs these
 * commands and records their real exit codes; this generator must always use
 * this list, in this order.
 */
const COMMANDS = [
  { label: 'npm ci', cmd: 'npm', args: ['ci'] },
  { label: 'npm run check', cmd: 'npm', args: ['run', 'check'] },
  { label: 'npm test', cmd: 'npm', args: ['test'] },
  {
    label: 'npm audit --omit=dev --audit-level=high',
    cmd: 'npm',
    args: ['audit', '--omit=dev', '--audit-level=high'],
  },
  { label: 'npm run build', cmd: 'npm', args: ['run', 'build'] },
  { label: 'npm run test:enrichment', cmd: 'npm', args: ['run', 'test:enrichment'] },
  {
    label: 'bash scripts/validate-migrations.sh --check-only',
    cmd: 'bash',
    args: ['scripts/validate-migrations.sh', '--check-only'],
  },
  { label: 'bash scripts/test-edge-integration.sh', cmd: 'bash', args: ['scripts/test-edge-integration.sh'] },
  { label: 'bash scripts/test-production-config.sh', cmd: 'bash', args: ['scripts/test-production-config.sh'] },
  {
    label: 'terraform fmt -check -recursive infra/terraform',
    cmd: 'terraform',
    args: ['fmt', '-check', '-recursive', 'infra/terraform'],
  },
  {
    label: 'terraform -chdir=infra/terraform/staging init -backend=false',
    cmd: 'terraform',
    args: ['-chdir=infra/terraform/staging', 'init', '-backend=false'],
  },
  {
    label: 'terraform -chdir=infra/terraform/staging validate',
    cmd: 'terraform',
    args: ['-chdir=infra/terraform/staging', 'validate'],
  },
  {
    label: 'terraform -chdir=infra/terraform/production init -backend=false',
    cmd: 'terraform',
    args: ['-chdir=infra/terraform/production', 'init', '-backend=false'],
  },
  {
    label: 'terraform -chdir=infra/terraform/production validate',
    cmd: 'terraform',
    args: ['-chdir=infra/terraform/production', 'validate'],
  },
  { label: 'git diff --check', cmd: 'git', args: ['diff', '--check'] },
  { label: 'git status --short', cmd: 'git', args: ['status', '--short'] },
];

/* ─── CLI parsing ─────────────────────────────────────────────────────────── */

function takeValue(argv, i, flag) {
  if (i + 1 >= argv.length || argv[i + 1] === undefined) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[i + 1];
}

function parseArgs(argv) {
  const opts = {
    commitSha: null,
    tlsStatus: null,
    out: 'plans/verification-report.md',
    runUrl: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--commit-sha':
        opts.commitSha = takeValue(argv, i, '--commit-sha');
        i += 1;
        break;
      case '--tls-status':
        opts.tlsStatus = takeValue(argv, i, '--tls-status');
        i += 1;
        break;
      case '--out':
        opts.out = takeValue(argv, i, '--out');
        i += 1;
        break;
      case '--run-url':
        opts.runUrl = takeValue(argv, i, '--run-url');
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return opts;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function run(command, args, cwd = REPO_ROOT) {
  return new Promise((resolvePromise) => {
    let captured = '';
    let child;
    try {
      child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolvePromise({ exitCode: 127, output: `[spawn error] ${err.message}` });
      return;
    }
    const append = (chunk) => {
      captured += chunk.toString();
      if (captured.length > MAX_CAPTURED_BYTES) {
        captured = captured.slice(captured.length - MAX_CAPTURED_BYTES);
      }
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (err) => {
      resolvePromise({ exitCode: 127, output: `${captured}\n[spawn error] ${err.message}`.trim() });
    });
    child.on('close', (code) => {
      resolvePromise({ exitCode: code === null ? 1 : code, output: captured });
    });
  });
}

function truncate(text, limit) {
  // Captured command output can contain trailing whitespace (e.g. wrangler
  // dry-run tables). Strip it so the generated report passes `git diff --check`.
  const sanitized = String(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\r]+$/g, ''))
    .join('\n');
  if (sanitized.length <= limit) return sanitized;
  return `[...${sanitized.length - limit} characters truncated...]\n${sanitized.slice(-limit)}`;
}

function getCommitSha(overridden) {
  if (overridden) return overridden;
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

async function getGitStatus() {
  const res = await run('git', ['status', '--porcelain'], REPO_ROOT);
  const lines = res.output.split('\n').filter((line) => line.trim().length > 0);
  return {
    raw: res.output.trim(),
    count: lines.length,
    state: lines.length === 0 ? 'clean' : `dirty (${lines.length} changed/untracked)`,
  };
}

function buildRunUrl(opts) {
  if (opts.runUrl) return opts.runUrl;
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID } = process.env;
  if (GITHUB_SERVER_URL && GITHUB_REPOSITORY && GITHUB_RUN_ID) {
    return `${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`;
  }
  return 'not available (local run)';
}

function renderReport(ctx) {
  const { commitSha, generatedAt, tree, runUrl, tlsStatus, freeze, checks } = ctx;
  const treeCheck = {
    label: 'working tree is clean at verification start',
    exitCode: tree.count === 0 ? 0 : 1,
    output: tree.count === 0 ? 'clean' : tree.raw,
  };
  const reportedChecks = [treeCheck, ...checks];
  const failed = reportedChecks.filter((check) => check.exitCode !== 0);
  const overall = failed.length === 0 ? 'PASSED' : 'FAILED';

  const freezeRows = [
    `| AWS_DEPLOYMENT_FROZEN | \`${freeze.awsDeploymentFrozen}\`${freeze.awsFromEnv ? ' (from environment)' : ' (default — not set locally)'} |`,
    `| PILOT_DEPLOY_ENABLED | \`${freeze.pilotDeployEnabled}\`${freeze.pilotFromEnv ? ' (from environment)' : ' (default — not set locally)'} |`,
  ].join('\n');

  const tableRows = reportedChecks
    .map(
      (check, index) =>
        `| ${index + 1} | \`${check.label.replaceAll('|', '\\|')}\` | ${check.exitCode} | ${check.exitCode === 0 ? 'PASS' : 'FAIL'} |`
    )
    .join('\n');

  const detailSections = reportedChecks
    .map((check, index) => {
      const status = check.exitCode === 0 ? 'PASS' : 'FAIL';
      const output = truncate(check.output || '(no output)', REPORT_OUTPUT_LIMIT);
      return [
        `### ${index + 1}. \`${check.label}\``,
        '',
        `- Exit code: \`${check.exitCode}\``,
        `- Status: **${status}**`,
        '',
        '```',
        output,
        '```',
        '',
      ].join('\n');
    })
    .join('\n');

  const failureList =
    failed.length === 0
      ? 'none'
      : failed.map((check) => `- \`${check.label}\` (exit code ${check.exitCode})`).join('\n');

  return [
    '# Verification Report',
    '',
    '> **AUTO-GENERATED FILE — do not hand-edit.**',
    '>',
    '> This report is generated by [`scripts/generate-verification-report.mjs`](../scripts/generate-verification-report.mjs)',
    '> from the actual exit codes of the validation commands executed during this generation run.',
    '> Manual edits are overwritten on the next run and must not be treated as evidence.',
    '',
    '## Run metadata',
    '',
    '| Field | Value |',
    '|-------|-------|',
    `| Commit SHA | \`${commitSha}\` |`,
    `| Generated (UTC) | ${generatedAt} |`,
    `| Working tree at generation time | ${tree.state} |`,
    `| GitHub run URL | ${runUrl} |`,
    `| Domain/TLS status | ${tlsStatus} |`,
    freezeRows,
    '',
    '## Overall status',
    '',
    `**${overall}**`,
    '',
    `Failed checks: ${failed.length === 0 ? 'none' : `${failed.length} of ${reportedChecks.length}`}`,
    '',
    '## Checks',
    '',
    '| # | Command | Exit code | Status |',
    '|---|---------|-----------|--------|',
    tableRows,
    '',
    '## Unresolved failures',
    '',
    failureList,
    '',
    '## Command output (truncated)',
    '',
    detailSections,
  ].join('\n');
}

/* ─── Main ────────────────────────────────────────────────────────────────── */

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}`);
    console.error('Run with --help for usage.');
    process.exit(2);
  }
  if (opts.help) {
    console.log(`
generate-verification-report.mjs — generate the verification report from real exit codes

Options:
  --commit-sha <sha>   Commit SHA to record (default: git rev-parse HEAD)
  --tls-status <text>  Domain/TLS status line (default: informational landing text)
  --out <path>         Output path, relative to repo root (default: plans/verification-report.md)
  --run-url <url>      GitHub run URL (alternative to GITHUB_* env vars)
  --help               Show this help
`);
    process.exit(0);
  }

  const commitSha = await getCommitSha(opts.commitSha);
  const generatedAt = new Date().toISOString();
  const tree = await getGitStatus();
  const runUrl = buildRunUrl(opts);
  const tlsStatus =
    opts.tlsStatus || 'not verified — no deployment performed in this run (informational landing only)';

  const awsFrozenRaw = process.env.AWS_DEPLOYMENT_FROZEN;
  const pilotRaw = process.env.PILOT_DEPLOY_ENABLED;
  const freeze = {
    awsDeploymentFrozen: awsFrozenRaw === undefined ? 'true' : awsFrozenRaw,
    awsFromEnv: awsFrozenRaw !== undefined,
    pilotDeployEnabled: pilotRaw === undefined ? 'false' : pilotRaw,
    pilotFromEnv: pilotRaw !== undefined,
  };

  console.log(`Repository root: ${REPO_ROOT}`);
  console.log(`Commit SHA:      ${commitSha}`);
  console.log(`Working tree:    ${tree.state}`);
  console.log(`Output:          ${resolve(REPO_ROOT, opts.out)}`);
  console.log('');

  const checks = [];
  for (let index = 0; index < COMMANDS.length; index += 1) {
    const { label, cmd, args } = COMMANDS[index];
    const result = await run(cmd, args, REPO_ROOT);
    const status = result.exitCode === 0 ? 'PASS' : 'FAIL';
    console.log(`[${index + 1}/${COMMANDS.length}] ${label} → exit ${result.exitCode} (${status})`);
    checks.push({ label, cmd, args, exitCode: result.exitCode, output: result.output });
  }

  const failed = checks.filter((check) => check.exitCode !== 0);
  const overall = failed.length === 0 ? 'PASSED' : 'FAILED';
  console.log('');
  console.log(`Overall status: ${overall} (${checks.length - failed.length}/${checks.length} checks passed)`);
  if (failed.length > 0) {
    for (const check of failed) {
      console.log(`  FAILED: ${check.label} (exit ${check.exitCode})`);
    }
  }

  const report = renderReport({
    opts,
    commitSha,
    generatedAt,
    tree,
    runUrl,
    tlsStatus,
    freeze,
    checks,
  });

  const outPath = resolve(REPO_ROOT, opts.out);
  const tmpPath = `${outPath}.tmp.${process.pid}`;
  try {
    writeFileSync(tmpPath, report, 'utf8');
    renameSync(tmpPath, outPath);
  } catch (err) {
    try {
      rmSync(tmpPath, { force: true });
    } catch {
      /* ignore cleanup failure */
    }
    console.error(`error: could not write report to ${outPath}: ${err.message}`);
    process.exit(1);
  }

  console.log(`Report written to ${outPath}`);
  process.exit(overall === 'PASSED' ? 0 : 1);
}

main().catch((err) => {
  console.error(`error: ${err.stack || err.message}`);
  process.exit(1);
});

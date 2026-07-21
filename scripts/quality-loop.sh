#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="tcbhagat/challanse"
QUALITY_ROOT="/srv/challanse/exports/quality"
STATE_FILE="$QUALITY_ROOT/clean-cycles.json"
MODEL="${QUALITY_MODEL:-qwen2.5:7b}"

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"; }
repo_var() { gh variable get "$1" --repo "$REPO" 2>/dev/null || true; }
require_freeze() {
  [[ "$(repo_var AWS_DEPLOYMENT_FROZEN)" == "true" ]] || die "AWS_DEPLOYMENT_FROZEN must equal true."
  [[ "$(repo_var PILOT_DEPLOY_ENABLED)" == "false" ]] || die "PILOT_DEPLOY_ENABLED must equal false."
}
require_quality_storage() {
  [[ "$(findmnt -n -o SOURCE --target /srv/challanse 2>/dev/null || true)" == "/dev/mapper/challanse-local" ]] \
    || die "Encrypted pilot storage must be open before running the quality loop."
  mkdir -p "$QUALITY_ROOT"
  chmod 700 "$QUALITY_ROOT"
}

run_gate() {
  local name="$1" command="$2" output_dir="$3" started finished status=0
  started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if (cd "$ROOT" && bash -o pipefail -c "$command") >"$output_dir/$name.log" 2>&1; then
    status=0
  else
    status=$?
  fi
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  jq -nc --arg name "$name" --arg started "$started" --arg finished "$finished" --argjson exitCode "$status" \
    '{name:$name,startedAt:$started,finishedAt:$finished,exitCode:$exitCode,passed:($exitCode==0),log:($name+".log")}'
}

observe() {
  require_freeze
  require_quality_storage
  need jq; need git; need npm; need python3; need shellcheck; need docker
  local timestamp output_dir gates_file result_file venv all_passed
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  output_dir="$QUALITY_ROOT/run-$timestamp"
  mkdir -p "$output_dir"
  chmod 700 "$output_dir"
  gates_file="$output_dir/gates.jsonl"
  venv="/tmp/challanse-quality-venv-$timestamp"
  : >"$gates_file"
  {
    if [[ "${QUALITY_ALLOW_DIRTY:-0}" == "1" ]]; then
      run_gate repo-integrity "git diff --check" "$output_dir"
    else
      run_gate repo-integrity "git diff --check && test -z \"\$(git status --porcelain)\"" "$output_dir"
    fi
    run_gate application-tests "python3 -m venv '$venv' && '$venv/bin/pip' install -q -r services/enrichment/requirements-dev.txt -r services/enrichment/requirements-security.txt && PYTHONPATH=services/enrichment '$venv/bin/python' -m pytest -q services/enrichment/tests" "$output_dir"
    run_gate python-security "'$venv/bin/bandit' -q -r services/enrichment/app && '$venv/bin/python' -m pip_audit --requirement services/enrichment/requirements.txt" "$output_dir"
    run_gate node-quality "npm ci && npm run check && npm test && npm run build" "$output_dir"
    run_gate android-tests "npm run check --workspace @challanse/mobile && npm test --workspace @challanse/mobile -- --runInBand" "$output_dir"
    run_gate shell-safety "shellcheck scripts/*.sh && bash scripts/test-production-config.sh && bash scripts/test-local-pilot-storage.sh" "$output_dir"
    run_gate compose-validation "./scripts/local-pilot.sh config-check" "$output_dir"
  } >>"$gates_file"
  if docker ps --filter label=com.docker.compose.project=challanse-local-pilot --format '{{.ID}}' | grep -q .; then
    run_gate runtime-status "./scripts/local-pilot.sh status" "$output_dir" >>"$gates_file"
  fi
  all_passed="$(jq -s 'all(.passed)' "$gates_file")"
  result_file="$output_dir/manifest.json"
  jq -s \
    --arg commit "$(git -C "$ROOT" rev-parse HEAD)" \
    --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg model "$MODEL" \
    --argjson passed "$all_passed" \
    --slurpfile policy "$ROOT/quality/gates.json" \
    '{schemaVersion:"1.0",commitSha:$commit,createdAt:$createdAt,passed:$passed,improvementModel:$model,policy:$policy[0],gates:.}' \
    "$gates_file" >"$result_file"
  sha256sum "$result_file" >"$output_dir/manifest.sha256"
  printf '%s\n' "$result_file"
  [[ "$all_passed" == "true" ]]
}

record_clean_cycle() {
  local manifest="$1" previous=0 current
  if [[ -f "$STATE_FILE" ]]; then previous="$(jq -r '.consecutiveCleanCycles // 0' "$STATE_FILE")"; fi
  if (( previous >= 3 )); then
    printf 'Three consecutive clean quality cycles are already recorded. No autonomous change is required.\n'
    return
  fi
  current=$((previous + 1))
  jq -n --argjson cycles "$current" --arg manifestSha256 "$(sha256sum "$manifest" | awk '{print $1}')" \
    --arg commit "$(git -C "$ROOT" rev-parse HEAD)" --arg verifiedAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    '{consecutiveCleanCycles:$cycles,lastManifestSha256:$manifestSha256,lastCommitSha:$commit,lastVerifiedAt:$verifiedAt}' >"$STATE_FILE"
  chmod 600 "$STATE_FILE"
  printf 'Clean quality cycle %s of 3 recorded.\n' "$current"
}

improve() {
  require_freeze
  require_quality_storage
  need codex; need gh; need ollama
  [[ "$(git -C "$ROOT" branch --show-current)" == "main" ]] || die "Run autonomous improvement from main."
  [[ -z "$(git -C "$ROOT" status --porcelain)" ]] || die "Repository must be clean before autonomous improvement."
  [[ "$(git -C "$ROOT" rev-list --left-right --count origin/main...main)" == $'0\t0' ]] || die "Local main must exactly match origin/main."
  ollama show "$MODEL" >/dev/null 2>&1 || die "Approved local model is unavailable: $MODEL"
  local timestamp branch worktree initial_manifest attempt final_manifest prompt_file
  timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
  branch="automation/quality-$timestamp"
  worktree="/tmp/challanse-quality-$timestamp"
  initial_manifest="$(observe || true)"
  [[ -f "$initial_manifest" ]] || die "Quality observation manifest was not produced."
  if jq -e '.passed == true' "$initial_manifest" >/dev/null; then
    record_clean_cycle "$initial_manifest"
    return
  fi
  git -C "$ROOT" worktree add -b "$branch" "$worktree" main
  prompt_file="$worktree/.quality-improvement-prompt.txt"
  cat >"$prompt_file" <<EOF
Fix the smallest root causes for the failed ChallanSe quality gates listed in $initial_manifest.
You are working only in the isolated worktree $worktree.
Do not deploy, merge, rotate credentials, access secrets, change retention, delete data, run migrations against active data, expose ports, weaken tests, add broad suppressions, or create releases.
Preserve AWS_DEPLOYMENT_FROZEN=true and PILOT_DEPLOY_ENABLED=false.
Add focused regression tests for every fix. Stop if a product, legal, hardware, credential, or client-data decision is required.
EOF
  for attempt in 1 2 3; do
    codex exec --ephemeral --oss --local-provider ollama -m "$MODEL" -s workspace-write -C "$worktree" - <"$prompt_file"
    if (cd "$worktree" && QUALITY_ALLOW_DIRTY=1 bash scripts/quality-loop.sh observe) >"$QUALITY_ROOT/improvement-$timestamp-attempt-$attempt.log" 2>&1; then
      break
    fi
  done
  [[ -n "$(git -C "$worktree" status --porcelain)" ]] || die "Autonomous agent produced no candidate change."
  final_manifest="$(tail -n 1 "$QUALITY_ROOT/improvement-$timestamp-attempt-$attempt.log")"
  [[ -f "$final_manifest" && "$(jq -r '.passed' "$final_manifest")" == "true" ]] || die "Candidate changes did not pass every quality gate; no PR was opened."
  git -C "$worktree" add -A
  git -C "$worktree" commit -m "fix: remediate automated quality findings"
  git -C "$worktree" push -u origin "$branch"
  gh pr create --repo "$REPO" --base main --head "$branch" --title "Automated quality remediation $timestamp" \
    --body "Automated local-Ollama remediation. All configured gates passed. Human review and merge are required. Evidence SHA-256: $(sha256sum "$final_manifest" | awk '{print $1}')"
  printf 'A tested pull request was opened. The loop is paused for human review and merge.\n'
}

usage() {
  cat <<'EOF'
Usage: ./scripts/quality-loop.sh COMMAND

Commands:
  observe   Run all available standards-aligned gates and emit evidence
  improve   Use local Ollama in an isolated worktree and open a tested PR
  run       Observe; record a clean cycle or propose one remediation PR
EOF
}

case "${1:-}" in
  observe) observe ;;
  improve) improve ;;
  run) improve ;;
  *) usage; exit 2 ;;
esac

#!/usr/bin/env bash
set -euo pipefail

readonly OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
readonly OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"

for command_name in curl jq; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'ERROR: Required command not found: %s\n' "$command_name" >&2
    exit 1
  fi
done

response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

http_code="$(curl --silent --show-error \
  --connect-timeout 5 \
  --max-time 120 \
  --output "$response_file" \
  --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data "$(jq -cn --arg model "$OLLAMA_MODEL" '{
    model: $model,
    stream: false,
    messages: [{role: "user", content: "Reply with exactly ROO_LOCAL_OK"}],
    options: {temperature: 0}
  }')" \
  "$OLLAMA_URL/v1/chat/completions")"

if [[ "$http_code" != "200" ]]; then
  printf 'ERROR: Ollama returned HTTP %s.\n' "$http_code" >&2
  exit 1
fi

content="$(jq -er '.choices[0].message.content | select(type == "string" and length > 0)' "$response_file")" || {
  printf 'ERROR: Ollama returned no usable assistant content.\n' >&2
  exit 1
}

if [[ "$content" != *"ROO_LOCAL_OK"* ]]; then
  printf 'ERROR: Unexpected Ollama response.\n' >&2
  exit 1
fi

http_code="$(curl --silent --show-error \
  --connect-timeout 5 \
  --max-time 120 \
  --output "$response_file" \
  --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data "$(jq -cn --arg model "$OLLAMA_MODEL" '{
    model: $model,
    stream: false,
    messages: [{role: "user", content: "Use inspect_file to inspect package.json. Do not answer directly."}],
    tools: [{
      type: "function",
      function: {
        name: "inspect_file",
        description: "Inspect a file",
        parameters: {
          type: "object",
          properties: {path: {type: "string"}},
          required: ["path"]
        }
      }
    }],
    options: {temperature: 0, num_ctx: 16384}
  }')" \
  "$OLLAMA_URL/api/chat")"

if [[ "$http_code" != "200" ]] || ! jq -e '
  .message.tool_calls[0].function.name == "inspect_file" and
  .message.tool_calls[0].function.arguments.path == "package.json"
' "$response_file" >/dev/null; then
  printf 'ERROR: Ollama model does not provide Roo-compatible native tool calls.\n' >&2
  exit 1
fi

printf 'GREEN: Roo local provider is responding.\n'
printf 'GREEN: Roo native tool calling is responding.\n'
printf 'Provider: Ollama\n'
printf 'Base URL: %s\n' "$OLLAMA_URL"
printf 'Model: %s\n' "$OLLAMA_MODEL"

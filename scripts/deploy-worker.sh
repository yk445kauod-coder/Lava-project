#!/usr/bin/env bash
# Deploy the LAVA LLM gateway Worker (workers/lava-gateway) to Cloudflare and
# wire its URL back into .env.
#
# Secrets are uploaded as Worker secret bindings, read from .env, so the upstream
# keys live on the Worker and never in the repository or the browser. The paid
# AgentRouter key and the free-provider keys (Groq, Gemini, Workers AI) are all
# uploaded; a provider with no key is simply skipped by the Worker at runtime.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env"
SCRIPT_NAME="lava-gateway"
SRC="workers/lava-gateway/worker.js"
ENV_FILE_NAME="lava.env"

[[ -f "$ENV_FILE" ]] || { echo "error: $ENV_FILE not found" >&2; exit 1; }
[[ -f "$SRC" ]] || { echo "error: $SRC not found" >&2; exit 1; }

set -a
# shellcheck disable=SC1090
. "./$ENV_FILE"
set +a

: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"
: "${AGENTROUTER_API_KEY:?AGENTROUTER_API_KEY is required}"
: "${LAVA_PROXY_TOKEN:?LAVA_PROXY_TOKEN is required}"

echo "==> Checking token can see the account"
ACCOUNTS="$(curl -s --max-time 60 \
  "https://api.cloudflare.com/client/v4/accounts" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("result") or []))')"

if [[ "$ACCOUNTS" == "0" ]]; then
  echo "error: token sees no accounts, so it cannot deploy. Mint one with" >&2
  echo "       Account -> Workers Scripts -> Edit." >&2
  exit 1
fi

echo "==> Building metadata (secrets as secret_text bindings)"
python3 - "$ENV_FILE_NAME" <<'PY'
import json, os, sys

bindings = [
    {"type": "secret_text", "name": "AGENTROUTER_API_KEY",
     "text": os.environ["AGENTROUTER_API_KEY"]},
    {"type": "secret_text", "name": "LAVA_PROXY_TOKEN",
     "text": os.environ["LAVA_PROXY_TOKEN"]},
]
# Free providers are optional: only upload a binding when the key is present.
for name in ("GROQ_API_KEY", "GEMINI_API_KEY", "CLOUDFLARE_AI_TOKEN"):
    value = os.environ.get(name)
    if value:
        bindings.append({"type": "secret_text", "name": name, "text": value})

metadata = {"main_module": "worker.js", "bindings": bindings}
with open(sys.argv[1], "w") as handle:
    json.dump(metadata, handle)
print("  wrote", sys.argv[1], "with", len(bindings), "bindings")
PY

echo "==> Uploading $SCRIPT_NAME"
RESPONSE="$(curl -s --max-time 180 -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "metadata=@$ENV_FILE_NAME;type=application/json" \
  -F "worker.js=@$SRC;type=application/javascript+module")"
rm -f "$ENV_FILE_NAME"

echo "$RESPONSE" | python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("success"):
    print("error:", d.get("errors"))
    raise SystemExit(1)
print("  deployed:", d["result"]["id"], "at", d["result"]["modified_on"])
' || exit 1

echo "==> Enabling the workers.dev route"
curl -s --max-time 60 -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$SCRIPT_NAME/subdomain" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "content-type: application/json" \
  -d '{"enabled":true,"previews_enabled":false}' >/dev/null

SUBDOMAIN="$(curl -s --max-time 60 \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["subdomain"])')"

URL="https://$SCRIPT_NAME.$SUBDOMAIN.workers.dev"
echo "==> URL: $URL"

python3 - "$URL" <<'PY'
import pathlib, re, sys
url = sys.argv[1]
path = pathlib.Path(".env")
text = path.read_text()
text, count = re.subn(r'^LAVA_AGENTROUTER_PROXY_URL=.*$',
                      f'LAVA_AGENTROUTER_PROXY_URL="{url}"', text, flags=re.M)
if count == 0:
    text = text.rstrip("\n") + f'\nLAVA_AGENTROUTER_PROXY_URL="{url}"\n'
path.write_text(text)
print("  wrote LAVA_AGENTROUTER_PROXY_URL to .env")
PY

echo "==> Verifying /health"
curl -s --max-time 60 "$URL/health" | head -c 300
echo

echo
echo "Done. Verify the whole chain with:  npm run pipeline:doctor"

#!/usr/bin/env bash
# Ask the deployed lava-agent Worker to regenerate the fire-safety insights
# with the SI analysis core.
#
# One model call runs per topic, so this is a maintenance step rather than a
# page request. It reads the Worker URL and the admin token from .env, calls
# POST /admin/insights/refresh, and prints the per-topic report.
#
#   LAVA_WORKER_URL    base URL of the deployed Worker (default: the workers.dev host)
#   LAVA_INSIGHT_TOKEN shared secret bound to the Worker as a secret
set -euo pipefail

cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1090
. "./.env"
set +a

: "${LAVA_INSIGHT_TOKEN:?LAVA_INSIGHT_TOKEN is required (bind it to the Worker with: npx wrangler secret put LAVA_INSIGHT_TOKEN)}"
WORKER_URL="${LAVA_WORKER_URL:-https://lava-agent.yk445kauod.workers.dev}"
MODEL="${1:-}"

BODY="{}"
[[ -n "$MODEL" ]] && BODY="{\"model\":\"$MODEL\"}"

echo "==> Refreshing insights via $WORKER_URL"
curl -s --max-time 600 -X POST "$WORKER_URL/admin/insights/refresh" \
  -H "content-type: application/json" \
  -H "x-lava-admin: $LAVA_INSIGHT_TOKEN" \
  -H "user-agent: Mozilla/5.0" \
  -d "$BODY" \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))'

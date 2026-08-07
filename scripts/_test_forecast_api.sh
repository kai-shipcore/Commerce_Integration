#!/usr/bin/env bash
# Does THIS machine's config actually reach the forecast API?
#
#     bash scripts/_test_forecast_api.sh
#
# Run from the Commerce_Integration repo root, on your Mac.
#
# Tests the same three things the app does, in order, so the first failure tells
# you which one is wrong. Never prints the token.
#
# Env precedence, since it matters here and is documented as having cost an
# afternoon before: Next.js MERGES .env and .env.local per variable, with
# .env.local winning only for keys it defines. A variable set solely in .env is
# still loaded. This script resolves values the same way.

set -uo pipefail

get() {  # get VAR -> value, .env.local winning, quotes stripped
    local var="$1" val=""
    for f in .env .env.local; do
        [ -f "$f" ] || continue
        local line
        line=$(grep -E "^${var}=" "$f" | tail -1) || true
        [ -n "$line" ] && val="${line#*=}"
    done
    val="${val%$'\r'}"          # strip a Windows carriage return FIRST, or the
                                # quote-stripping below misses the closing quote
                                # and the value ends up '...:8000"\r', which curl
                                # cannot use and which prints identically.
    val="${val%\"}"; val="${val#\"}"
    val="${val%\'}"; val="${val#\'}"
    printf '%s' "$val"
}

URL=$(get AI_SERVICE_URL)
TOKEN=$(get FORECAST_API_TOKEN)
SERVERDIR=$(get FORECAST_SERVER_DIR)

echo "AI_SERVICE_URL      = ${URL:-<unset>}"
# Length only. The obvious one-liner for this,
# ${TOKEN:+<${#TOKEN} chars>}${TOKEN:-<unset>}, is WRONG: the two expansions are
# not either/or, so when TOKEN is set the second one prints the secret. It did,
# into a chat transcript, on 2026-08-07. Written as an if so it cannot recur.
if [ -n "$TOKEN" ]; then
    echo "FORECAST_API_TOKEN  = <${#TOKEN} chars, value not shown>"
else
    echo "FORECAST_API_TOKEN  = <unset>"
fi
echo "FORECAST_SERVER_DIR = ${SERVERDIR:-<unset>}"
[ -n "$SERVERDIR" ] && [ ! -d "$SERVERDIR" ] && \
    echo "  WARNING: that directory does not exist on this machine"
echo

if [ -z "$URL" ]; then echo "AI_SERVICE_URL is unset. Nothing to test."; exit 1; fi

echo "=== 1. can this machine reach it at all? (no auth needed) ==="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL/health" 2>/dev/null)
case "$code" in
    200) echo "   200 - reachable" ;;
    000) echo "   NO RESPONSE - network problem, not an app problem."
         echo "   A hang means something is dropping the packet; a fast failure"
         echo "   means refused. Stop here, the app config is not the issue."; exit 1 ;;
    *)   echo "   unexpected $code"; exit 1 ;;
esac

echo
echo "=== 2. is auth enforced? (expect 401 with NO token) ==="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$URL/segmentation" 2>/dev/null)
echo "   $code $([ "$code" = "401" ] && echo '- correct' || echo '- unexpected')"

echo
echo "=== 3. does THIS machine's token work? (expect 200) ==="
if [ -z "$TOKEN" ]; then
    echo "   FORECAST_API_TOKEN is unset here. Every call except /health returns 401."
else
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
           -H "x-forecast-token: $TOKEN" "$URL/segmentation" 2>/dev/null)
    case "$code" in
        200) echo "   200 - the token is accepted. The API is fine from here."
             echo
             echo "   So if the Planning pages still fail, it is the app, not the"
             echo "   connection. The usual cause is that env is read at STARTUP:"
             echo "   stop npm run dev and start it again. An edit to .env while it"
             echo "   is running has no effect and looks exactly like this." ;;
        401) echo "   401 - the token here does not match the server's."
             echo "   Compare lengths without revealing either:"
             echo "     local:  ${#TOKEN} chars"
             echo "     server: ssh coverland@144.24.40.252 'grep -c . /dev/null; awk -F= \"/^FORECAST_API_TOKEN=/{print length(\\\$2)\\\" chars\"}\" /opt/coverland-forecast-api/.env'" ;;
        *)   echo "   $code - unexpected" ;;
    esac
fi

#!/usr/bin/env bash
# The same Mac reached http://144.24.40.252:8000/health minutes ago and now gets
# nothing. Two candidates, and this separates them.
#
#     bash scripts/_why_no_response.sh
#
# A. The URL from .env is not clean. If the file has Windows line endings, the
#    value carries a trailing carriage return, so curl requests
#    "http://144.24.40.252:8000\r/health" and fails. It PRINTS identically,
#    because \r just returns the cursor to the start of the line. This repo has
#    Windows users (setup.cmd exists), so CRLF is live here.
#
# B. The server reverted. We killed an unmanaged uvicorn bound to 127.0.0.1 and
#    let systemd take 0.0.0.0, but never identified what started it. If the
#    Next.js app on the server spawned another one during a restart, the port
#    could be back on loopback and unreachable from outside.
#
# Test 1 uses a hardcoded URL, so it cannot be affected by A.

set -uo pipefail
HARD="http://144.24.40.252:8000"

echo "=== 1. hardcoded URL, no env involved ==="
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "$HARD/health" 2>/dev/null)
if [ "$code" = "200" ]; then
    echo "   200 - the server is fine. The problem is the value from .env -> see test 2."
else
    echo "   $code - the SERVER is unreachable, not the config. Skip to test 3."
fi

echo
echo "=== 2. is the .env value byte-for-byte what it looks like? ==="
for f in .env .env.local; do
    [ -f "$f" ] || continue
    line=$(grep -E "^AI_SERVICE_URL=" "$f" | tail -1) || true
    [ -n "$line" ] || continue
    echo "--- $f"
    printf '   raw bytes: '; printf '%s' "$line" | od -c | head -2
    case "$line" in
        *$'\r') echo "   >>> TRAILING CARRIAGE RETURN. This file has Windows line endings." ;;
        *)      echo "   no trailing CR on this line" ;;
    esac
done
echo
echo "   If any file shows \\r, fix with:"
echo "     perl -pi -e 's/\\r\\n/\\n/g' .env .env.local"
echo "   then restart npm run dev (env is read at startup)."

echo
echo "=== 3. what is the server listening on right now? ==="
ssh coverland@144.24.40.252 '
  echo "unit: $(systemctl is-active coverland-forecast-api)"
  ss -lntp | grep 8000 || echo "  NOTHING on 8000"
  echo "processes:"
  ps -eo pid,lstart,cmd | grep -i "uvicorn\|api.main" | grep -v grep
'

cat <<'EOF'

Reading test 3:
  0.0.0.0:8000 and one process   -> server is correct, look at tests 1 and 2
  127.0.0.1:8000                 -> the squatter is back. Same fix as before:
                                    kill it, systemd rebinds within ~8s. And the
                                    cause is still unidentified (BACKLOG 21), so
                                    it will keep returning until that is found.
  two uvicorn processes          -> a race is in progress right now
EOF

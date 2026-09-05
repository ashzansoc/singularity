#!/usr/bin/env bash
# Finish Singularity beta auth from a Supabase magic-link / redirect URL.
# Usage:
#   ./scripts/complete-beta-auth.sh 'https://singularity-ide.web.app/auth/beta.html#access_token=...&refresh_token=...'
#   ./scripts/complete-beta-auth.sh 'http://localhost:3000/#access_token=...'
set -euo pipefail
URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "Paste the full browser URL from the email link as the first argument." >&2
  exit 1
fi
python3 - "$URL" <<'PY'
import json, sys, time, uuid, pathlib, urllib.request
from urllib.parse import urlparse, parse_qs, unquote

raw = sys.argv[1].strip()
if raw.startswith('localhost'):
    raw = 'http://' + raw
u = urlparse(raw)
fragment = u.fragment or u.query
if not fragment and 'access_token=' in raw:
    fragment = raw.split('access_token=', 1)[1]
    fragment = 'access_token=' + fragment
q = parse_qs(fragment)
access = q.get('access_token', [None])[0]
refresh = q.get('refresh_token', [None])[0]
expires = int(q.get('expires_in', ['3600'])[0])
if not access:
    raise SystemExit('No access_token found in URL')

ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im51d3NjenV3eWV6cG9kdG5vdXFmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzOTExMTYsImV4cCI6MjEwMTk2NzExNn0.xqrEqaV9pfQchO7MDs6E-59wGDDIIqDLs5qVfsGwkQs'
req = urllib.request.Request(
    'https://nuwsczuwyezpodtnouqf.supabase.co/auth/v1/user',
    headers={'Authorization': f'Bearer {access}', 'apikey': ANON},
)
user = json.load(urllib.request.urlopen(req))
home = pathlib.Path.home() / '.singularity'
home.mkdir(exist_ok=True)
device = str(uuid.uuid4())
payload = {
    'email': (user.get('email') or '').lower(),
    'userId': user.get('id'),
    'accessToken': access,
    'refreshToken': refresh,
    'expiresAt': int(time.time() * 1000) + expires * 1000,
    'deviceId': device,
}
(home / 'beta-auth.json').write_text(json.dumps(payload, indent=2))
reg = urllib.request.Request(
    'https://nuwsczuwyezpodtnouqf.supabase.co/functions/v1/llm-proxy/v1/register',
    data=b'{}',
    headers={
        'Authorization': f'Bearer {access}',
        'apikey': ANON,
        'X-Singularity-Device-Id': device,
        'Content-Type': 'application/json',
    },
    method='POST',
)
try:
    urllib.request.urlopen(reg)
except Exception as e:
    print('register warning:', e)
print('Wrote', home / 'beta-auth.json', 'for', payload['email'])
print('Quit and reopen /Applications/Singularity.app')
PY

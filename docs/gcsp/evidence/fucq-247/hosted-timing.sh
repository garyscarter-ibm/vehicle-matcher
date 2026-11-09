#!/bin/sh
# FUCQ-247 run 2: unauthenticated timing of the hosted demo (no key, no cookies), one request at a time, 25 requests in all.
# Usage: hosted-timing.sh <owned scratch dir>; prints one JSON line per request. Base URL from render.gcsp.yaml (GCSP_PUBLIC_ORIGIN).
BASE=https://gcsp-api.onrender.com
OUT="$1"; [ -d "$OUT" ] || { echo "give an owned scratch dir" >&2; exit 2; }
FMT='"code":%{http_code},"dns":%{time_namelookup},"connect":%{time_connect},"tls":%{time_appconnect},"ttfb":%{time_starttransfer},"total":%{time_total},"bytes":%{size_download},"http":"%{http_version}"'
hit() { # label path [accept-encoding]
  H="$OUT/h.txt"; : > "$H"
  if [ -n "$3" ]; then W=$(curl -sS -o /dev/null -D "$H" -H "Accept-Encoding: $3" --max-time 60 -w "$FMT" "$BASE$2" 2>/dev/null)
  else W=$(curl -sS -o /dev/null -D "$H" --max-time 60 -w "$FMT" "$BASE$2" 2>/dev/null); fi
  ENC=$(grep -i '^content-encoding:' "$H" | tail -1 | cut -d' ' -f2- | tr -d '\r'); CC=$(grep -i '^cache-control:' "$H" | tail -1 | cut -d' ' -f2- | tr -d '\r')
  printf '{"label":"%s","path":"%s","ae":"%s",%s,"encoding":"%s","cacheControl":"%s","at":"%s"}\n' "$1" "$2" "$3" "$W" "$ENC" "$CC" "$(date -u +%H:%M:%S)"
  sleep 1
}
for i in 1 2 3 4 5; do hit health /health; done
for i in 1 2; do hit health-evidence /health/vehicle-evidence; done
for i in 1 2 3; do hit access-page '/gcsp/access?next=%2Fgcsp-presenter.html'; done
for i in 1 2; do hit presenter-redirect /gcsp-presenter.html; done
for i in 1 2 3; do hit offer-shell /gcsp-offer.html; done
for i in 1 2; do hit retail-css /blocks/vehicle-matcher/vehicle-matcher.css; done
for i in 1 2; do hit retail-css-gzip /blocks/vehicle-matcher/vehicle-matcher.css 'gzip, br'; done
for i in 1 2; do hit offer-entry-js /blocks/gcsp/offer/entry-harness.js 'gzip, br'; done
for i in 1 2; do hit employee-css /gcsp-employee.css 'gzip, br'; done
rm -f "$OUT/h.txt"

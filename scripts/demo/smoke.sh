#!/bin/sh
set -eu
base=${TV_API_BASE:-http://127.0.0.1:8080/api/v1}
health=${base%/api/v1}/api/health
curl -fsS "$health" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"] == "ok" and d["dependencies"]["mongo"] == "ok"'
rule=$(curl -fsS -X POST "$base/watch-rules" -H 'Content-Type: application/json' --data '{"name":"Temporary smoke rule","status":"paused","scope":"targeted","groups":[{"mode":"any","criteria":[{"kind":"callsign","value":"SMOKE*"}]}],"collection":{"positions":true,"messages":false,"decoderIds":[]}}')
rule_id=$(printf '%s' "$rule" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
curl -fsS -X DELETE "$base/watch-rules/$rule_id" -H 'If-Match: W/"1"' >/dev/null
curl -fsS "$base/sources" | python3 -c 'import json,sys; rows=json.load(sys.stdin); assert rows and all(not x["enabled"] for x in rows)'
curl -fsS "$base/map/snapshot" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["sourceFreshness"] == "unknown" and d["aircraft"] == []'
curl -fsS "$base/flights/fl-smoke-1/track" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["flightId"] == "fl-smoke-1" and d["segments"] == []'
curl -fsS -X POST "$base/decoders/acars-basic/preview" -H 'Content-Type: application/json' --data '{"payload":"Q0 UAL52 MESSAGE: SYNTHETIC TEST","protocol":"acars","bearer":"vhf"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"] == "decoded" and any(x["name"] == "flight_number" for x in d["fields"])'
stream=$(curl -fsS --max-time 2 -N -H 'Last-Event-ID: cursor-999999' "$base/events" 2>/dev/null || true)
printf '%s' "$stream" | python3 -c 'import sys; s=sys.stdin.read(); assert "event: snapshot_required" in s and "cursor_expired" in s'
printf '%s\n' 'Local smoke passed: health, watch-rule persistence, inactive sources, synthetic decoder preview, stale-cursor SSE recovery.'

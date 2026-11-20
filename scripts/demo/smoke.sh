#!/bin/sh
set -eu
base=${TV_API_BASE:-http://127.0.0.1:8080/api/v1}
health=${base%/api/v1}/api/health
rule_id=''
alert_rule_id=''
stream_pid=0
stream_file=$(mktemp)
alert_headers=$(mktemp)
cleanup() {
  if [ -n "$rule_id" ]; then curl -fsS -X DELETE "$base/watch-rules/$rule_id" -H 'If-Match: W/"1"' >/dev/null 2>&1 || true; fi
  if [ -n "$alert_rule_id" ]; then curl -fsS -X DELETE "$base/alert-rules/$alert_rule_id" -H 'If-Match: W/"1"' >/dev/null 2>&1 || true; fi
  if [ "$stream_pid" -gt 0 ]; then kill "$stream_pid" >/dev/null 2>&1 || true; wait "$stream_pid" 2>/dev/null || true; fi
  rm -f "$stream_file"
  rm -f "$alert_headers"
}
trap cleanup EXIT HUP INT TERM
curl -fsS "$health" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"] == "ok" and d["dependencies"]["mongo"] == "ok"'
curl -fsS "$base/sources" | python3 -c 'import json,sys; rows={x["id"]:x for x in json.load(sys.stdin)}; assert rows["synthetic-fixture"]["enabled"] and rows["opensky"]["status"] == "blocked" and rows["airframes-crawler"]["status"] == "blocked" and rows["airframes-api"]["status"] == "not_configured" and all(not x["enabled"] for k,x in rows.items() if k != "synthetic-fixture")'
curl -fsS -N "$base/events" >"$stream_file" 2>/dev/null &
stream_pid=$!
alert_rule=$(curl -fsS -D "$alert_headers" -X POST "$base/alert-rules" -H 'Content-Type: application/json' --data '{"name":"Temporary smoke alert","enabled":true,"condition":"country_entered","cooldownSeconds":30,"includeBackfill":false,"parameters":{"countryCode":"FR"}}')
python3 -c 'import sys; assert any(x.lower().startswith("etag: w/") and x.rstrip().endswith(chr(34)+"1"+chr(34)) for x in open(sys.argv[1]).read().splitlines())' "$alert_headers"
alert_rule_id=$(printf '%s' "$alert_rule" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["condition"] == "country_entered"; print(d["id"])')
rule=$(curl -fsS -X POST "$base/watch-rules" -H 'Content-Type: application/json' --data '{"name":"Temporary smoke rule","status":"active","scope":"targeted","groups":[{"mode":"any","criteria":[{"kind":"callsign","value":"SMOKE*"}]}],"collection":{"positions":true,"messages":true,"decoderIds":["acars-basic"]}}')
rule_id=$(printf '%s' "$rule" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
sleep 11
snapshot=$(curl -fsS "$base/map/snapshot")
printf '%s' "$snapshot" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["aircraft"] and d["sourceFreshness"] in ("fresh","stale")'
flight_id=$(printf '%s' "$snapshot" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["aircraft"][0]["flightId"])')
aircraft_id=$(printf '%s' "$snapshot" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["aircraft"][0]["aircraftId"])')
curl -fsS "$base/flights/$flight_id/track" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["flightId"] and d["segments"] and d["segments"][0][0]["source"] == "synthetic-fixture"'
message=$(curl -fsS "$base/messages?aircraftId=$aircraft_id")
printf '%s' "$message" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["items"] and d["items"][0]["association"]["outcome"] == "matched" and d["items"][0]["decoderResults"] and d["items"][0]["originalText"]'
message_id=$(printf '%s' "$message" | python3 -c 'import json,sys; print(json.load(sys.stdin)["items"][0]["id"])')
curl -fsS "$base/messages/$message_id" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["association"]["outcome"] == "matched" and d["decoderResults"]'
curl -fsS "$base/alert-rules/$alert_rule_id" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["condition"] == "country_entered" and d["enabled"] and d["parameters"]["countryCode"] == "FR"'
alert_event=$(curl -fsS "$base/alert-events?limit=10")
printf '%s' "$alert_event" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert any(x["condition"] == "country_entered" and "FR" in x["evidence"] for x in d["items"])'
alert_event_id=$(printf '%s' "$alert_event" | python3 -c 'import json,sys; print(next(x["id"] for x in json.load(sys.stdin)["items"] if x["condition"] == "country_entered"))')
curl -fsS -X POST "$base/alert-events/$alert_event_id/acknowledge" >/dev/null
curl -fsS "$base/alert-events?limit=10" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert all(x["id"] != sys.argv[1] for x in d["items"])' "$alert_event_id"
kill "$stream_pid" >/dev/null 2>&1 || true
wait "$stream_pid" 2>/dev/null || true
stream_pid=0
python3 -c 'import sys; s=open(sys.argv[1]).read(); assert all(x in s for x in ("event: position_updated", "event: message_observed", "event: message_decoded", "event: alert_triggered", "event: watchlist_changed"))' "$stream_file"
curl -fsS -X POST "$base/decoders/acars-basic/preview" -H 'Content-Type: application/json' --data '{"payload":"Q0 UAL52 MESSAGE: SYNTHETIC TEST","protocol":"acars","bearer":"vhf"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["status"] == "decoded" and any(x["name"] == "flight_number" for x in d["fields"])'
stream=$(curl -fsS --max-time 2 -N -H 'Last-Event-ID: cursor-999999' "$base/events" 2>/dev/null || true)
printf '%s' "$stream" | python3 -c 'import sys; s=sys.stdin.read(); assert "event: snapshot_required" in s and "cursor_expired" in s'
curl -fsS -X DELETE "$base/watch-rules/$rule_id" -H 'If-Match: W/"1"' >/dev/null
rule_id=''
curl -fsS -X DELETE "$base/alert-rules/$alert_rule_id" -H 'If-Match: W/"1"' >/dev/null
alert_rule_id=''
printf '%s\n' 'Local smoke passed: health, active WatchRule acquisition, persisted synthetic position/track, matched decoded message reads, acknowledged alert dismissal after reload, SSE updates, decoder preview, and stale-cursor recovery.'

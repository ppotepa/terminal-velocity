import hashlib
import json
import math
import os
import re
from functools import lru_cache
from datetime import datetime, timezone
from time import time
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from store import (
    corridor_status,
    epoch,
    event,
    ingest,
    matches,
    populate_members,
    positions,
    route,
    segments,
    stamp,
)


def airport(value):
    if isinstance(value, dict):
        value = value.get("icao") or value.get("iata") or value.get("ident")
    return (
        value.upper()
        if isinstance(value, str) and value.isalpha() and 3 <= len(value) <= 4
        else ""
    )


def derive_corridor(db, f):
    if not route(f):
        return
    for segment in segments(positions(db, f)):
        if len(segment) < 3:
            continue
        a, b = segment[0], segment[-1]
        length = 111.195 * math.hypot(
            (a[0] - b[0]) * math.cos(math.radians(a[1])), a[1] - b[1]
        )
        if length < 35:
            continue
        key = f"{f['id']}-segment"
        if db.execute("SELECT 1 FROM corridors WHERE id=?", (key,)).fetchone():
            return
        points = positions(db, f)
        for c in db.execute(
            "SELECT * FROM corridors WHERE mode=? AND origin=? AND destination=?",
            (f["mode"], f["origin"], f["destination"]),
        ):
            if corridor_status(points, c) == "passage":
                return
        candidate = dict(line=json.dumps([a, b]), width=16)
        if corridor_status(points, candidate) == "passage":
            db.execute(
                "INSERT INTO corridors VALUES (?,?,?,?,?,?)",
                (key, f["mode"], f["origin"], f["destination"], candidate["line"], 16),
            )
            populate_members(
                db, db.execute("SELECT * FROM corridors WHERE id=?", (key,)).fetchone()
            )
            return


def accept(db, f, msg):
    ac = f["aircraft"].lower()
    if (
        ac not in [str(msg.get(k)).lower() for k in ("fromHex", "toHex")]
        or msg.get("error")
        or not msg.get("id")
    ):
        return None
    at = epoch(msg["timestamp"])
    if not f["start"] <= at <= f["last"]:
        return None
    flight = msg.get("flight") or {}
    calls = {
        str(x).strip().upper()
        for x in (
            flight.get("flightIcao"),
            msg.get("flightNumber"),
            flight.get("flight"),
        )
        if x
    }
    nearby = db.execute(
        "SELECT 1 FROM events WHERE flight=? AND source='ADS-B' AND at BETWEEN ? AND ? LIMIT 1",
        (f["id"], at - 360, at + 360),
    ).fetchone()
    confirmed = bool(nearby) and (not calls or f["callsign"] in calls)
    text = msg.get("text")
    raw = {
        k: msg[k]
        for k in (
            "id",
            "fromHex",
            "toHex",
            "label",
            "blockId",
            "messageNumber",
            "flightNumber",
            "text",
            "data",
            "sourceType",
        )
        if msg.get(k) != None
    }
    key = f"{f['id']}/airframes/{msg['id']}"
    if msg.get("arUUID"):
        # Require identical frame fields in addition to provider correlation.
        identity = [
            msg["arUUID"],
            raw.get("fromHex"),
            raw.get("toHex"),
            raw.get("label"),
            raw.get("text"),
            raw.get("data"),
        ]
        key = (
            f["id"]
            + "/"
            + hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
        )
    if confirmed:
        origin = airport(msg.get("departingAirport") or flight.get("departingAirport"))
        dest = airport(
            msg.get("destinationAirport") or flight.get("destinationAirport")
        )
        db.execute(
            "UPDATE flights SET origin=coalesce(nullif(?,''),origin),destination=coalesce(nullif(?,''),destination) WHERE id=?",
            (origin, dest, f["id"]),
        )
        f = db.execute("SELECT * FROM flights WHERE id=?", (f["id"],)).fetchone()
        derive_corridor(db, f)
    event(
        db,
        f,
        key,
        at,
        "Airframes",
        dict(raw=raw, decoded=text, protocol=msg.get("sourceType") or "Airframes"),
        confirmed,
    )
    station = msg.get("station") or {}
    if station.get("ident") or station.get("id"):
        db.execute(
            "INSERT OR IGNORE INTO receipts VALUES (?,?,?)",
            (key, str(station.get("ident") or station["id"]), at),
        )
    return "ready" if confirmed else "uncertain"


def needs_frames(db, flight, rule):
    if matches(db, flight, rule):
        return "Airframes" in json.loads(rule["sources"])
    if rule["kind"] != "route" or route(flight):
        return False
    origin, destination = rule["target"].split("/")
    # Prior flights and observed corridor contact select candidates for lookup.
    # Only airport evidence can match the rule and attach an event.
    return bool(
        db.execute(
            """
        SELECT 1 FROM flights WHERE mode='live' AND callsign=? AND callsign!=''
          AND origin=? AND destination=?
        UNION ALL
        SELECT 1 FROM corridor_members m JOIN corridors c ON c.id=m.corridor
          WHERE m.flight=? AND m.status!='' AND c.origin=? AND c.destination=?
        LIMIT 1
        """,
            (
                flight["callsign"],
                origin,
                destination,
                flight["id"],
                origin,
                destination,
            ),
        ).fetchone()
    )


def due(db, now):
    rules = list(
        db.execute(
            "SELECT * FROM rules WHERE mode='live' AND active AND (sources LIKE '%Airframes%' OR kind='route')"
        )
    )
    for f in db.execute(
        "SELECT * FROM flights WHERE mode='live' AND checked<? AND (last>? OR preview>?) ORDER BY checked",
        (now - 30, now - 300, now),
    ):
        if f["preview"] > now or any(needs_frames(db, f, r) for r in rules):
            return f


# Limit only the extra discovery traffic; saved listeners keep their cadence.
PUBLIC_DISCOVERY_CALLS_PER_DAY = 200
DISCOVERY_RECHECK_SECONDS = 30 * 60


def reserve_discovery_request(db, now, limit=PUBLIC_DISCOVERY_CALLS_PER_DAY):
    day = datetime.fromtimestamp(now, timezone.utc).date().isoformat()
    db.execute("INSERT OR IGNORE INTO discovery_budget (day,requests) VALUES (?,0)", (day,))
    return bool(db.execute(
        "UPDATE discovery_budget SET requests=requests+1 WHERE day=? AND requests<?",
        (day, limit),
    ).rowcount)


def discovery_due(db, now):
    snap = db.execute("SELECT at,ids FROM snapshots WHERE mode='live'").fetchone()
    if not snap or now - snap["at"] > 180:
        return None
    candidates = []
    for fid in json.loads(snap["ids"]):
        row = db.execute("SELECT * FROM flights WHERE id=? AND mode='live'", (fid,)).fetchone()
        if (row and re.fullmatch(r"[0-9a-f]{6}", row["aircraft"], re.IGNORECASE)
                and row["last"] > now - 300 and row["checked"] < now - DISCOVERY_RECHECK_SECONDS):
            candidates.append(row)
    return min(candidates, key=lambda f: f["checked"], default=None)


def provider_json(path):
    req = Request(
        "https://api.airframes.io/v1/" + path,
        headers={
            "Accept": "application/json",
            "User-Agent": "Terminal-Velocity/1.0 (aircraft observation client)",
        },
    )
    if os.getenv("TV_AIRFRAMES_API_KEY"):
        req.add_header("Authorization", "Bearer " + os.environ["TV_AIRFRAMES_API_KEY"])
    with urlopen(req, timeout=8) as response:
        return json.load(response)


@lru_cache(maxsize=256)
def airline_iata(icao):
    row = provider_json("airlines/icao/" + icao)
    if isinstance(row, dict) and row.get("icao") == icao:
        return (row.get("iata") or "").rstrip("*")
    return ""


def fetch_frames(db, f):
    page = db.execute("SELECT * FROM frame_pages WHERE flight=?", (f["id"],)).fetchone()
    before = page["before_id"] if page else None
    since = (
        page["since"]
        if before
        else max(f["start"], page["until"] - 300)
        if page
        else f["start"]
    )
    until = page["until"] if before else min(time(), f["last"] + 60)
    since = max(f["start"], min(since, until - 300)) if not before else since
    params = dict(icao=f["aircraft"], since=stamp(since), until=stamp(until), limit=100)
    if before:
        params["before_id"] = before
    query = urlencode(params)
    frames = provider_json("messages?" + query)
    if not isinstance(frames, list):
        raise ValueError("Invalid Airframes response")
    call = f["callsign"]
    if len(call) > 3 and call[:3].isascii() and call[:3].isalpha():
        for msg in frames:
            flight = msg.get("flight") or {}
            iata = flight.get("flightIata") or ""
            if not flight.get("flightIcao") and iata[2:] == call[3:]:
                try:
                    if airline_iata(call[:3]) == iata[:2]:
                        flight["flightIcao"] = call
                except (OSError, ValueError):
                    pass
    cursor = min(m["id"] for m in frames) if len(frames) == 100 else None
    if before and cursor and cursor >= before:
        raise ValueError("Airframes cursor did not advance")
    db.execute(
        "INSERT OR REPLACE INTO frame_pages VALUES (?,?,?,?)",
        (f["id"], since, until, cursor),
    )
    return frames


def debug(db):
    if db.execute("SELECT 1 FROM snapshots WHERE mode='debug'").fetchone():
        return
    # Anchored times and IDs survive refresh and restart.
    base = datetime(2025, 1, 2, 12, tzinfo=timezone.utc).timestamp()
    for day in (0, 1):
        for i in range(7):
            at = base + 86400 * day + i * 60
            rows = []
            for j, (ac, call) in enumerate([("demo01", "TV201"), ("demo02", "TV315")]):
                p = dict(
                    latitude=52 + j * 0.45,
                    longitude=18 + i * 0.3 + j * 0.2,
                    observedAt=stamp(at),
                    source="ADS-B",
                    altitudeMeters=dict(value=8100 + i * 20, certainty="observed"),
                    groundSpeedMps=dict(value=215, certainty="observed"),
                    headingDegrees=dict(value=90, certainty="observed"),
                )
                rows.append(
                    dict(
                        aircraftId=ac,
                        callsign=dict(value=call, certainty="observed"),
                        position=p,
                        flightId=None,
                    )
                )
            ingest(db, "debug", dict(generatedAt=stamp(at), aircraft=rows))
    db.execute(
        "UPDATE flights SET origin='EPPO',destination='EPWA' WHERE mode='debug' AND aircraft='demo01'"
    )
    for f in list(
        db.execute(
            "SELECT * FROM flights WHERE mode='debug' AND aircraft='demo01' ORDER BY last"
        )
    ):
        derive_corridor(db, f)
        key = f["id"] + "/demo-frame"
        event(
            db,
            f,
            key,
            f["last"],
            "Airframes",
            dict(
                raw="TV201 / POS REPORT 52.0N 019.8E",
                decoded="Position report · 52.0° N, 19.8° E",
                protocol="ACARS",
            ),
        )
        for station in ("Poznań", "Łódź"):
            db.execute(
                "INSERT OR IGNORE INTO receipts VALUES (?,?,?)",
                (key, station, f["last"]),
            )
        db.execute("UPDATE flights SET airframes='ready' WHERE id=?", (f["id"],))


def debug_tick(db):
    """Advance the deterministic scenario one step, including temporary coverage loss."""
    s = db.execute("SELECT at FROM snapshots WHERE mode='debug'").fetchone()
    base = datetime(2025, 1, 3, 12, 6, tzinfo=timezone.utc).timestamp()
    at = s["at"] + 10
    step = round((at - base) / 10)
    rows = []
    for j, (ac, call) in enumerate([("demo01", "TV201"), ("demo02", "TV315")]):
        if j and step % 18 in (15, 16):
            continue
        phase = step % 120
        lon = 19.8 - min(phase, 120 - phase) * 0.03 + j * 0.2
        p = dict(
            latitude=52 + j * 0.45,
            longitude=lon,
            observedAt=stamp(at),
            source="ADS-B",
            altitudeMeters=dict(value=8220, certainty="observed"),
            groundSpeedMps=dict(value=215, certainty="observed"),
            headingDegrees=dict(value=270 if phase < 60 else 90, certainty="observed"),
        )
        rows.append(
            dict(
                aircraftId=ac,
                callsign=dict(value=call, certainty="observed"),
                position=p,
                flightId=None,
            )
        )
    ingest(db, "debug", dict(generatedAt=stamp(at), aircraft=rows))
    if step % 4 == 0:
        f = db.execute(
            "SELECT * FROM flights WHERE mode='debug' AND aircraft='demo01' ORDER BY last DESC LIMIT 1"
        ).fetchone()
        key = f"{f['id']}/report-{step}"
        event(
            db,
            f,
            key,
            at,
            "Airframes",
            dict(
                raw=f"TV201 / POSITION REPORT {step}",
                decoded="Position report",
                protocol="ACARS",
            ),
        )
        for station in ("Poznań", "Łódź"):
            db.execute(
                "INSERT OR IGNORE INTO receipts VALUES (?,?,?)", (key, station, at)
            )

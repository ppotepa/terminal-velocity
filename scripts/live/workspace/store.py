"""Shared flight history. All times in storage use UTC epoch seconds."""

import hashlib
import json
import math
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from time import time

DB = Path(os.environ.get("TV_FLIGHT_DB", "data/flight-workspace.sqlite3"))
GAP = 12 * 60
SPLIT = 45 * 60


def stamp(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat()


def epoch(s):
    return datetime.fromisoformat(s).timestamp()


def connect():
    db = sqlite3.connect(DB, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    return db


def initialize(db):
    db.executescript("""
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS flights(id TEXT PRIMARY KEY, mode TEXT, aircraft TEXT, callsign TEXT,
      start REAL, last REAL, origin TEXT DEFAULT '', destination TEXT DEFAULT '', latest TEXT,
      airframes TEXT DEFAULT 'waiting', checked REAL DEFAULT 0, preview REAL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS aircraft_time ON flights(mode,aircraft,last);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, flight TEXT REFERENCES flights(id),
      at REAL, source TEXT, content TEXT, confirmed INTEGER);
    CREATE INDEX IF NOT EXISTS stream ON events(flight, at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS receipts(event TEXT REFERENCES events(id), station TEXT, at REAL,
      PRIMARY KEY(event,station,at));
    CREATE TABLE IF NOT EXISTS frame_pages(flight TEXT PRIMARY KEY, since REAL, until REAL, before_id INTEGER);
    CREATE TABLE IF NOT EXISTS api_budget(day TEXT PRIMARY KEY, requests INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS snapshots(mode TEXT PRIMARY KEY, at REAL, ids TEXT);
    CREATE TABLE IF NOT EXISTS corridors(id TEXT PRIMARY KEY,mode TEXT,origin TEXT,destination TEXT,
      line TEXT,width REAL);
    CREATE TABLE IF NOT EXISTS corridor_members(corridor TEXT, flight TEXT, last REAL, status TEXT,
      PRIMARY KEY(corridor,flight));
    CREATE TABLE IF NOT EXISTS rules(id TEXT PRIMARY KEY,mode TEXT,kind TEXT,target TEXT,sources TEXT,active INTEGER);
    CREATE TABLE IF NOT EXISTS collected(rule TEXT REFERENCES rules(id), event TEXT REFERENCES events(id),
      PRIMARY KEY(rule,event));
    """)


def route(f):
    return (
        f["origin"] + "/" + f["destination"] if f["origin"] and f["destination"] else ""
    )


def event(db, f, key, at, source, content, confirmed=True):
    inserted = db.execute(
        "INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?)",
        (key, f["id"], at, source, json.dumps(content), confirmed),
    )
    if source == "ADS-B" and inserted.rowcount:
        for c in db.execute("SELECT * FROM corridors WHERE mode=?", (f["mode"],)):
            update_member(db, f, c)
    if not confirmed:
        return
    if not inserted.rowcount:
        upgraded = db.execute(
            "UPDATE events SET confirmed=1 WHERE id=? AND confirmed=0", (key,)
        )
        if not upgraded.rowcount:
            return
    for rule in db.execute("SELECT * FROM rules WHERE mode=? AND active", (f["mode"],)):
        if source in json.loads(rule["sources"]) and matches(db, f, rule):
            db.execute(
                "INSERT OR IGNORE INTO collected VALUES (?,?)", (rule["id"], key)
            )


def positions(db, f):
    points = []
    for row in db.execute(
        "SELECT at,content FROM events WHERE flight=? AND source='ADS-B' ORDER BY at",
        (f["id"],),
    ):
        p = json.loads(row["content"])
        points.append((row["at"], p["longitude"], p["latitude"]))
    return points


def segments(points):
    result = []
    for i, (at, x, y) in enumerate(points):
        if not i or at - points[i - 1][0] > GAP:
            result.append([])
        result[-1].append([x, y])
    return result


def corridor_status(points, c):
    # Local tangent plane for the regional coverage. Width is full width in km.
    a, b = json.loads(c["line"])
    scale = 111.195 * math.cos(math.radians((a[1] + b[1]) / 2))
    dx, dy = (b[0] - a[0]) * scale, (b[1] - a[1]) * 111.195
    norm = dx * dx + dy * dy
    seen = False
    for segment in segments(points):
        lo, hi = 1, 0
        for x, y in segment:
            px, py = (x - a[0]) * scale, (y - a[1]) * 111.195
            t = (px * dx + py * dy) / norm
            inside = (
                0 <= t <= 1 and math.hypot(px - t * dx, py - t * dy) <= c["width"] / 2
            )
            if inside:
                seen = True
                lo, hi = min(lo, t), max(hi, t)
                if hi - lo >= 0.6:
                    return "passage"
            else:
                lo, hi = 1, 0
    return "observation" if seen else ""


def update_member(db, f, c):
    status = corridor_status(positions(db, f), c)
    db.execute(
        "INSERT OR REPLACE INTO corridor_members VALUES (?,?,?,?)",
        (c["id"], f["id"], f["last"], status),
    )


def populate_members(db, c):
    for f in db.execute(
        "SELECT * FROM flights WHERE mode=? AND id NOT IN (SELECT flight FROM corridor_members WHERE corridor=?)",
        (c["mode"], c["id"]),
    ):
        update_member(db, f, c)


def matches(db, f, r):
    if r["kind"] == "corridor":
        row = db.execute(
            "SELECT status FROM corridor_members WHERE corridor=? AND flight=?",
            (r["target"], f["id"]),
        ).fetchone()
        return bool(row and row[0])
    return {"flight": f["id"], "aircraft": f["aircraft"], "route": route(f)}.get(
        r["kind"]
    ) == r["target"]


def ingest(db, mode, snapshot):
    now = epoch(snapshot["generatedAt"])
    old = db.execute("SELECT at FROM snapshots WHERE mode=?", (mode,)).fetchone()
    if old and old[0] >= now:
        return
    ids = []
    for item in snapshot["aircraft"]:
        p = item["position"]
        at = epoch(p["observedAt"])
        ac = item["aircraftId"]
        call = (item.get("callsign") or {}).get("value", "")
        f = db.execute(
            "SELECT * FROM flights WHERE mode=? AND aircraft=? ORDER BY last DESC LIMIT 1",
            (mode, ac),
        ).fetchone()
        if f and at < f["last"]:
            ids.append(f["id"])
            continue
        if (
            not f
            or at - f["last"] > SPLIT
            or (call and f["callsign"] and call != f["callsign"])
        ):
            fid = f"{mode}-{ac}-{int(at * 1000)}"
            db.execute(
                "INSERT INTO flights(id,mode,aircraft,callsign,start,last) VALUES (?,?,?,?,?,?)",
                (fid, mode, ac, call, at, at),
            )
        else:
            fid = f["id"]
        ids.append(fid)
        item["flightId"] = fid
        item.setdefault("noPositionReason", None)
        db.execute(
            "UPDATE flights SET latest=?,last=?,callsign=coalesce(nullif(?,''),callsign) WHERE id=?",
            (json.dumps(item), at, call, fid),
        )
        f = db.execute("SELECT * FROM flights WHERE id=?", (fid,)).fetchone()
        event(db, f, f"{fid}:{at}", at, "ADS-B", p)
    db.execute(
        "INSERT OR REPLACE INTO snapshots VALUES (?,?,?)", (mode, now, json.dumps(ids))
    )


def frame_evidence(db, f):
    confirmed = bool(db.execute(
        "SELECT 1 FROM events WHERE flight=? AND source='Airframes' AND confirmed LIMIT 1",
        (f["id"],),
    ).fetchone())
    if confirmed:
        state = "confirmed"
    elif f["airframes"] == "unavailable":
        state = "unavailable"
    elif f["airframes"] == "uncertain":
        state = "unconfirmed"
    elif f["checked"] > 0:
        state = "no_match"
    else:
        state = "not_checked"
    return dict(
        hasFrames=confirmed,
        frameStatus=state,
        frameCheckedAt=stamp(f["checked"]) if f["checked"] > 0 else None,
    )


def snapshot(db, mode):
    s = db.execute("SELECT * FROM snapshots WHERE mode=?", (mode,)).fetchone()
    if not s:
        return dict(generatedAt=stamp(0), aircraft=[], sourceFreshness="unknown")
    rows = []
    for fid in json.loads(s["ids"]):
        f = db.execute("SELECT * FROM flights WHERE id=?", (fid,)).fetchone()
        item = json.loads(f["latest"])
        item.update(frame_evidence(db, f))
        rows.append(item)
    return dict(
        generatedAt=stamp(s["at"]),
        aircraft=rows,
        sourceFreshness="stale" if time() - s["at"] > 300 else "fresh",
    )


def save_rule(db, f, kind, sources, active, target=None):
    targets = {"flight": f["id"], "aircraft": f["aircraft"], "route": route(f)}
    if kind == "corridor":
        c = db.execute(
            "SELECT id FROM corridors WHERE mode=? AND origin=? AND destination=? AND id=?",
            (f["mode"], f["origin"], f["destination"], target),
        ).fetchone()
        targets[kind] = c[0] if c else ""
    target = targets.get(kind)
    if (
        not target
        or not isinstance(sources, list)
        or not sources
        or any(s not in ("Airframes", "ADS-B") for s in sources)
        or type(active) != bool
    ):
        raise ValueError("Invalid listening target or sources")
    sources = json.dumps(sorted(set(sources)))
    key = hashlib.sha256(
        json.dumps([f["mode"], kind, target, sources]).encode()
    ).hexdigest()
    db.execute(
        "INSERT INTO rules VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET active=excluded.active",
        (key, f["mode"], kind, target, sources, active),
    )
    return key


def detail(db, f):
    pts = positions(db, f)
    related = (
        [
            dict(row)
            for row in db.execute(
                "SELECT id,aircraft,callsign,start,last FROM flights WHERE mode=? AND origin=? AND destination=? ORDER BY start DESC",
                (f["mode"], f["origin"], f["destination"]),
            )
        ]
        if route(f)
        else []
    )
    corridors = []
    for row in db.execute(
        "SELECT * FROM corridors WHERE mode=? AND origin=? AND destination=?",
        (f["mode"], f["origin"], f["destination"]),
    ):
        members = dict(
            db.execute(
                "SELECT flight,status FROM corridor_members WHERE corridor=? AND status!=''",
                (row["id"],),
            )
        )
        corridors.append(
            dict(
                id=row["id"],
                line=json.loads(row["line"]),
                width=row["width"],
                members=members,
            )
        )
    targets = {f["id"], f["aircraft"], route(f), *(c["id"] for c in corridors)}
    rules = [
        dict(
            id=r["id"],
            kind=r["kind"],
            target=r["target"],
            sources=json.loads(r["sources"]),
            active=bool(r["active"]),
        )
        for r in db.execute("SELECT * FROM rules WHERE mode=? AND active", (f["mode"],))
        if r["target"] in targets
    ]
    state = f["airframes"]
    has_frames = db.execute(
        "SELECT 1 FROM events WHERE flight=? AND source='Airframes' AND confirmed",
        (f["id"],),
    ).fetchone()
    if state in ("waiting", "ready"):
        state = "ready" if has_frames else "waiting"
    return dict(
        item=dict(json.loads(f["latest"]), **frame_evidence(db, f)),
        origin=f["origin"],
        destination=f["destination"],
        track=segments(pts),
        airframes=state,
        related=related,
        corridors=corridors,
        rules=rules,
    )


def stream(db, f, before, source):
    args = [f["id"]]
    where = "flight=?"
    if before:
        cursor = db.execute(
            "SELECT at,id FROM events WHERE id=? AND flight=?", (before, f["id"])
        ).fetchone()
        if not cursor:
            raise ValueError("Invalid cursor")
        where += " AND (at,id)<(?,?)"
        args.extend(cursor)
    if source:
        where += " AND source=?"
        args.append(source)
    rows = db.execute(
        "SELECT * FROM events WHERE " + where + " ORDER BY at DESC,id DESC LIMIT 31",
        args,
    ).fetchall()
    items = []
    for r in rows[:30]:
        receipts = [
            dict(station=x["station"], at=stamp(x["at"]))
            for x in db.execute(
                "SELECT * FROM receipts WHERE event=? ORDER BY at", (r["id"],)
            )
        ]
        items.append(
            dict(
                id=r["id"],
                at=stamp(r["at"]),
                source=r["source"],
                content=json.loads(r["content"]),
                confirmed=bool(r["confirmed"]),
                receipts=receipts,
            )
        )
    return dict(items=items, next=items[-1]["id"] if len(rows) > 30 else None)

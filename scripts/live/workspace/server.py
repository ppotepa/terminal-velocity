"""Serve the map workspace on a local Unix socket behind the existing web proxy."""

import json
import logging
import os
import re
import socketserver
import threading
from contextlib import closing
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from time import sleep, time
from urllib.error import HTTPError
from urllib.parse import urlsplit, parse_qs

from listeners import (
    accept, debug, debug_tick, derive_corridor, discovery_due, due,
    fetch_frames, reserve_discovery_request,
)
from store import (
    DB,
    connect,
    detail,
    ingest,
    initialize,
    populate_members,
    save_rule,
    snapshot,
    stream,
)


class Handler(BaseHTTPRequestHandler):
    def route(self):
        url = urlsplit(self.path)
        parts = url.path.strip("/").split("/")
        if (
            parts[:3] != ["api", "v1", "workspace"]
            or len(parts) < 5
            or parts[3] not in ("debug", "live")
        ):
            return 404, {}
        mode = parts[3]
        q = parse_qs(url.query)
        with closing(connect()) as db, db:
            if len(parts) == 5 and parts[4] == "snapshot" and self.command == "GET":
                if mode == "debug":
                    db.execute(
                        "UPDATE flights SET preview=? WHERE id=(SELECT id FROM flights WHERE mode='debug' ORDER BY last DESC LIMIT 1)",
                        (time() + 20,),
                    )
                return 200, snapshot(db, mode)
            if mode == "live" and self.command == "POST" and parts[4:] == ["legacy"]:
                body = self.read_json()
                ac = body.get("aircraftId", "")
                if not re.fullmatch(r"~?[a-f0-9]{6}", ac):
                    return 400, {}
                target = dict(
                    id="", mode="live", aircraft=ac, origin="", destination=""
                )
                return 200, dict(
                    id=save_rule(db, target, "aircraft", ["ADS-B", "Airframes"], True)
                )
            if len(parts) < 6 or parts[4] != "flights":
                return 404, {}
            f = db.execute(
                "SELECT * FROM flights WHERE mode=? AND id=?", (mode, parts[5])
            ).fetchone()
            if not f:
                return 404, {}
            if self.command == "GET" and len(parts) == 6:
                if mode == "live":
                    db.execute(
                        "UPDATE flights SET preview=? WHERE id=?",
                        (time() + 20, f["id"]),
                    )
                return 200, detail(db, f)
            if self.command == "GET" and parts[6:] == ["events"]:
                return 200, stream(
                    db, f, q.get("before", [""])[0], q.get("source", [""])[0]
                )
            if self.command == "POST" and parts[6:] == ["rules"]:
                body = self.read_json()
                return 200, dict(
                    id=save_rule(
                        db,
                        f,
                        body["kind"],
                        body["sources"],
                        body["active"],
                        body.get("target"),
                    )
                )
        return 404, {}

    def read_json(self):
        if self.headers.get("Content-Type") != "application/json":
            raise ValueError("Expected JSON")
        length = int(self.headers.get("Content-Length", "0"))
        if not 0 < length < 2048:
            raise ValueError("Invalid body length")
        body = json.loads(self.rfile.read(length))
        if not isinstance(body, dict):
            raise ValueError("Expected a JSON object")
        return body

    def respond(self):
        try:
            status, data = self.route()
        except (ValueError, KeyError, TypeError):
            status, data = 400, {}
        except Exception:
            logging.exception("Workspace request failed")
            status, data = 503, {}
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    do_GET = do_POST = respond

    def log_message(self, *args):
        pass


def collect():
    path = Path(os.environ["TV_SNAPSHOT_PATH"])
    modified = None
    retry = 0
    last_debug = time()
    next_discovery = 0
    while True:
        try:
            with closing(connect()) as db:
                if time() - last_debug >= 10:
                    active = db.execute(
                        "SELECT 1 FROM flights WHERE mode='debug' AND preview>? UNION ALL SELECT 1 FROM rules WHERE mode='debug' AND active LIMIT 1",
                        (time(),),
                    ).fetchone()
                    if active:
                        with db:
                            debug_tick(db)
                    last_debug = time()
                version = path.stat().st_mtime_ns
                if version != modified:
                    with db:
                        ingest(db, "live", json.loads(path.read_text()))
                        for f in db.execute(
                            "SELECT * FROM flights WHERE mode='live' AND origin!='' AND destination!='' AND last>?",
                            (time() - 300,),
                        ):
                            derive_corridor(db, f)
                    modified = version
                now = time()
                f = None
                if now >= retry and now >= next_discovery:
                    next_discovery = now + 300
                    candidate = discovery_due(db, now)
                    if candidate:
                        # Reserve and commit discovery allowance before any network call.
                        with db:
                            if reserve_discovery_request(db, now):
                                f = candidate
                if f is None and now >= retry:
                    f = due(db, now)
                if f:
                    try:
                        with db:
                            frames = fetch_frames(db, f)
                            states = {accept(db, f, msg) for msg in frames}
                        state = (
                            "ready"
                            if "ready" in states
                            else "uncertain"
                            if "uncertain" in states
                            else "waiting"
                        )
                    except (OSError, ValueError, KeyError) as exc:
                        state = "unavailable"
                        if isinstance(exc, HTTPError) and exc.code == 429:
                            delay = exc.headers.get("Retry-After", "60")
                            retry = time() + max(
                                60, int(delay) if delay.isdigit() else 300
                            )
                    with db:
                        db.execute(
                            "UPDATE flights SET airframes=?,checked=? WHERE id=?",
                            (state, time(), f["id"]),
                        )
        except Exception:
            logging.exception("Acquisition cycle failed")
        sleep(3)


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


if __name__ == "__main__":
    DB.parent.mkdir(parents=True, exist_ok=True)
    with closing(connect()) as db, db:
        initialize(db)
        debug(db)
        for corridor in db.execute("SELECT * FROM corridors"):
            populate_members(db, corridor)
    path = Path(os.environ["TV_WORKSPACE_SOCKET"])
    path.unlink(missing_ok=True)
    with Server(str(path), Handler) as server:
        threading.Thread(target=collect, daemon=True).start()
        server.serve_forever()

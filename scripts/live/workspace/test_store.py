import sqlite3
import unittest
from time import time

from listeners import accept, debug, discovery_due, reserve_request
from store import (
    corridor_status,
    detail,
    initialize,
    ingest,
    save_rule,
    segments,
    snapshot,
    stamp,
    stream,
)


class FlightStoreTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.row_factory = sqlite3.Row
        initialize(self.db)
        debug(self.db)
        self.flight = self.db.execute(
            "SELECT * FROM flights WHERE aircraft='demo01' ORDER BY start DESC LIMIT 1"
        ).fetchone()

    def test_reused_callsign_has_separate_track_and_receipts(self):
        f = self.flight
        info = detail(self.db, f)
        self.assertEqual(len(info["related"]), 2)
        self.assertEqual(len(set(r["id"] for r in info["related"])), 2)
        frame = stream(self.db, f, None, "Airframes")["items"][0]
        self.assertEqual(len(frame["receipts"]), 2)
        self.assertEqual(len(info["track"][0]), 7)
        previous = next(r for r in info["related"] if r["id"] != f["id"])
        self.assertNotEqual(previous["start"], f["start"])

    def test_idempotent_rule_and_confirmed_receipts(self):
        db, f = self.db, self.flight
        key = save_rule(db, f, "aircraft", ["Airframes", "ADS-B"], True)
        self.assertEqual(
            key, save_rule(db, f, "aircraft", ["ADS-B", "Airframes"], True)
        )
        msg = dict(
            id=100,
            arUUID="frame-1",
            fromHex="demo01",
            timestamp=stamp(f["last"]),
            flightNumber="TV201",
            text="REPORT",
            station=dict(ident="Receiver A"),
        )
        accept(db, f, msg)
        accept(db, f, {**msg, "id": 101, "station": dict(ident="Receiver B")})
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM collected WHERE rule=?", (key,)
            ).fetchone()[0],
            1,
        )
        frames = stream(db, f, None, "Airframes")["items"]
        self.assertEqual(
            len(
                next(e for e in frames if e["content"]["decoded"] == "REPORT")[
                    "receipts"
                ]
            ),
            2,
        )
        save_rule(db, f, "aircraft", ["Airframes", "ADS-B"], False)
        accept(db, f, {**msg, "arUUID": None, "id": 102})
        self.assertEqual(
            db.execute(
                "SELECT COUNT(*) FROM collected WHERE rule=?", (key,)
            ).fetchone()[0],
            1,
        )

    def test_uncertain_assignment_never_sets_ring(self):
        f = self.db.execute(
            "SELECT * FROM flights WHERE aircraft='demo02' ORDER BY last DESC LIMIT 1"
        ).fetchone()
        msg = dict(
            id=10,
            fromHex=f["aircraft"],
            timestamp=stamp(f["last"]),
            flightNumber="OTHER",
        )
        self.assertEqual(accept(self.db, f, msg), "uncertain")
        self.assertIsNone(
            accept(self.db, f, {**msg, "timestamp": stamp(f["start"] - 1)})
        )
        markers = snapshot(self.db, "debug")["aircraft"]
        self.assertFalse(
            next(r for r in markers if r["aircraftId"] == f["aircraft"])["hasFrames"]
        )

    def test_snapshot_loss_preserves_last_contact(self):
        f = self.flight
        ingest(self.db, "debug", dict(generatedAt=stamp(f["last"] + 10), aircraft=[]))
        self.assertEqual(snapshot(self.db, "debug")["aircraft"], [])
        self.assertEqual(detail(self.db, f)["item"]["flightId"], f["id"])

    def test_gaps_and_corridor_evidence(self):
        c = dict(line="[[19,52],[20,52]]", width=12)
        self.assertEqual(corridor_status([(0, 19.1, 52)], c), "observation")
        self.assertEqual(corridor_status([(0, 19.1, 52), (30, 19.9, 52)], c), "passage")
        separated = [(0, 19.1, 52), (900, 19.9, 52)]
        self.assertEqual(corridor_status(separated, c), "observation")
        self.assertEqual(len(segments(separated)), 2)
        self.assertFalse(corridor_status([(0, 19.5, 53)], c))

    def test_snapshot_distinguishes_confirmed_unchecked_and_no_match(self):
        db = self.db
        current = next(a for a in snapshot(db, "debug")["aircraft"] if a["aircraftId"] == "demo01")
        self.assertTrue(current["hasFrames"])
        self.assertEqual(current["frameStatus"], "confirmed")
        other = db.execute(
            "SELECT * FROM flights WHERE aircraft='demo02' ORDER BY last DESC LIMIT 1"
        ).fetchone()
        before = next(a for a in snapshot(db, "debug")["aircraft"] if a["aircraftId"] == "demo02")
        self.assertEqual(before["frameStatus"], "not_checked")
        self.assertIsNone(before["frameCheckedAt"])
        db.execute("UPDATE flights SET checked=?,airframes='waiting' WHERE id=?", (time(), other["id"]))
        checked = next(a for a in snapshot(db, "debug")["aircraft"] if a["aircraftId"] == "demo02")
        self.assertEqual(checked["frameStatus"], "no_match")
        self.assertTrue(checked["frameCheckedAt"])
        db.execute("UPDATE flights SET airframes='unavailable' WHERE id=?", (other["id"],))
        unavailable = next(a for a in snapshot(db, "debug")["aircraft"] if a["aircraftId"] == "demo02")
        self.assertEqual(unavailable["frameStatus"], "unavailable")
        self.assertEqual(detail(db, self.flight)["item"]["frameStatus"], "confirmed")

    def test_public_discovery_is_bounded_and_budget_survives_checks(self):
        db = self.db
        now = time()
        ingest(db, "live", dict(
            generatedAt=stamp(now),
            aircraft=[dict(
                aircraftId="a1b2c3",
                callsign=dict(value="TV123"),
                position=dict(latitude=52, longitude=20, observedAt=stamp(now), source="ADS-B"),
            ), dict(
                aircraftId="~123abc",
                callsign=dict(value="TV124"),
                position=dict(latitude=52, longitude=21, observedAt=stamp(now), source="ADS-B"),
            )],
        ))
        candidate = discovery_due(db, now)
        self.assertIsNotNone(candidate)
        self.assertEqual(candidate["aircraft"], "a1b2c3")
        db.execute("UPDATE flights SET checked=? WHERE id=?", (now, candidate["id"]))
        self.assertIsNone(discovery_due(db, now))
        db.execute("UPDATE snapshots SET at=? WHERE mode='live'", (now - 400,))
        self.assertIsNone(discovery_due(db, now))
        self.assertTrue(reserve_request(db, now, limit=2))
        self.assertTrue(reserve_request(db, now, limit=2))
        self.assertFalse(reserve_request(db, now, limit=2))
        self.assertTrue(reserve_request(db, now + 86400, limit=2))

    def test_cursor_stays_stable_with_new_arrivals(self):
        f = self.flight
        for i in range(45):
            accept(
                self.db,
                f,
                dict(
                    id=1000 + i,
                    fromHex=f["aircraft"],
                    timestamp=stamp(f["last"] - i),
                    text=str(i),
                ),
            )
        page = stream(self.db, f, None, "Airframes")
        accept(
            self.db,
            f,
            dict(
                id=2000, fromHex=f["aircraft"], timestamp=stamp(f["last"]), text="new"
            ),
        )
        older = stream(self.db, f, page["next"], "Airframes")
        self.assertEqual(len(page["items"]), 30)
        self.assertEqual(len(older["items"]), 16)
        self.assertFalse(
            {r["id"] for r in page["items"]} & {r["id"] for r in older["items"]}
        )


if __name__ == "__main__":
    unittest.main()

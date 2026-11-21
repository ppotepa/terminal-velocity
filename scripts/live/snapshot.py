"""Publish one atomic, shared ADS-B snapshot for the live map."""
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen

def stamp(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat()

def number(value):
    return isinstance(value, (int, float)) and math.isfinite(value)

def snapshot(data):
    now = data["now"] / 1000
    rows = []
    for item in data["ac"]:
        lat, lon, age = (item.get(k) for k in ("lat", "lon", "seen_pos"))
        if not all(map(number, (lat, lon, age))) or not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 <= age <= 90):
            continue
        observed = stamp(now - age)
        position = dict(latitude=lat, longitude=lon, observedAt=observed, source="adsb.lol")
        for key, source, scale in [('altitudeMeters','alt_baro',0.3048),('groundSpeedMps','gs',0.514444),('headingDegrees','track',1)]:
            if number(item.get(source)):
                position[key] = dict(value=round(item[source]*scale,1),certainty='observed')
        callsign = (item.get("flight") or "").strip()
        rows.append(dict(aircraftId=item['hex'], callsign=dict(value=callsign, certainty='observed') if callsign else None,
                         position=position, flightId=None, noPositionReason=None))
    return dict(generatedAt=stamp(now), sourceFreshness='fresh', aircraft=rows)

if __name__ == '__main__':
    with urlopen('https://api.adsb.lol/v2/lat/52/lon/20/dist/150', timeout=15) as response:
        result = snapshot(json.load(response))
    target = Path(sys.argv[1])
    temp = target.with_suffix('.tmp')
    temp.write_text(json.dumps(result))
    os.replace(temp, target)

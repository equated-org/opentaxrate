"""What the geocoder answers kept for replay cost at list price.

    python3 scripts/tuning/cost.py [REPLAY FILES...]

Defaults to every replay file in $TUNE_DIR. Run it before and after a round
to see that round's spend; a "no match" was paid for too.
"""
import collections, glob, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TUNE = Path(os.environ.get("TUNE_DIR", ROOT / "artifacts/tuning"))
# Dollars per call, from src/geocoding/registry.ts's list prices; "standardize"
# is Geocodio's ZIP+4 lookup.
PRICE = {"geocodio": 0.001, "standardize": 0.001, "smarty": 0.001, "mapbox": 0.00075,
         "here": 0.00083, "esri": 0.0005, "google": 0.005}
files = sys.argv[1:] or glob.glob(str(TUNE / "replay-*.json"))
calls = collections.Counter()
for f in files:
    try:
        kept = json.load(open(f))
    except (OSError, ValueError):
        continue
    for key in kept:
        calls[key.split("|")[0]] += 1
print(f"${sum(PRICE.get(p, 0) * c for p, c in calls.items()):.2f}", dict(calls.most_common()))

"""Make a history split: labelled addresses asked again on past dates.

    python3 -I scripts/tuning/history_split.py NAME DATES STATES [FROM_SPLITS]

Takes every address of FROM_SPLITS (default: the dev splits) in STATES
(comma-separated) and writes artifacts/bench/pool/sets/NAME/cases.csv with
one row per address and date in DATES (comma-separated). A geocode doesn't
depend on the sale date, so each geocoder's and the standardizer's replayed
answer for the address is copied to the new case's id in
$TUNE_DIR/replay-NAME.json: a trial of the split asks no geocoder again.
Label it with boundary/label.py (BOUNDARY_CASES, BOUNDARY_OUT), then run it
with trial.sh and score.py like any split.
"""
import csv, hashlib, json, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT / "artifacts/bench/pool"
TUNE = Path(os.environ.get("TUNE_DIR", ROOT / "artifacts/tuning"))
DEV = "batch1 batch-dev batch2 batch3 batch4 batch5 round2".split()


def case_id(state, street, city, zip_, date):
    key = f"{state.strip().upper()}|{street.strip()}|{city.strip()}|{zip_.strip()}|{date.strip()}"
    return hashlib.sha256(key.upper().encode()).hexdigest()[:16]


def main(name, dates, states, splits):
    rows, replay, seen = [], {}, set()
    for split in splits:
        old = json.loads((TUNE / f"replay-{split}.json").read_text()) if (TUNE / f"replay-{split}.json").exists() else {}
        for r in csv.DictReader(open(POOL / "sets" / split / "cases.csv")):
            if r["state"] not in states or not r["lon"]: continue
            key = (r["state"], r["street"], r["city"], r["zip"])
            if key in seen: continue
            seen.add(key)
            was = case_id(r["state"], r["street"], r["city"], r["zip"], r.get("date") or "2026-10-21")
            for date in dates:
                now = case_id(r["state"], r["street"], r["city"], r["zip"], date)
                rows.append({**r, "date": date, "expected": "", "notes": f"{r.get('notes', '')} history of {split}".strip()})
                for k, v in old.items():
                    provider, _, cid = k.partition("|")
                    if cid == was: replay[f"{provider}|{now}"] = v
    out = POOL / "sets" / name
    out.mkdir(parents=True, exist_ok=True)
    with open(out / "cases.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["state", "street", "city", "zip", "date", "expected", "source", "lon", "lat", "notes"], extrasaction="ignore")
        w.writeheader(); w.writerows(rows)
    TUNE.mkdir(parents=True, exist_ok=True)
    (TUNE / f"replay-{name}.json").write_text(json.dumps(replay))
    print(f"{name}: {len(rows)} cases ({len(seen)} addresses × {len(dates)} dates), {len(replay)} replayed answers copied")


if __name__ == "__main__":
    a = sys.argv[1:]
    main(a[0], a[1].split(","), set(a[2].split(",")), a[3].split(",") if len(a) > 3 else DEV)

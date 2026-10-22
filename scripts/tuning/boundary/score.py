"""Score a boundary-benchmark run against the states' own answers at each point.

    python3 -I scripts/tuning/boundary/score.py NAME [BASE] [STATE...]

For each point and date the state labelled (label.py), the run's answer
(run.mts) is graded twice:
  - rate: right, wrong, or declined;
  - jurisdictions, where the rate is answered: the same jurisdictions as the
    state names; different but flagged (the answer marks its jurisdictions
    uncertain and lists the state's among its alternatives); or different.
    A right total from the wrong jurisdictions, unflagged, is still a wrong
    breakdown: it files tax to the wrong place, and it hides an error a rate
    change will expose.
Each is broken down by the point's distance to the nearest rated line as
loaded today (edge_m), and by date: today against past dates, where a wrong
answer from today's lines is a boundary history gap.

Prints the one-sided 95% Clopper-Pearson upper bound on the wrong rate of
answered points. With BASE, lists every point whose grade changed. LIST=1
lists every wrong rate and wrong breakdown. Statewide answers of the oracle
(refusals: no single answer, a date it can't answer) are left out.
"""
import collections, csv, json, math, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DIR = Path(os.environ.get("BOUNDARY_DIR", ROOT / "artifacts/bench/boundary"))
TODAY = os.environ.get("BOUNDARY_TODAY", "2026-10-21")
BANDS = [(0, 10), (10, 30), (30, 100), (100, 1e9)]


def load(path):
    return {r["id"]: r for r in map(json.loads, filter(None, Path(path).read_text().splitlines()))} if Path(path).exists() else {}


def ours(state, answer):
    """The jurisdictions in OpenTaxRate's answer, keyed as the state's oracle keys them."""
    keys = set()
    for p in answer.get("parts", []):
        ids, code = p.get("ids") or {}, p["code"].split(":", 1)[-1]
        # Arizona's county part carries the state's 5.6%, so it's named even at 0.
        if state == "AZ" and p["kind"] == "county": keys.add(ids.get("RegionCode") or code); continue
        if p["kind"] == "state" or not p["rate"]: continue
        if state == "TX": keys.add(ids.get("TAID") or code.split(">")[-1])
        elif state in ("CO", "AK"): keys.add(ids.get("placeId") or code)
        elif state == "AZ": keys.add(ids.get("RegionCode") or f"{p['kind']}:{p['rate']:.6f}")
        elif state == "VA": keys.add(code.split("@")[0])
        elif state == "SC": keys.add((p.get("name") or code).upper())
    return keys


def theirs(state, label):
    state_codes = {"TX": "1", "CO": "1", "AK": "595", "SC": "45"}
    keys = set()
    for p in label.get("parts", []):
        if not p["rate"] or p["code"] == state_codes.get(state): continue
        if state == "AZ" and p.get("kind") == "district": keys.add(f"district:{p['rate']:.6f}")
        else: keys.add(p["code"])
    return keys


def upper(k, n):
    if n == 0: return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(60):
        m = (lo + hi) / 2
        cdf = sum(math.comb(n, j) * m**j * (1 - m) ** (n - j) for j in range(k + 1))
        lo, hi = (m, hi) if cdf > 0.05 else (lo, m)
    return hi


def grade(state, label, answer):
    if answer is None: return "missing", None
    if "refused" in answer: return "declined", None
    if abs(answer["rate"] - label["rate"]) >= 5e-5: return "wrong", None
    official = theirs(state, label)
    if ours(state, answer) == official: return "right", "same"
    if any(ours(state, a) == official for a in answer.get("alternatives", [])): return "right", "flagged"
    return "right", "different"


def run(name, states):
    rows = []
    for st in states:
        labels = load(DIR / st / "official.jsonl")
        answers = load(DIR / st / "runs" / f"{name}.jsonl")
        for p in csv.DictReader(open(DIR / st / "points.csv")):
            label = labels.get(p["id"])
            if not label or "refused" in label: continue
            g, ident = grade(st, label, answers.get(p["id"]))
            rows.append({**p, "grade": g, "ident": ident, "label": label, "answer": answers.get(p["id"])})
    return rows


def band(p):
    if p["stratum"] == "control": return "control"
    e = float(p["edge_m"])
    return next(f"{lo:g}-{hi:g} m" if hi < 1e9 else f"{lo:g}+ m" for lo, hi in BANDS if lo <= e < hi)


def line(label, rows):
    t = collections.Counter(r["grade"] for r in rows)
    i = collections.Counter(r["ident"] for r in rows if r["ident"])
    n, answered = len(rows), t["right"] + t["wrong"]
    # Right jurisdictions, yet marked uncertain: the cost of flagging.
    needless = sum(1 for r in rows if r["ident"] == "same" and (r["answer"] or {}).get("jurisdictions") == "uncertain")
    if not n: return
    print(f"  {label:18s} n={n:5d}  right {t['right']:5d} ({100 * t['right'] / n:5.1f}%)  wrong {t['wrong']:4d}  declined {t['declined']:4d}"
          f"  | wrong upper95 {100 * upper(t['wrong'], answered):5.2f}% of answered"
          f"  | breakdown differs {i['different']:3d}, flagged {i['flagged']:3d}, needlessly flagged {needless:3d}"
          + (f"  missing {t['missing']}" if t["missing"] else ""))


def main():
    args = sys.argv[1:]
    name = args.pop(0)
    base = args.pop(0) if args and not (len(args[0]) == 2 and args[0].isupper()) else None
    states = args or sorted(d.name for d in DIR.iterdir() if (d / "official.jsonl").exists())
    rows = run(name, states)
    print(f"{name}: {len(rows)} labelled points and dates in {', '.join(states)}")
    line("all", rows)
    print(" by state")
    for st in states: line(st, [r for r in rows if r["state"] == st])
    print(" by distance to the nearest rated line")
    for b in [f"{lo:g}-{hi:g} m" if hi < 1e9 else f"{lo:g}+ m" for lo, hi in BANDS] + ["control"]:
        line(b, [r for r in rows if band(r) == b])
    print(" by date")
    line("today", [r for r in rows if r["date"] == TODAY])
    for d in sorted({r["date"] for r in rows} - {TODAY}): line(d, [r for r in rows if r["date"] == d])
    if base:
        before = {(r["state"], r["id"]): r for r in run(base, states)}
        print(f" changed from {base}")
        for r in rows:
            b = before.get((r["state"], r["id"]))
            if b and (b["grade"], b["ident"]) != (r["grade"], r["ident"]):
                print(f"  {b['grade']}/{b['ident']} -> {r['grade']}/{r['ident']}  {r['state']} {r['lon']},{r['lat']} {r['date']} edge {r['edge_m']} m"
                      f"  official {100 * r['label']['rate']:.4g}% | {(r['answer'] or {}).get('refused', '')[:120]}")
    if os.environ.get("LIST"):
        for r in rows:
            if r["grade"] == "wrong" or r["ident"] == "different":
                a = r["answer"]
                print(f"  {r['grade']:5s} {r['ident'] or '':9s} {r['state']} {r['lon']},{r['lat']} {r['date']} edge {r['edge_m']} m near {r['near_name']}"
                      f"  official {100 * r['label']['rate']:.4g}% {sorted(theirs(r['state'], r['label']))}"
                      f"  got {100 * a['rate']:.4g}% {sorted(ours(r['state'], a))}")


main()

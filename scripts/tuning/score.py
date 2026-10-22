"""Score a trial against the official labels.

    python3 scripts/tuning/score.py NAME [BASE]

Prints right / wrong / declined over the labelled addresses of $SPLITS, and
the one-sided 95% Clopper-Pearson upper bound on the wrong rate among
answered ones; with BASE, every address whose grade changed from that run.
LIST=1 lists every wrong rate and decline.
"""
import collections, csv, glob, hashlib, json, math, os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POOL = ROOT / "artifacts/bench/pool"
TUNE = Path(os.environ.get("TUNE_DIR", ROOT / "artifacts/tuning"))
SPLITS = os.environ.get("SPLITS", "batch1 batch-dev batch2 batch3 batch4 batch5 round2").split()

def load(path):
    path = Path(path)
    return {a["id"]: a for a in map(json.loads, filter(None, path.read_text().splitlines()))} if path.exists() else {}

def case_id(r):
    key = f"{r['state'].strip().upper()}|{r['street'].strip()}|{r['city'].strip()}|{r['zip'].strip()}|{(r.get('date') or '2026-10-21').strip()}"
    return hashlib.sha256(key.upper().encode()).hexdigest()[:16]

cases, official = {}, {}
for split in SPLITS:
    for r in csv.DictReader(open(POOL / "sets" / split / "cases.csv")):
        cases[case_id(r)] = r
    official.update({i: a["rate"] for i, a in load(POOL / "answers" / split / "official.jsonl").items() if "rate" in a})

def run(name):
    answers = {}
    for f in glob.glob(str(TUNE / name / "*" / "*.jsonl")):
        answers.update(load(f))
    return answers

def grade(a, want):
    if a is None: return "missing"
    if "refused" in a: return "declined"
    return "right" if abs(a["rate"] - want) < 5e-5 else "wrong"

def upper(k, n):
    """One-sided 95% Clopper-Pearson upper bound for k events in n."""
    if n == 0: return 1.0
    lo, hi = 0.0, 1.0
    for _ in range(60):
        m = (lo + hi) / 2
        cdf = sum(math.comb(n, j) * m**j * (1 - m) ** (n - j) for j in range(k + 1))
        lo, hi = (m, hi) if cdf > 0.05 else (lo, m)
    return hi

pct = lambda r: f"{r * 100:.4f}".rstrip("0").rstrip(".") + "%"
why = lambda a: (a.get("refused") or (a.get("raw") or {}).get("source", ""))[:170]

name = sys.argv[1]
answers = run(name)
grades = {i: grade(answers.get(i), w) for i, w in official.items()}
t = collections.Counter(grades.values())
n, answered = len(official), t["right"] + t["wrong"]
print(f"{name}: n={n} right {t['right']} ({100 * t['right'] / n:.2f}%) wrong {t['wrong']} declined {t['declined']} "
      f"missing {t['missing']} | wrong-rate upper95 {100 * upper(t['wrong'], answered):.2f}% of answered")
# A split that stopped early has fewer wrong rates, not more right ones.
if t["missing"]:
    print(f"  {t['missing']} labelled addresses have no answer: a split stopped early; see its log", file=sys.stderr)
if len(sys.argv) > 2:
    base = run(sys.argv[2])
    for i, w in official.items():
        before = grade(base.get(i), w)
        if before != grades[i]:
            c = cases[i]
            print(f"  {before:8s} -> {grades[i]:8s} {c['state']} {c['street']}, {c['city']} {c['zip']} official {pct(w)} | {why(answers.get(i) or {})}")
if os.environ.get("LIST"):
    for i, w in official.items():
        if grades[i] in ("wrong", "declined"):
            c, a = cases[i], answers.get(i) or {}
            got = "" if grades[i] == "declined" else f" got {pct(a['rate'])}"
            print(f"  {grades[i]:8s} {c['state']} {c['street']}, {c['city']} {c['zip']} official {pct(w)}{got} | {why(a)}")
if t["missing"]:
    sys.exit(1)

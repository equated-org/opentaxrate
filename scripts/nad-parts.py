"""A random NAD sample with its address parts: per state, random OBJECTIDs
inside the state's ranges (from the pool's probe), 5 points per draw.
Usage: nad-parts.py <probe.json> <out.jsonl> [per_state] [seed] [exclude.jsonl]"""
import json, sys, random, urllib.request, urllib.parse, concurrent.futures as cf
B = "https://services.arcgis.com/xOi1kZaI0eWDREZv/arcgis/rest/services/Address_Points_from_National_Address_Database_view/FeatureServer/0/query"
F = "OBJECTID,State,AddNum_Pre,Add_Number,AddNum_Suf,AddNo_Full,St_PreMod,St_PreDir,St_PreTyp,St_PreSep,St_Name,St_PosTyp,St_PosDir,St_PosMod,StNam_Full,Unit,SubAddress,Post_City,Zip_Code"
probe = json.load(open(sys.argv[1])); out = sys.argv[2]; per = int(sys.argv[3]) if len(sys.argv) > 3 else 200
seed = sys.argv[4] if len(sys.argv) > 4 else "parser-audit"
exclude = {json.loads(l)["OBJECTID"] for l in open(sys.argv[5])} if len(sys.argv) > 5 else set()
step = probe["step"]; ivs = {}
for x, s in probe["probes"]:
    if s not in (None, "ERR"): ivs.setdefault(s, []).append((x - step, x + step))
def q(u):
    p = urllib.parse.urlencode({"where": f"OBJECTID>={u} AND OBJECTID<{u+5000}", "outFields": F, "resultRecordCount": 5, "orderByFields": "OBJECTID", "returnGeometry": "false", "f": "json"})
    for _ in range(3):
        try: return json.load(urllib.request.urlopen(B + "?" + p, timeout=60)).get("features", [])
        except Exception: pass
    return []
def take(st):
    rng = random.Random(f"{seed}|{st}"); iv = ivs[st]; tot = sum(b - a for a, b in iv); got = {}
    for _ in range(per // 5 * 2):
        if len(got) >= per: break
        r = rng.random() * tot
        for a, b in iv:
            if r < b - a: u = int(a + r); break
            r -= b - a
        for f in q(u):
            a = f["attributes"]
            if a.get("State") == st and a.get("StNam_Full") and a["OBJECTID"] not in exclude: got[a["OBJECTID"]] = a
    return st, list(got.values())[:per]
with open(out, "w") as w, cf.ThreadPoolExecutor(8) as ex:
    for st, rows in ex.map(take, sorted(ivs)):
        for r in rows: w.write(json.dumps(r) + "\n")
        print(st, len(rows), end=" ", flush=True)

"""Label boundary-benchmark points with each state's own answer at the point.

    python3 -I scripts/tuning/boundary/label.py STATE

Reads $BOUNDARY_DIR/<STATE>/points.csv (sample.mts) and appends one line per
point and date to official.jsonl beside it, skipping ids already there, so a
stopped run resumes. A line is
    {"id", "state", "date", "at", "rate", "parts": [{"name", "code", "rate"}], "oracle", "detail"}
or the same with "refused" in place of rate and parts: the oracle gave no
single answer (several rates at the point, no match, or an error).

`parts` is the oracle's own list of the jurisdictions that tax there, so the
benchmark can grade jurisdiction identity as well as the total. `code` is
the oracle's identifier, compared with OpenTaxRate's parts by scorer rules
per state (score.py). Every oracle here takes a point; each is official:

    TX  Comptroller GIS API latlongrate (keyed: TX_CPA_CLIENT_ID/SECRET), by quarter
    CO  CDOR Sales Tax Lookup (Avalara-hosted for CDOR), dated boundaries and rates
    AK  ARSSTC tax map (Avalara-hosted for the commission), dated
    MO  DOR lookup (Avalara-hosted for DOR), latlng and effectiveOn
    NE  DOR rate finder layer: today's outlines, each with its rate's dates
    SD  DOR city layer (General rate) with its active dates; tribal areas refused
    WI  DOR STRB lookup by address, ZIP and sale date (general rate)
    AZ  ADOR TaxRateDetails, business code 017 retail, today only
    VA  Virginia Tax locality layer, today only
    SC  SCDOR ST-500 county rates on the SC RFA county and municipal layers, today only

CO and AK are circular for rates (the engine loads the same service), not
for placement: the engine reads its own simplified outlines. A date an
oracle can't answer is refused with "date not supported".

A pool split's addresses are labelled the same way, at each address's
point (or, for WI, its address): BOUNDARY_CASES names its cases.csv and
BOUNDARY_OUT the official.jsonl to append to; ids are the bench's.
"""
import hashlib
import csv, datetime, json, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DIR = Path(os.environ.get("BOUNDARY_DIR", ROOT / "artifacts/bench/boundary"))
UA = "Mozilla/5.0 (X11; Linux x86_64) opentaxrate-boundary-benchmark"
TODAY = os.environ.get("BOUNDARY_TODAY", "2026-10-21")


class Refuse(Exception):
    def __init__(self, why, detail=None):
        super().__init__(why); self.why = why; self.detail = detail


class Http:
    """At least `gap` seconds between calls, backoff on 5xx, stop on 403/429."""
    def __init__(self, gap=1.1, headers=None):
        self.gap, self.last, self.headers = gap, 0.0, {"User-Agent": UA, **(headers or {})}

    def req(self, url, data=None, tries=3, timeout=90):
        if isinstance(data, str): data = data.encode()
        for i in range(tries):
            wait = self.last + self.gap - time.time()
            if wait > 0: time.sleep(wait)
            self.last = time.time()
            try:
                with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=self.headers), timeout=timeout) as r:
                    return r.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                if e.code in (403, 429): sys.exit(f"stopped: HTTP {e.code} from {url[:80]}")
                if e.code >= 500 and i < tries - 1: time.sleep(5 * (i + 1) ** 2); continue
                raise
            except (urllib.error.URLError, TimeoutError):
                if i < tries - 1: time.sleep(5 * (i + 1) ** 2); continue
                raise

    def json(self, *a, **k): return json.loads(self.req(*a, **k))


def arc_point(http, layer, lon, lat):
    q = "geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&returnGeometry=false&f=json&outFields=*"
    j = http.json(f"{layer}/query?geometry={lon},{lat}&{q}")
    if "error" in j: raise RuntimeError(str(j["error"])[:200])
    return [f["attributes"] for f in j.get("features", [])]


def today_only(date):
    if date != TODAY: raise Refuse("date not supported")


def TX():
    h = Http(1.2, {"client_id": os.environ["TX_CPA_CLIENT_ID"], "client_secret": os.environ["TX_CPA_CLIENT_SECRET"]})
    def ask(p):
        y, m = int(p["date"][:4]), int(p["date"][5:7])
        u = "https://mulesoft.cpa.texas.gov:8088/api/cpa/gis/v1/salestaxrate/latlongrate?" + urllib.parse.urlencode(
            {"latitude": p["lat"], "longitude": p["lon"], "quarter": (m - 1) // 3 + 1, "year": y})
        d = h.json(u)
        tot = str(d.get("TOTALTAXRATE") or "").strip()
        if not tot: raise Refuse("no TOTALTAXRATE", {"taids": [t.get("TAID") for t in d.get("TAIDS", [])], "gis": d.get("GISRETURNCODE")})
        parts = [{"name": t["JURISNAME"], "code": t["JURISCODE"], "rate": round(float(t["JURISRATE"]), 6)} for t in d.get("TAXRATES", [])]
        return round(float(tot) / 1e7, 6), parts, {"jurisdate": d.get("JURISDATE"), "inbuf": d.get("INBUFRCD"), "gis": d.get("GISRETURNCODE")}
    return "Texas Comptroller GIS API latlongrate (mulesoft.cpa.texas.gov), by quarter", ask


def TTR(st):
    host = {"AK": "https://alaska.atr.avalara.com", "CO": "https://salestaxlookup.colorado.gov"}[st]
    sname = {"AK": "Alaska", "CO": "Colorado"}[st]
    h = Http(1.2, {"Content-Type": "application/json", "Origin": host, "Referer": host + "/"})
    def ask(p):
        d = p["date"]
        pp = h.json(f"{host}/api/v1/places.pinpoints", json.dumps({"pinpoints": [{"lat": p["lat"], "lng": p["lon"], "valid": True}], "snapshot": d}))
        res = pp["places"][0].get("results") or []
        if [r["name"] for r in res if r["type"] == "State"] != [sname]: raise Refuse("point not in the state", res)
        rb = h.json(f"{host}/api/v1/rates.byPlace", json.dumps({"placeIds": [r["placeId"] for r in res], "date": d, "taxTypeFilter": 2, "taxTypeIds": [1]}))
        parts = []
        for pid, v in rb["places"].items():
            for r in v["rates"]:
                if r["effDate"] <= d and (not r.get("endDate") or r["endDate"] >= d) and r["value"]:
                    parts.append({"name": r["name"], "code": pid, "rate": round(r["value"], 6)})
        parts = [dict(t) for t in sorted({tuple(sorted(x.items())) for x in parts})]
        return round(sum(x["rate"] for x in parts), 6), parts, {"places": [[r["placeId"], r["name"], r["type"]] for r in res]}
    return {"AK": "ARSSTC tax map (alaska.atr.avalara.com) pinpoint + rates.byPlace",
            "CO": "CDOR Sales Tax Lookup (salestaxlookup.colorado.gov) pinpoint + rates.byPlace"}[st], ask


def AZ():
    h = Http(1.2)
    def arr(t, name):
        m = re.search(r"var %s = (\[.*?\]|null);" % name, t)
        return json.loads(m.group(1)) if m and m.group(1) != "null" else []
    def ask(p):
        today_only(p["date"])
        t = h.req(f"https://aztaxes.gov/Home/TaxRateDetails?X={p['lon']}&Y={p['lat']}")
        # The page names the county's region, then the city's: "MAR - MARICOPA (MAR)", "TE - TEMPE".
        regions = re.findall(r"'([A-Z]{2,4}) - ([^']{3,80})'", t)
        parts = []
        for var, kind, region in (("countyRates", "county", 0), ("cityRates", "city", 1),
                                  ("specialDistrictRatesCounty", "district", None), ("specialDistrictRatesCity", "district", None)):
            rates = {x["Rate"] for x in arr(t, var) if x.get("BusinessCode") == "017" and x.get("RateType") == "Percent"}
            if len(rates) > 1: raise Refuse(f"several {kind} 017 rates", sorted(rates))
            if rates:
                code, name = regions[region] if region is not None and len(regions) > region else (var, kind)
                parts.append({"name": name, "code": code, "kind": kind, "rate": round(rates.pop() / 100, 6)})
        if sum(1 for x in parts if x["kind"] == "county") != 1: raise Refuse("no single county 017 rate", parts)
        return round(sum(x["rate"] for x in parts), 6), parts, None
    return "ADOR aztaxes.gov TaxRateDetails X/Y, business code 017 retail (county rate includes the state's 5.6%)", ask


def VA():
    h = Http(1.0)
    U = "https://services7.arcgis.com/uqPgn4wEg9kvR2OC/arcgis/rest/services/DetailedCountyforLookupSearchPopup/FeatureServer/4"
    def ask(p):
        today_only(p["date"])
        fs = arc_point(h, U, p["lon"], p["lat"])
        if not fs: raise Refuse("outside the locality layer")
        if len({f["Sales_Tax"] for f in fs}) > 1: raise Refuse("on a line between rates", [f["NAMELSAD"] for f in fs])
        f = fs[0]
        return round(f["Sales_Tax"] / 100, 6), [{"name": f["NAMELSAD"], "code": str(f["STCOFIPS"])[-3:], "rate": round(f["Sales_Tax"] / 100, 6)}], None
    return "Virginia Tax locality layer (DetailedCountyforLookupSearchPopup/4, Sales_Tax)", ask


def SC():
    h = Http(1.0)
    CO = "https://gis.state.sc.us/arcgis/rest/services/Geodetic/County_Boundary/FeatureServer/0"
    MU = "https://gis.state.sc.us/arcgis/rest/services/Boundaries_Districts/Municipalities/FeatureServer/0"
    txt = (ROOT / "artifacts/bench/oracles/dl/SC/st500.txt").read_text()
    R = {m[0].strip().upper(): int(m[1]) / 100 for m in re.findall(r"([A-Z][A-Za-z\- ]+?)\s+(\d)%", txt)}
    def ask(p):
        today_only(p["date"])
        co = arc_point(h, CO, p["lon"], p["lat"])
        if len(co) != 1: raise Refuse("not in exactly one county", [f.get("County") for f in co])
        name = (co[0].get("County") or co[0].get("COUNTY_NAM") or "").upper().replace(" COUNTY", "").strip()
        if name not in R: raise Refuse("county not in ST-500", name)
        mu = [f.get("CITY_NAME") for f in arc_point(h, MU, p["lon"], p["lat"])]
        if len(mu) > 1: raise Refuse("in two municipalities", mu)
        rate = R[name]
        parts = [{"name": name, "code": name, "rate": round(rate - 0.06, 6)}]
        if mu and (mu[0] or "").upper() == "MYRTLE BEACH":
            parts.append({"name": "Myrtle Beach", "code": "MYRTLE BEACH", "rate": round(R["HORRY-MYRTLE BEACH"] - rate, 6)})
            rate = R["HORRY-MYRTLE BEACH"]
        return round(rate, 6), [{"name": "South Carolina", "code": "45", "rate": 0.06}, *[x for x in parts if x["rate"]]], {"muni": mu[0] if mu else None}
    return "SCDOR ST-500 (eff. 2026-05-01) county rates x SC RFA county and municipal layers", ask


def MO():
    h = Http(1.2, {"Referer": "https://missouri.atr.avalara.com/", "Accept": "application/json"})
    def ask(p):
        j = h.json(f"https://missouri.atr.avalara.com/api/ssut-taxes/taxes/calculations?latlng={p['lat']},{p['lon']}&effectiveOn={p['date']}")
        rows = [d for d in j.get("data", []) if (d.get("taxCode") or {}).get("name") == "Sales Tax" and d.get("salesTax")]
        totals = {round(d["salesTax"]["total"], 6) for d in rows}
        if len(totals) != 1: raise Refuse(f"{len(totals)} Sales Tax totals", sorted(totals))
        codes = [l["code"] for d in rows for l in d.get("locationCodes", [])]
        return totals.pop(), [], {"codes": codes}
    return "MO DOR Sales and Use Tax Lookup (missouri.atr.avalara.com), latlng and effectiveOn", ask


def epoch(day):
    return datetime.datetime.fromisoformat(day).replace(tzinfo=datetime.timezone.utc).timestamp() * 1000


def NE():
    h = Http(1.0)
    U = "https://gis.ne.gov/agency3/rest/services/SalesTaxWebLayerREV/FeatureServer/0"
    def ask(p):
        d = epoch(p["date"])
        here = [f for f in arc_point(h, U, p["lon"], p["lat"]) if f.get("GLDCode") in (None, "N/A")]
        fs = [f for f in here if (f.get("EffectiveBeginDate") or 0) <= d < (f.get("EffectiveEndDate") or 4e13)]
        # The layer keeps a jurisdiction's current record: one starting after
        # the date says nothing of the rate before it.
        if any((f.get("EffectiveBeginDate") or 0) > d for f in here) and not fs:
            raise Refuse("the layer's record starts after the date")
        totals = {round(f["TotalRate"] / 100, 6) for f in fs}
        if len(totals) > 1: raise Refuse("several totals at the point", sorted(totals))
        rate = totals.pop() if totals else 0.055
        return rate, [], {"areas": [f.get("NAME") for f in fs]}
    return "NE DOR Sales Tax Rate Finder layer (SalesTaxWebLayerREV/0), today's outlines with their rates' effective dates", ask


def SD():
    h = Http(1.0)
    U = "https://sdgis.sd.gov/host/rest/services/Hosted/citys_joined2/FeatureServer/0"
    T = "https://sdgis.sd.gov/host/rest/services/Hosted/Special_Tax_Districts/FeatureServer/0"
    def active(f, d):
        a, e = f.get("activefrom") or 0, f.get("activeto")
        try: e = float(e) if e not in (None, "", "NULL") else None
        except ValueError: e = None
        return a <= d and (e is None or d < e)
    def ask(p):
        d = epoch(p["date"])
        if [f for f in arc_point(h, T, p["lon"], p["lat"]) if active(f, d)]: raise Refuse("in a tribal special tax district: rate depends on the buyer")
        general = [f for f in arc_point(h, U, p["lon"], p["lat"]) if f.get("ratecategory") == "General"]
        fs = [f for f in general if active(f, d)]
        # The layer keeps a city's current General record: one starting
        # after the date says nothing of the rate before it.
        if not fs and any((f.get("activefrom") or 0) > d for f in general):
            raise Refuse("the city's record starts after the date")
        rates = {round(f["rate"], 5) for f in fs}
        if len(rates) > 1: raise Refuse("several General city rates at the point", sorted(rates))
        state = 0.042 if p["date"] >= "2023-07-01" else 0.045
        return round(state + (rates.pop() if rates else 0), 6), [], {"city": fs[0]["cityname"] if fs else None}
    return "SD DOR rate lookup layers (citys_joined2 General rate, Special_Tax_Districts), by active dates", ask


def WI():
    h = Http(1.2, {"Accept": "application/json"})
    def ask(p):
        y, m, dd = p["date"].split("-")
        j = h.json("https://ww2.revenue.wi.gov/VaultExternal/rest/strb/lookup?" + urllib.parse.urlencode(
            {"saleDate": f"{m}/{dd}/{y}", "address": p["street"], "zip": p["zip"][:5]}))
        s = j.get("subject") or {}
        if j.get("result") != "Ok" or not s: raise Refuse(f"STRB: {j.get('result')}")
        if s.get("fullMatch") != "t": raise Refuse("matched by ZIP+9 fallback only")
        g = [b for b in s.get("boundaries", []) if b.get("salesType") == "general"]
        if len(g) != 1: raise Refuse(f"{len(g)} general boundaries")
        return round(float(g[0]["totalRate"].rstrip("%")) / 100, 6), [], {"city": s.get("city"), "fips": s.get("fips")}
    return "WI DOR STRB lookup (ww2.revenue.wi.gov), by address, ZIP and sale date", ask


ORACLES = {"MO": MO, "NE": NE, "SD": SD, "WI": WI, "TX": TX, "CO": lambda: TTR("CO"), "AK": lambda: TTR("AK"), "AZ": AZ, "VA": VA, "SC": SC}


def points(st):
    """The points to label: the state's boundary sample, or a split's cases."""
    if not os.environ.get("BOUNDARY_CASES"):
        yield from csv.DictReader(open(DIR / st / "points.csv")); return
    for c in csv.DictReader(open(os.environ["BOUNDARY_CASES"])):
        if c["state"] != st or not c["lon"]: continue
        key = f"{st}|{c['street'].strip()}|{c['city'].strip()}|{c['zip'].strip()}|{(c.get('date') or TODAY).strip()}"
        yield {**c, "id": hashlib.sha256(key.upper().encode()).hexdigest()[:16], "date": c.get("date") or TODAY}


def main(st):
    out = Path(os.environ.get("BOUNDARY_OUT") or DIR / st / "official.jsonl")
    done = {json.loads(l)["id"] for l in out.read_text().splitlines() if l.strip()} if out.exists() else set()
    oracle, ask = ORACLES[st]()
    n = r = errors = 0
    with open(out, "a") as fh:
        for p in points(st):
            if p["id"] in done: continue
            rec = {"id": p["id"], "state": st, "date": p["date"], "oracle": oracle,
                   "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
            try:
                rate, parts, detail = ask(p)
                rec.update(rate=rate, parts=parts, detail=detail); n += 1
            except Refuse as e:
                rec.update(refused=e.why, detail=e.detail); r += 1
            except Exception as e:
                # Not kept: asked again on the next run.
                print(f"{st} {p['id']}: {type(e).__name__}: {str(e)[:150]}", file=sys.stderr); errors += 1; continue
            fh.write(json.dumps(rec) + "\n"); fh.flush()
    print(f"{st}: labelled {n}, refused {r}, failed {errors} (asked again next run), kept {len(done)} from before")


if __name__ == "__main__":
    main(sys.argv[1].upper())

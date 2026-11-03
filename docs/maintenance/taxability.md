# Taxability rule maintenance

[← Maintenance](cron.md) · Rules: `src/taxability/rules/` · Watch list: `src/taxability/rules/watch.json` · [Data maintenance](../data.md#taxability-rules)

This is the taxability part of the monthly maintenance run ([cron.md](cron.md),
step 1b). It keeps the rules behind the API's `code=` current: it downloads
every page a rule cites and every page on the watch list again, finds what
changed, looks for new guidance, and updates the rules. A change that
passes mechanical gates (`pnpm rates maintain taxability-check`: every
changed rule's quote is on its archived page, the files load, the tests
pass, no benchmark case newly wrong) goes to `main` and into the
month's release; anything short of them goes to a pull request for a
human, and the release keeps `main`'s rules.

Read first: `CLAUDE.md`, [data maintenance](../data.md#taxability-rules),
`src/taxability/codes.ts` (what each code covers), `src/taxability/rules/*.json`
(the rules) and `src/taxability/rules/watch.json` (the pages watched for news).

Every page read while researching rules is filed in the archive, cited or
not ([cron.md](cron.md), Rules): the public archive shows what a rule was
weighed against, not only what it cites.

## Rules

- Official sources only: a tax agency's pages, its statutes, regulations,
  bulletins, notices and rulings. A commercial guide may point you to a page;
  it is never the citation.
- Every rule cites the page it was read from and quotes the sentence that
  settles it, word for word. A change you can't cite isn't made.
- When the evidence can't settle a treatment, the rule says `conditional`
  with the facts it turns on, or the rule isn't written; never guess, and
  never fall back to the general rate.
- Never open `artifacts/taxability/evals/` to write or change a rule: the
  cases are the test. You may run `pnpm bench taxability`; when a case scores
  wrong, read the page it cites (`--list` names the case), and decide from
  the page, not from the case.
- Work in the run's database and `artifacts/maintenance/<run>/`. Rule
  changes reach `main` only past `maintain taxability-check` (step 4).

## One jurisdiction's own rules

Rules are keyed by the tax they cover (`src/taxability/rules/index.ts`):
`"CO"` every part of a Colorado answer, `"CO:local"` its local parts, and
`"CO:local:<part code>"` one local part, where a city or county sets its
own taxability or rate (a Colorado home-rule city). The part code is the
part's `code` in a rate answer (`pnpm rate CO "200 E Colfax Ave" Denver
80203` shows Denver's city part as `01:ttr17`), never its name. Each part
answers to its most specific key with a rule; the others are unchanged. A
one-part `special_rate` is that part's rate alone (Denver's 4.00% on food
and drink replaces its 5.15%). Say in the rule's summary which place it
is, and in its notes that the other parts keep the broader rules. Ingest
warns when a rule names a part code the database's rates don't have.

Known local treatments not yet written as rules (research these next, by
population):

- **Colorado home-rule cities**: Lakewood's grocery treatment (its code is
  on Municode, which refuses scripts); candy and soft drinks in Colorado
  Springs, Thornton, Greeley, Pueblo, Centennial, Broomfield; bakery items
  in most cities; Longmont and Loveland groceries (no official page found;
  Loveland's regulation answers 403); Castle Rock (crgov.com answers 403).
- **Colorado software**: home-rule cities that tax SaaS and downloaded
  software have one-part rules (Denver, Aurora, Boulder, Colorado Springs,
  Fort Collins, Arvada, Westminster, Broomfield; Pueblo and Lakewood in
  part). Not settled: Thornton, Centennial and Greeley (Greeley's page
  names downloaded software as taxable, but only in script-loaded text the
  extractor doesn't read), Lakewood's SaaS and prewritten software,
  Pueblo's SaaS, Aurora's modifications. The state's own change (HB
  26-1223: software, SaaS included, taxable from 2027-01-01) isn't modeled
  yet: read `tax.colorado.gov/sites/default/files/2026-10/SUTT_Computer_Software_Oct_2026.pdf`
  and the act, then end the CO software rules on 2026-12-31.
- **Arizona**: city TPT rates differ by business class. ADOR's rate table
  (`TPT_RATETABLE_ALL_<date>.csv`) has restaurant and bar rates (classes
  011 and 111) and food-for-home-consumption rates (062) per city, but the
  rate data carries only retail (017), so prepared food in Glendale,
  Chandler, Peoria, Goodyear, Surprise, Flagstaff, Yuma and others is
  answered at the retail rate. Load the classes as rates rather than write
  a rule per city.
- **Alabama**: ALDOR's `taxrates.csv` has a grocery (`GROC`) rate per
  locality, lower than the general rate in about 36 places (Mountain Brook,
  Tuscaloosa County, Pelham, Helena and others); not loaded.
- **Illinois**: IDOR's grocery rate file (`grocerymache-current.txt`) gives
  each location's grocery rate after the state's 1% grocery tax ended
  (2026-01-01); not loaded. Chicago's 3% soft drink tax, 0.5% restaurant
  tax and the 1% MPEA food and beverage tax aren't in the rate data.
- **Minnesota**: Minneapolis's 3% Downtown restaurant tax (an area smaller
  than the city, not a part) isn't in the rate data, nor are St. Cloud's
  (no city part in the answer), Mankato's and other cities' food and
  beverage taxes (DOR fact sheet 164S). Duluth's 2.25% food and beverage
  tax has rules on Duluth's city part for food served or sold by bars and
  restaurants (conditional on the seller's $100,000 in yearly sales); its
  hot food and catering aren't settled.
- **Utah**: restaurant food carries a further 1% everywhere (the Tax
  Commission's rate chart); not in the rate data.
- **Virginia**: local meals taxes, run by each locality, aren't in the rate
  data.

## 1. Fetch

```bash
pnpm rates maintain taxability     # artifacts/maintenance/<run>/taxability/sources.txt and sources.json
```

Every cited page and every watched page is downloaded again and filed in
`artifacts/sources/` (a changed page keeps its older copy in `previous/`).
A dated Wayback Machine snapshot never changes, so it is read from the
archive instead; a dropped connection is retried twice before a page
counts as failed.
`sources.txt` lists:

- **CHANGED / NEW**: pages whose text changed, with the lines that are new;
- **QUOTE GONE**: cited sentences no longer on their page, with the rules
  that rest on them;
- **BLOCKED / FAILED**: pages that couldn't be fetched this time (the archived
  copy is kept; nysenate.gov, revenuquebec.ca and princeedwardisland.ca block
  automated fetches).

A page that fails with a certificate error (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`)
usually comes from a server that leaves an intermediate out of its chain.
Download the intermediate its certificate names (`openssl s_client -connect
HOST:443 -servername HOST | openssl x509 -noout -ext authorityInfoAccess`),
check it chains to a trusted root (`openssl verify`), and add it to
`src/taxability/rules/intermediates.pem` with a line saying which site needs it.
Never turn certificate checks off.

A cited page that is gone for good (404, no DNS) keeps its archived copy as
the evidence. Run the link check ([data maintenance](../data.md#links)) with
`--write-offline` so the site says the original is no longer online, and
look for the page's new address before the next rule edit.

A watched CSV or page whose text changes every day without news (a "days
since" column) gets `ignoreColumns` in `watch.json`, as Manitoba's
bulletins list has.

## 2. Discover

1. For each changed watch-list page, read its new lines: a new notice,
   bulletin, ruling or law change. Open each that could touch one of the
   codes (food, catering, software, services, construction, delivery, goods)
   in a researched place.
2. For each QUOTE GONE, open the page and find what replaced the sentence:
   a reworded page, a moved section, or a changed rule.
3. Search the web, once per researched place, for changes announced in the
   last two months or taking effect in the next two quarters ("<state>
   sales tax change effective <year> software", "<province> PST budget
   <year> services"). Follow each hit to the agency's own page.
4. A useful official page that isn't watched (a new notices index, a new
   bulletin series) goes into `watch.json` with a line on why.
5. Some watched pages belong to one legislative session: Newfoundland and
   Labrador's bills (`ga51session1`) and Québec's session index, whose
   session page (`projets-loi-44-1.html` after the 2026 election) should be
   added once it exists. When a new session opens, point the entry at it.

If nothing changed and nothing was announced, record "no taxability
changes" in the report with what you checked, and stop here.

## 3. Update the rules

For each change that affects a rule:

- **A new treatment from a date**: end the old rule the day before (`to`)
  and add a rule from that date, `fromIs: "effective"`, citing the notice.
  A change announced for a future date goes in now: rules carry their dates.
- **A reworded page, same treatment**: update the citation's quote (and URL,
  if the page moved).
- **A new exception or condition**: add it to `conditions`, or make the rule
  `conditional` if the code no longer settles the outcome.
- **Something you couldn't settle**: write it in the rule's `notes` and the
  report; don't change the treatment.

## 4. Check, then apply or propose

```bash
pnpm rates maintain taxability-check    # loads the rules into this run's database, then the gates
```

It loads the rule files into this run's database (filing any newly cited
page in the archive), checks every rule changed since `origin/main`
(`npx tsx src/cli.ts taxability verify`: each citation quotes its page, the page is
archived, the quote is on it; a removed rule fails, for a person to
approve), runs `test/taxability.test.ts`, and scores the benchmark against
the accepted run's: the wrong count can't rise, and no case may be newly
wrong (`taxability score --gate` lists the wrong ids with a fingerprint of
the case set; the accepted run's line is `taxability-wrong:`). If the cases
themselves changed since the accepted run, it stops: a person reviews the
new scores and re-accepts. It ends with `taxability changes pass`, or stops
naming what failed.

- **It passes** (unattended, `MAINT_AUTO_PUBLISH=yes`; attended, with the
  human's approval): commit the rule and watch-list changes, with a message
  listing each change (place, code, old and new treatment, from when, the
  page), to go to `main` with the release log in step 4 of
  [cron.md](cron.md). The release this run publishes carries them.
- **It fails, or something can't be settled**: put the changes on a branch,
  `taxability-<run>`, push it and open a pull request (`gh pr create`) whose
  body lists each change and the page and sentence it rests on, then what
  failed or what you couldn't settle. Put `main`'s rule files back
  (`git checkout origin/main -- src/taxability/rules`) and load them
  (`DATABASE_URL=<run database> pnpm ingest --kind taxability`), so the
  release carries what `main` has.

A watch-list change alone (a new page to watch, a new session's bills page)
needs no gate beyond the files loading.

Write what changed and where it went in
`artifacts/maintenance/<run>/taxability.md`, for the run's report. `pnpm
rates maintain bench` then scores the loaded rules beside the address sets
and marks a rise in wrong answers, or any taxability case newly wrong, as
`REGRESSION`, as for rates; so rules that failed `taxability-check` but stayed
loaded can't be published. A bench that stops partway leaves no `bench.txt`,
and publish needs one.

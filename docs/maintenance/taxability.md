# Taxability rule maintenance

[← Maintenance](cron.md) · Rules: `src/taxability/rules/` · Watch list: `src/taxability/rules/watch.json` · [Data maintenance](../data.md#taxability-rules)

This is the taxability part of the monthly maintenance run ([cron.md](cron.md),
step 1b). It keeps the rules behind the API's `code=` current: it downloads
every page a rule cites and every page on the watch list again, finds what
changed, looks for new guidance, and updates the rules. A change that
passes mechanical gates (`pnpm rates maintain taxability-check`: every
changed rule's quote is on its archived page, the files load, the tests
pass, the benchmark's wrong answers don't rise) goes to `main` and into the
month's release; anything short of them goes to a pull request for a
human, and the release keeps `main`'s rules.

Read first: `CLAUDE.md`, [data maintenance](../data.md#taxability-rules),
`src/taxability/codes.ts` (what each code covers), `src/taxability/rules/*.json`
(the rules) and `src/taxability/rules/watch.json` (the pages watched for news).

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
archived, the quote is on it), runs `test/taxability.test.ts`, and scores
the benchmark against the accepted run's. It ends with `taxability changes
pass`, or stops naming what failed.

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
and marks a rise in wrong answers as `REGRESSION`, as for rates.

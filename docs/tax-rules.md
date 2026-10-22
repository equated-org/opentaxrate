# Tax data and transaction-tax parity

[Data maintenance](data.md) · [Supplemental sources and known gaps](../src/ingest/supplemental-sources.ts)

Local polygon acquisition verified on 2026-10-22: **22 supplemental feeds / 6,915 source polygons**, with three geometry-less records retained as gaps. Transaction-tax policies are documentation only: **no nationwide product-taxability, holiday, cap, or exemption support is implemented or exported**. Partial policy research was moved to a separate local research database; it is not part of public snapshots or API answers.

OpenTaxRate currently answers **an address's general rate on a date**. Matching that rate is different from matching the tax due on an order. Transaction parity needs the same line items, seller/customer facts, sourcing rules and rounding as the comparison service. It must be measured against comparable transaction-calculation endpoints, not a ZIP-rate endpoint.

## What ingestion now stores

`pnpm refresh` and `pnpm ingest` acquire supplemental polygons, validate them against dated codes and rates, and load verified data into the existing lookup tables. To run only that phase:

```sh
pnpm migrate
pnpm ingest                         # supplemental polygons + validated indexing
pnpm ingest WA MN --kind polygons   # selected states
pnpm ingest --source ca-tax-areas   # one polygon source
pnpm reconcile                    # re-index already loaded sources
```

Use `--dir` for saved input files, or `OPENTAXRATE_DOWNLOAD_DIR` for the download archive. These commands write the database selected by `DATABASE_URL`.

| Table | Contents | Used to calculate the returned rate? |
| --- | --- | --- |
| `sales_tax_jurisdiction_rates` | Dated general rates; SST also provides interstate and food/drug rate columns | Yes; food/drug columns do **not** establish whether an item qualifies or is exempt |
| `sales_tax_shapes` | Verified lookup geometry, including supplements; native tax areas have effective dates and an SST area reference where applicable | Yes |
| `tax_source_snapshots` | Content hash, publisher URL, state, observation time and source metadata | Acquisition/reconciliation evidence |
| `tax_source_features` | Downloaded polygons and original identifiers/attributes, linked to immutable snapshots | Ingestion evidence only; lookup reads verified ordinary-table data |
| `tax_rule_rows` | Legacy research storage; its data is excluded from public exports | No; no policy importer is enabled |

Published SST matrices cover the **24 member states**, not all 50 states and DC. They are useful research sources, not a complete national rules engine. Blank answers, missing local coverage, and unsupported categories must never be interpreted as exempt. The removed experimental importer is not a supported command; `pnpm ingest --kind rules` and `--kind all` are rejected. A database constraint also rejects the experimental policy snapshots, including writes from an older running importer.

Repeated identical content reuses a snapshot; changed content preserves its predecessor. Observation time records acquisition, **not legal validity**. Conditional fees, tribal rules, stale rate attributes and civil annexations do not automatically alter the general rate API.

## Supplemental source coverage

| State | New acquisition | Reconciliation status / remaining work |
| --- | --- | --- |
| CA | CDTFA current areas and latest dated TAC/archive edition | 558 latest-quarter TACs approved; historical quarter backfill remains |
| WA | Latest published location-code, city, PTBA and RTA ZIPs | 378 LOCCODE joins approved; 25 held; transit components remain validation only |
| MN | 2026Q4 combined tax areas | 155 component joins approved; two boundary combinations held; follow quarterly publications |
| NE | State/county/city and Good Life district layer | 276 nested component polygons approved; six GLD records held; observation day only |
| IA | Local-option polygons and attribute-only placeholders | Current DOR LOST status sheet; stale rates/dates; missing geometry remains unknown |
| SD | City and special/tribal district layers | 248 general city polygons approved; seven held; 84 ignored; special/tribal excluded; observation day only |
| VT | Town-level local-option areas | 255 sales-rate joins approved; Essex Junction missing GEOID; observation day only |
| TN | Cities, counties, 2026 and 2027 CBIDs | Tax-effective annexations and conditional fee scope |
| AR | Municipal boundaries and change instruments | Legal versus tax-effective annexation dates |
| VA | Native county/city tax layer | Crosscheck against dated workbook, not stale GIS rates |
| WV | Official community boundary layer | Filter incorporated taxing municipalities; not every community levies tax |
| UT | Transit areas | Validation only where transit is already in the total |
| AL | Montgomery police-jurisdiction layer | Local coverage; applicable levy, ordinance and dates |

Existing state adapters still ingest their native sources, including TX, IL, AZ, NM and East Baton Rouge. MO/UT lookup supplements continue through their existing loaders. CA's historical service contains quarters from 2017; normal refresh acquires its **latest edition**, not a complete historical backfill. WA discovery follows actual published dated links, since the live map can lag a quarter. MN's source is explicitly pinned to 2026Q4 and needs a new registry entry when the publisher releases a new service.

Missing statewide exports are recorded in [`SOURCE_ACQUISITION_GAPS`](../src/ingest/supplemental-sources.ts): remaining AL police jurisdictions, KS special districts, LA parishes beyond EBR, FL PointMatch access, current MO districts, remaining IL business-district shapes, and MT/ID/WY resort boundaries. No importer claims those are complete. The audit also identifies rate-change notices, address points and local ordinances requiring separate acquisition work. Montana's stale West Yellowstone rate remains a separate effective-date correction; these acquisition imports do not fix it.

## Rules needed for parity

There is no single complete public national table. Start with [SST's published matrices](https://www.streamlinedsalestax.org/Shared-Pages/State-taxability-matrix), then add state/local legislation and dated agency guidance.

| Capability | Public starting point | What to add to the engine |
| --- | --- | --- |
| Product taxability | SST Library of Definitions; state product/service guidance | Stable category taxonomy, taxable/exempt/conditional treatment, state/local differences, effective periods, citations and exclusions |
| Holidays | SST holiday definitions plus each state's annual announcement | Exact local dates/times, eligible categories, per-item price tests, local participation, business-use exclusions, order/payment rules |
| Price caps and tiers | State statutes and DOR examples | Component-specific bases, per-unit/working-unit grouping, lower/upper tier bounds, exceptions and precise money arithmetic |
| Shipping and discounts | SST administrative definitions and state guidance | Allocation across taxable/exempt lines; seller versus manufacturer discounts; separately stated charges |
| Sourcing | SST/state sourcing rules | Ship-from, ship-to, order/receipt locations, seller locations, intrastate/interstate and pickup/delivery facts |
| Customer exemptions | State exemption rules and certificates | Reason, certificate, scope, expiry and supporting customer facts |
| Seller collection obligation | State nexus and marketplace rules | Seller registrations/obligations and marketplace responsibilities; a zero collection amount is not necessarily an exempt product |
| Special districts and fees | Dated native boundaries plus authorizing rules | Seller-location/product/customer predicates; distinguish additional fees from exemptions or revenue allocation |
| Tax due and reporting | Agency calculation and return instructions | Jurisdiction amounts/codes, per-line or invoice rounding, refunds and adjustments |

The examples below document distinct rule families. This is **not an exhaustive policy inventory**, a supported-policy list, or exported tax data:

| Example | Rule to model | Why a combined rate is insufficient |
| --- | --- | --- |
| [FL discretionary surtax](https://floridarevenue.com/taxes/taxesfees/Pages/sales_tax.aspx) | Generally the first $5,000 per qualifying item; exceptions and working-unit rules | The cap affects county surtax, not the ordinary state component |
| [TN single article](https://revenue.support.tn.gov/hc/en-us/articles/360058138992-SUT-6-Single-Article-Tax-Overview-and-Application) | Qualifying TPP: local base capped at $1,600; extra state 2.75% on the portion above $1,600 through $3,200 | Category and per-article unit price change the taxable bases; services and digital products differ |
| [TN annual holiday](https://www.tn.gov/revenue/taxes/sales-and-use-tax/sales-tax-holiday/sth-traditional.html) | Eligible categories, annual window and per-item thresholds | Exceeding a holiday price limit can disqualify the whole item, rather than exempting the first portion |
| [GA Centennial Yards](https://dor.georgia.gov/document/sut-pb/sut-2023-01/download) | Zone exemptions and infrastructure fee depend on seller and receipt location | A destination polygon alone cannot establish applicability |
| [TN CBID](https://www.tn.gov/revenue/news/2025/9/17/important-notice--central-business-improvement-district-fee-increase.html) | Conditional fee and separately dated district expansions | Future geometry cannot be used before its effective date |
| [WI special local taxes](https://www.revenue.wi.gov/Pages/SSTP/ratebound.aspx) | Premier resort area and local exposition scope | These are absent from ordinary SST files and require business/product facts |
| [NJ UEZ](https://www.nj.gov/treasury/taxation/uezcer.shtml) | Qualifying certified seller and eligible transaction | A point inside the zone does not qualify every sale for reduced tax |

A future executable rule table should have `jurisdiction`, `category`, `rule_kind`, `effective_from/to`, `conditions`, `affected_components`, `taxable_base/tier`, `priority`, `source_snapshot`, `citation`, and `review_status`. Keep holiday eligibility tests distinct from taxable-base caps. Preserve unknown/unsupported cases and conflicting rules explicitly.

Suggested delivery sequence: (1) reconcile native general-tax polygons to dated codes; (2) normalize SST categories and citations; (3) implement line-item calculation with FL/TN cap examples and annual holidays; (4) add sourcing, shipping, exemptions and nexus; (5) test a state/category/date/amount matrix against official examples and comparable vendor transaction endpoints. Filing, registration, certificate management, international VAT and managed compliance are additional products, not achieved by polygon ingestion.

## Completeness required before enabling policies

All 50 states and DC must be accounted for, with applicable local and special jurisdictions. For each rule family and supported transaction/product category, record the legal source, effective interval, exceptions, calculation semantics and verified examples. Distinguish **verified not applicable** from **not researched**. No missing policy may silently fall back to the general rate. A finite, explicit scope and date range is required before claiming completeness; collecting links or ingesting 24 state matrices does not establish it.

The API currently exposes general address rates and the rate variants explicitly present in its underlying rate files. It does not calculate an order's tax, apply holidays/caps, classify products, or validate exemption eligibility. Product-taxability fields and policy rows must remain absent from responses and public exports until implemented and validated across the agreed nationwide scope.

Sales-tax holidays are real statutory exemptions for limited periods and qualifying purchases. They are separate from caps and permanent product exemptions. Examples verified against official 2026 sources:

| State | Official evidence | Why annual verification matters |
| --- | --- | --- |
| TX | [Four annual tax holidays](https://comptroller.texas.gov/taxes/sales/faq/tax-holidays.php); [2026 back-to-school announcement](https://comptroller.texas.gov/about/media-center/news/20260806-huffines-reminder-to-shoppers-texas-sales-tax-holiday-is-aug-7-9-1786024915687) | Different holidays cover different categories; the back-to-school event has per-item limits and payment/layaway rules |
| MA | [Official holiday FAQ](https://www.mass.gov/info-details/sales-tax-holiday-frequently-asked-questions) | The 2026 dates are August 8–9; eligible personal-use purchases and exclusions must be evaluated |
| OH | [Official 2026 holiday](https://tax.ohio.gov/business/sales-and-use-tax/sales-tax-holiday) | Ohio explicitly says the expanded $500-and-under holiday does not apply in 2026; copying prior-year rules would be wrong |

These are examples, not a claim that only these states have holidays. No nationwide holiday list has been verified here. Calculation support for these rules is unimplemented in every state and DC.

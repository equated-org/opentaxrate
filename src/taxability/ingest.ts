/**
 * Loads the taxability rules: the reviewed files (rules/*.json, checked by
 * readRuleFiles) into `taxability_rules`, with every page they cite filed
 * in the raw-source archive (artifacts/sources), so the evidence is backed
 * up and versioned with the rest.
 *
 * The table is replaced whole, in one transaction, so a load is all or
 * nothing and loading the same files twice leaves the same rows. A cited
 * page is fetched once, politely, only when the archive holds no copy of
 * it; a page that can't be fetched is reported, never a reason to drop its
 * rule.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "../db/client.js";
import { salesTaxJurisdictionRates, taxabilityRules } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { copiesByUrl, downloadedBytes, sourcesRoot } from "../ingest/archive.js";
import { challenged, evidenceLink, pdfParagraphs, fileName, pageText, politeFetch, quoteOnPage, trustListedIntermediates } from "./fetch.js";
import { readRuleFiles, type Citation } from "./rules/index.js";
import { pageOf } from "../pdf-text.js";
import { documentText, findMark, hasTextView, markLink, pinnedCopy } from "../evidence-text.js";
import { typeOf } from "../evidence.js";

/** Files every cited page in the archive, fetching one only when the
 *  archive has none. Returns the URLs that couldn't be filed. */
export async function archiveEvidence(urls: string[], options: { fetch?: boolean } = {}): Promise<Array<{ url: string; reason: string }>> {
  const archived = copiesByUrl();
  trustListedIntermediates();
  const missing: Array<{ url: string; reason: string }> = [];
  const lastAsked = new Map<string, number>();
  const refused = new Set<string>();
  for (const url of [...new Set(urls)].sort()) {
    if (archived.has(url)) continue;
    const host = new URL(url).host;
    if (options.fetch === false || refused.has(host)) {
      missing.push({ url, reason: options.fetch === false ? "not archived" : "host refused an earlier page" });
      continue;
    }
    const wait = (lastAsked.get(host) ?? 0) + 1_000 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAsked.set(host, Date.now());
    try {
      const response = await politeFetch(url);
      if (response.status === 403 || response.status === 429) refused.add(host);
      if (!response.ok) throw new Error(`answered ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // A page whose text can't be read can't be checked for its quotes, and
      // a bot challenge answered 200 isn't the page: neither is filed, and a
      // host that challenged isn't asked again this run.
      const text = pageText(bytes);
      if (text === null) throw new Error("its text couldn't be read");
      if (challenged(text)) {
        refused.add(host);
        throw new Error("answered with a challenge page");
      }
      await downloadedBytes(url, new Response(Buffer.from(bytes)), fileName(url, bytes));
    } catch (error) {
      missing.push({ url, reason: (error as Error).message });
    }
  }
  return missing;
}

/** Each citation with the archived copy that shows its quote: the newest
 *  copy of the page whose text has the sentence (an older edition for an
 *  older rule), else the newest copy; none when the page isn't archived.
 *  Its link opens the copy's text view at the quote's mark (#q-…, made from
 *  the same text by src/evidence-text.ts); a text fragment only when the
 *  copy has no text view that holds the quote. */
function pinned(citations: Citation[], copies: ReturnType<typeof copiesByUrl>, textOf: (file: string) => string | null): Citation[] {
  return citations.map((c) => {
    const copy = pinnedCopy(copies.get(c.url) ?? [], c.quote, textOf);
    if (!copy) return c;
    const file = path.join(sourcesRoot(), copy.file);
    // The copy's text as the archive shows it, typed as the catalog types it:
    // an HTML page's, a PDF's or a Word document's (nothing else has a text view).
    const type = typeOf(copy.file, readFileSync(file).subarray(0, 512));
    const text = hasTextView(type) ? documentText(copy.sha256, file, type) : null;
    const mark = text && c.quote && !text.scanned ? findMark(text.pages, c.quote) : null;
    // A PDF's page with the quote, for linking into the PDF itself.
    const page = text && text.kind === undefined && mark ? mark.page : 0;
    if (mark) return { ...c, archived: markLink(copy.sha256, c.quote!), sha256: copy.sha256, ...(page > 0 ? { page } : {}) };
    // No mark: a text fragment, a quote outside one of a PDF's paragraphs
    // linking to its opening words only (a browser won't match across them).
    const inOneParagraph = !text || text.kind === "html" || text.kind === "text" || !c.quote || text.pages.some((pg) => pdfParagraphs(pg).some((para) => quoteOnPage(para, c.quote!)));
    const pdfPage = text && text.kind === undefined && c.quote ? pageOf(text.pages, c.quote, quoteOnPage) : 0;
    return { ...c, archived: evidenceLink(copy.sha256, c.quote, { startOnly: !inOneParagraph }), sha256: copy.sha256, ...(pdfPage > 0 ? { page: pdfPage } : {}) };
  });
}

/** Replaces `taxability_rules` with the rules in `dir`. */
export async function loadTaxabilityRules(options: { dir?: string; fetch?: boolean } = {}) {
  const { rules, files } = readRuleFiles(options.dir);
  const missing = await archiveEvidence(rules.flatMap((r) => r.citations.map((c) => c.url)), { fetch: options.fetch });
  // Read once per file: many rules cite one page.
  const copies = copiesByUrl();
  const texts = new Map<string, string | null>();
  const textOf = (file: string) => {
    if (!texts.has(file)) texts.set(file, pageText(new Uint8Array(readFileSync(path.join(sourcesRoot(), file)))));
    return texts.get(file)!;
  };
  await db.transaction(async (tx) => {
    await tx.delete(taxabilityRules);
    for (let i = 0; i < rules.length; i += 500)
      await tx.insert(taxabilityRules).values(
        rules.slice(i, i + 500).map((r) => ({
          tax: r.tax,
          code: r.code,
          startsOn: r.from,
          endsOn: r.to ?? "9999-12-31",
          fromIs: r.fromIs,
          treatment: r.treatment,
          rate: r.rate ?? null,
          base: r.base ?? null,
          follows: r.follows ?? null,
          summary: r.summary,
          conditions: r.conditions,
          citations: pinned(r.citations, copies, textOf),
          notes: r.notes ?? null,
          file: r.file,
        })),
      );
  });
  for (const f of files) console.log(`${f.file.padEnd(18)} ${String(f.rules).padStart(4)} rules  sha256 ${f.sha256.slice(0, 12)}`);
  console.log(`Loaded ${rules.length} taxability rules from ${files.length} files.`);
  if (missing.length) {
    console.warn(`${missing.length} cited pages aren't in the archive:`);
    for (const m of missing) console.warn(`  ${m.url}  (${m.reason})`);
  }
  for (const unknown of await unknownParts(rules.map((r) => r.tax))) console.warn(`A rule is keyed to part ${unknown}, which this database's rates don't have: check the part's code.`);
  return { rules: rules.length, files, missing };
}

/** The one-part keys ("CO:local:01:ttr17") naming a part code no rate row
 *  of their state has, where the state has rate rows at all (a test
 *  database may have none). */
async function unknownParts(taxes: string[]): Promise<string[]> {
  const unknown: string[] = [];
  for (const tax of new Set(taxes)) {
    const m = /^([A-Z]{2}):local:([^:]+):(.+)$/.exec(tax);
    if (!m) continue;
    const [, state, type, code] = m;
    const [row] = await db
      .select({ any: sql<number>`count(*)::int`, part: sql<number>`count(*) filter (where ${salesTaxJurisdictionRates.type} = ${type} and ${salesTaxJurisdictionRates.code} = ${code})::int` })
      .from(salesTaxJurisdictionRates)
      .where(eq(salesTaxJurisdictionRates.state, state));
    if (row.any > 0 && row.part === 0) unknown.push(tax);
  }
  return unknown;
}

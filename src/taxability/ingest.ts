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
import { db } from "../db/client.js";
import { taxabilityRules } from "../db/schema.js";
import { archivedByUrl, downloadedBytes } from "../ingest/archive.js";
import { fileName, politeFetch, trustListedIntermediates } from "./fetch.js";
import { readRuleFiles } from "./rules/index.js";

/** Files every cited page in the archive, fetching one only when the
 *  archive has none. Returns the URLs that couldn't be filed. */
export async function archiveEvidence(urls: string[], options: { fetch?: boolean } = {}): Promise<Array<{ url: string; reason: string }>> {
  const archived = archivedByUrl();
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
      await downloadedBytes(url, new Response(Buffer.from(bytes)), fileName(url, bytes));
    } catch (error) {
      missing.push({ url, reason: (error as Error).message });
    }
  }
  return missing;
}

/** Replaces `taxability_rules` with the rules in `dir`. */
export async function loadTaxabilityRules(options: { dir?: string; fetch?: boolean } = {}) {
  const { rules, files } = readRuleFiles(options.dir);
  const missing = await archiveEvidence(rules.flatMap((r) => r.citations.map((c) => c.url)), { fetch: options.fetch });
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
          follows: r.follows ?? null,
          summary: r.summary,
          conditions: r.conditions,
          citations: r.citations,
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
  return { rules: rules.length, files, missing };
}

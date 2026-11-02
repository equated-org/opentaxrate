/**
 * The main content of each archived web page the rules cite, for the
 * evidence archive's text view: two models answer only the first and last
 * line numbers of the page's own content, so the view can leave the site's
 * menus out without a word rewritten (src/evidence-crop.ts,
 * docs/data.md#evidence). Brings every copy's text and marks up to date
 * first (src/evidence-text.ts), as `opentaxrate evidence` does.
 *
 *   OPENROUTER_API_KEY=… npx tsx scripts/crop-pages.mts [--budget 3] [--limit N] [--dry-run]
 *
 * Cached by the page's hash in its text record: a monthly run asks only
 * about new pages. Stops starting pages once the spend, with what's still
 * being asked, could pass --budget (US dollars). The key is read from the
 * environment and never written or printed.
 */
import { buildCatalog } from "../src/evidence.js";
import { updateEvidenceTexts } from "../src/evidence-text.js";
import { CROP_MODELS, cropDone, croppable, cropPages, cropSpan, worstCropCost } from "../src/evidence-crop.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const budget = Number(arg("--budget") ?? 3);
const limit = Number(arg("--limit") ?? Infinity);
const dryRun = process.argv.includes("--dry-run");
const key = process.env.OPENROUTER_API_KEY;
if (!key && !dryRun) {
  console.error("Needs OPENROUTER_API_KEY in the environment (docs/data.md#evidence).");
  process.exit(1);
}

const { catalog, files } = await buildCatalog();
const { texts, changed, marks } = updateEvidenceTexts(catalog, files);
console.log(`${texts.size} texts (${changed} made or marked again), ${marks} marks`);
const cited = [...texts.values()].filter((r) => r.kind === "html" && r.marks?.length);
const todo = cited.filter((r) => croppable(r) && !cropDone(r)).slice(0, limit);
const models = Object.keys(CROP_MODELS);
const worst = todo.reduce((sum, r) => sum + models.reduce((s, m) => s + (r.crop?.answers?.some((a) => a.model === m) ? 0 : worstCropCost(r.pages[0].split("\n"), m)), 0), 0);
console.log(
  `${cited.length} cited web pages, ${cited.filter((r) => cropDone(r)).length} already answered by both models, ${cited.filter((r) => !croppable(r)).length} too long or one line; ${todo.length} to ask ${models.join(" and ")} about (at most $${worst.toFixed(3)}); budget $${budget}`,
);
if (dryRun) process.exit(0);

const result = await cropPages(todo, { key: key!, budget, log: (line) => console.log(line) });
const shown = cited.filter((r) => cropSpan(r)?.holdsMarks).length;
console.log(
  `${result.pages} pages answered (${result.asked} questions): ${result.cropped} cropped (${result.holdsMarks} hold every mark), ${result.disagree} where the models' lines don't overlap, ${result.unusable} unusable answers, ${result.failed} failed, ${result.waiting} left${result.stopped ? " (stopped at the budget)" : ""}; spent $${result.spent.toFixed(4)}. ` +
    `${shown} of ${cited.length} cited pages now show a crop.`,
);

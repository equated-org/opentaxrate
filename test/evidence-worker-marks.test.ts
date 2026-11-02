import { afterEach, describe, expect, it, vi } from "vitest";

// The evidence Worker's text views and marks (evidence/worker.js), run
// against a bucket held in memory.
const pdf = "a".repeat(64), web = "b".repeat(64), plain = "c".repeat(64), partly = "d".repeat(64);
const quotes = {
  heated: "Food sold in a heated state is taxable.",
  across: "The sale of prepared food is taxable.",
  pages: "a retail food store sells food for home consumption.",
  overlap: "heated state is taxable. The sale",
  statute: "shall be identical, except as to rate",
  missing: "A quote this copy doesn't have.",
};
const catalog = {
  generatedAt: "2026-11-02T00:00:00Z",
  urls: {
    "https://tax.example.gov/guide.pdf": {
      captures: [{ at: "2026-10-01T00:00:00Z", sha256: pdf, bytes: 10, type: "application/pdf" }],
      citedBy: [quotes.heated, quotes.across, quotes.pages, quotes.overlap, quotes.missing].map((quote, i) => ({ rule: `ZZ c${i} from 2020-01-01`, tax: "ZZ", code: `c${i}`, from: "2020-01-01", quote })),
    },
    "https://law.example.gov/TAX/1210": {
      captures: [{ at: "2026-10-01T00:00:00Z", sha256: web, bytes: 10, type: "text/html; charset=utf-8" }],
      citedBy: [{ rule: "NY goods from 2020-01-01", tax: "NY", code: "goods", from: "2020-01-01", quote: quotes.statute }],
    },
    "https://tax.example.gov/partly-scanned.pdf": { captures: [{ at: "2026-10-01T00:00:00Z", sha256: partly, bytes: 10, type: "application/pdf" }], citedBy: [] },
    "https://law.example.gov/rule.json": {
      captures: [{ at: "2026-10-01T00:00:00Z", sha256: plain, bytes: 10, type: "application/json" }],
      citedBy: [],
    },
  },
};
const page1 = "Title\n\nFood sold in a heated\nstate is taxable. The sale\n\nof prepared food is taxable. Then a retail food";
const page2 = "store sells food for home consumption.\n\nThe end.";
const at = (text: string, s: string) => text.indexOf(s);
const pdfMarks = [
  { id: "q-heated", quote: quotes.heated, page: 1, start: at(page1, "Food sold"), end: at(page1, "taxable.") + 8 },
  { id: "q-across", quote: quotes.across, page: 1, start: at(page1, "The sale"), end: at(page1, "food is taxable.") + 16 },
  { id: "q-overlap", quote: quotes.overlap, page: 1, start: at(page1, "heated\nstate"), end: at(page1, "The sale") + 8 },
  { id: "q-pages", quote: quotes.pages, page: 1, start: at(page1, "a retail food"), end: page1.length + 1 + "store sells food for home consumption.".length },
];
const lines = ["NYS Open Legislation", "Search", "up", "next", "SECTION 1210", "Such taxes shall", "be identical, except as to rate and otherwise.", "Footer"];
const webText = lines.join("\n");
const webRecord = (crop?: { firstLine: number; lastLine: number }) => ({
  sha256: web,
  kind: "html",
  pages: [webText],
  layout: [],
  scanned: false,
  extractedWith: "OpenTaxRate's HTML reader",
  marks: [{ id: "q-statute", quote: quotes.statute, page: 1, start: at(webText, "shall"), end: at(webText, "as to rate") + 10 }],
  ...(crop ? { crop: { ...crop, model: "google/m-one and google/m-two", cost: 0, at: "", answers: [{ model: "google/m-one" }, { model: "google/m-two" }] } } : {}),
});
let web_ = webRecord({ firstLine: 5, lastLine: 7 });
const object = (body: string) => ({ body, json: async () => JSON.parse(body), text: async () => body, httpMetadata: {} });
const env = {
  EVIDENCE: {
    get: async (key: string) => {
      if (key === "catalog.json") return object(JSON.stringify(catalog));
      if (key === `text/${pdf}.json`) return object(JSON.stringify({ sha256: pdf, pages: [page1, page2], layout: [page1, page2], scanned: false, extractedWith: "pdftotext 24.02.0", marks: pdfMarks }));
      if (key === `text/${web}.json`) return object(JSON.stringify(web_));
      if (key === `text/${partly}.json`) return object(JSON.stringify({ sha256: partly, pages: ["Typed page one.", "", "Typed page three."], layout: ["Typed page one.", "", "Typed page three."], scanned: false, extractedWith: "pdftotext 24.02.0" }));
      if (key === `text/${partly}.machine.json`)
        return object(JSON.stringify({ models: ["google/m-one", "google/m-two"], pages: [null, { text: "Scanned page two.", alternate: "Scanned paqe two.", disagreements: [{ a: "page", b: "paqe", start: 8, end: 12 }] }, null] }));
      if (key.startsWith("sha256/")) return object("{}");
      return null;
    },
  },
};
async function go(path: string) {
  vi.stubGlobal("caches", { default: { match: async () => null, put: async () => {} } });
  const worker = (await import("../evidence/worker.js")).default as { fetch: (r: Request, e: unknown, c: unknown) => Promise<Response> };
  return (await worker.fetch(new Request(`https://evidence.test${path}`), env, { waitUntil() {} })).text();
}
afterEach(() => vi.unstubAllGlobals());
/** The page's text as a reader (or a text search) sees it: tags and attributes gone. */
const visible = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, "");

describe("the evidence Worker's marks", () => {
  it("highlights each quote in a PDF's text under its anchor, a paragraph or page break never splitting its id", async () => {
    const html = await go(`/sha256/${pdf}?view=text`);
    // Overlapping quotes are one highlight; the later one's anchor is inside it.
    expect(html).toContain('<mark class="q" id="q-heated">Food sold in a <span class="q-at" id="q-overlap"></span>heated state is taxable. <span class="q-at" id="q-across"></span>The sale<br>of prepared food is taxable.</mark>');
    // A quote over a page break: its id on the first page, the rest highlighted at the next page's start.
    expect(html).toMatch(/<mark class="q" id="q-pages">a retail food<\/mark><\/p><\/div><\/section><section class="pdf-page" id="page-2">.*?<mark class="q">store sells food for home consumption\.<\/mark>/);
    // The header links each marked quote to its anchor in the text view, and an unmarked one to a text fragment.
    expect(html).toContain(`href="/sha256/${pdf}?view=text#q-across"`);
    expect(html).toContain(`href="/sha256/${pdf}#:~:text=`);
  });

  it("draws the header's quotes with CSS, so no text search finds them there", async () => {
    const html = await go(`/sha256/${web}?view=text`);
    expect(html).toContain(`aria-label="“${quotes.statute}”"><span data-q="“${quotes.statute}”"></span>`);
    const header = visible(html.slice(html.indexOf('<section class="about">')));
    expect(header).not.toContain("shall be identical");
    expect(html).toContain('<mark class="q" id="q-statute">shall<br>be identical, except as to rate</mark>');
  });

  it("shows a web page's text cut to the lines the models picked, only when every mark is inside, and all of it on request", async () => {
    web_ = webRecord({ firstLine: 5, lastLine: 7 });
    let html = await go(`/sha256/${web}?view=text`);
    expect(html).toContain("Site navigation trimmed by m-one and m-two (lines 5–7 of the page's 8");
    expect(html).toContain(`?view=text&amp;full=1`);
    expect(visible(html)).not.toContain("NYS Open Legislation");
    expect(html).toContain('<p>SECTION 1210</p><p>Such taxes <mark class="q" id="q-statute">shall<br>be identical, except as to rate</mark> and otherwise.</p></div>');
    html = await go(`/sha256/${web}?view=text&full=1`);
    expect(visible(html)).toContain("NYS Open Legislation");
    expect(html).toContain("its main content only");
    // A crop that leaves a mark out isn't shown.
    web_ = webRecord({ firstLine: 1, lastLine: 5 });
    html = await go(`/sha256/${web}?view=text&x=2`);
    expect(html).not.toContain("Site navigation trimmed");
    expect(html).toContain('id="q-statute"');
    // The readable view is a link away, and stays the default.
    expect(html).toContain(`<a href="/sha256/${web}">Page</a> · <span aria-current="page">Text</span>`);
  });

  it("shows an image-only page of a typed PDF as its machine transcription, labelled, in the text and layout views", async () => {
    for (const view of ["text", "layout"]) {
      const html = await go(`/sha256/${partly}?view=${view}`);
      const two = html.slice(html.indexOf('id="page-2"'), html.indexOf('id="page-3"'));
      expect(two).toContain("Scanned page: machine transcription by m-one and m-two, not reviewed");
      expect(two).toContain('<mark class="disagree">page</mark><span class="alt">[m-two reads “paqe”]</span>');
      expect(two).toContain(`/sha256/${partly}/raw#page=2`);
      expect(html.slice(html.indexOf('id="page-1"'), html.indexOf('id="page-2"'))).not.toContain("machine transcription");
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { archiveResponse, downloadedBytes } from "../src/ingest/archive.js";

// scripts/check-evidence.mts run against a small archive of its own.
let root: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});
const run = (artifacts: string) => {
  try {
    return execFileSync("npx", ["tsx", path.join(import.meta.dirname, "../scripts/check-evidence.mts")], { env: { ...process.env, OPENTAXRATE_DOWNLOAD_DIR: artifacts }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return (error as { stdout: string }).stdout;
  }
};
const line = (out: string, n: number) => out.split("\n").find((l) => new RegExp(`^(PASS|FAIL)  ${n}\\. `).test(l)) ?? "";
const after = (out: string, n: number) => out.split(/\n(?=PASS|FAIL|note)/).find((b) => new RegExp(`^(PASS|FAIL)  ${n}\\. `).test(b)) ?? "";

describe("the evidence completeness check", () => {
  it("fails, never passes with nothing checked, when the benchmark cases aren't beside the sources", async () => {
    root = await mkdtemp(path.join(tmpdir(), "opentaxrate-check-"));
    vi.stubEnv("OPENTAXRATE_DOWNLOAD_DIR", root);
    await downloadedBytes("https://review.example/page.html", new Response("<p>A sentence on the page.</p>"));
    const out = run(root);
    expect(line(out, 4)).toMatch(/^FAIL/);
    expect(after(out, 4)).toContain(path.join(root, "taxability/evals"));
  }, 60_000);

  it("checks each entry's size and each cut-short body's url.txt, and each case's quote on its copies", async () => {
    root = await mkdtemp(path.join(tmpdir(), "opentaxrate-check-"));
    vi.stubEnv("OPENTAXRATE_DOWNLOAD_DIR", root);
    const sources = path.join(root, "sources");
    await downloadedBytes("https://review.example/page.html", new Response("<p>A sentence on the page.</p>"));
    const url = "https://review.example/post";
    const prefix = "x".repeat(2000);
    await archiveResponse({ url, method: "POST", body: `${prefix}one` }, "answer one", "a.json");
    await archiveResponse({ url, method: "POST", body: `${prefix}two` }, "answer two", "a.json");
    // The POST lines lose bodySha256 and their url.txt names another request;
    // the page's line says it is bigger than it is.
    const lines = (await readFile(path.join(sources, "manifest.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
    await writeFile(path.join(sources, "manifest.jsonl"), lines.map(({ bodySha256: _, ...l }, i) => JSON.stringify(i === 0 ? { ...l, bytes: 99999 } : l)).join("\n") + "\n");
    for (const l of lines.slice(1)) await writeFile(path.join(sources, path.dirname(l.file), "url.txt"), `POST https://review.example/other\n${prefix}wrong\n`);
    await mkdir(path.join(root, "taxability/evals"), { recursive: true });
    await mkdir(path.join(root, "taxability/evals-holdout"), { recursive: true });
    await writeFile(path.join(root, "taxability/evals/x.json"), JSON.stringify([
      { id: "x-01", sources: [{ url: "https://review.example/page.html", quote: "A sentence on the page." }] },
      { id: "x-02", sources: [{ url: "https://review.example/page.html", quote: "A sentence that isn't." }] },
    ]));
    const out = run(root);
    expect(line(out, 4)).toBe("PASS  4. every benchmark case's source has a copy: 1 checked");
    expect(line(out, 6)).toMatch(/^FAIL .*1 failing/);
    expect(after(out, 6)).toContain("the manifest says 99999");
    expect(line(out, 8)).toMatch(/^FAIL .*2 checked, 2 failing/);
    expect(after(out, 8)).toContain("url.txt isn't POST https://review.example/post");
    expect(line(out, 12)).toMatch(/^FAIL .*2 checked, 1 failing/);
    expect(after(out, 12)).toContain("x-02");
  }, 60_000);
});

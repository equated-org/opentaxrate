// What the scorers share.

/** One-sided 95% Clopper-Pearson upper bound for k events in n: the wrong
 *  rate we can't rule out, given k wrong answers in n. */
export function upper(k: number, n: number) {
  if (n === 0) return 1;
  // log of n choose j, for every j at once.
  const logChoose: number[] = [0];
  for (let j = 1; j <= n; j++) logChoose[j] = logChoose[j - 1] + Math.log(n - j + 1) - Math.log(j);
  const cdf = (p: number) => {
    let sum = 0;
    for (let j = 0; j <= k; j++) sum += Math.exp(logChoose[j] + j * Math.log(p) + (n - j) * Math.log1p(-p));
    return sum;
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) {
    const m = (lo + hi) / 2;
    if (cdf(m) > 0.05) lo = m; else hi = m;
  }
  return hi;
}

/** Lines of JSON, or none when the file isn't there. */
export const jsonl = <T = any>(file: string, fs: typeof import("node:fs")): T[] =>
  fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

/** A CSV file as rows keyed by its header, quoted cells unquoted. */
export function csv(text: string): Array<Record<string, string>> {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",");
  return lines.map((line) => {
    const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.slice(0, cols.length)
      .map((v) => v.replace(/,$/, "").replace(/^"(.*)"$/s, "$1").replace(/""/g, '"'));
    return Object.fromEntries(cells.map((v, i) => [cols[i], v]));
  });
}

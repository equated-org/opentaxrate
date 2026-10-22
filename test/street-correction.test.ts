import { describe, expect, it } from "vitest";
import { parseStreet } from "../src/address.js";
import { bySpelling, keepsTyped } from "../src/rates/streets/correct.js";

const typed = (line: string) => parseStreet(`1 ${line}`)!;
const filed = (street: string) => parseStreet(`1 ${street}`);

describe("reading a typed street as one the ZIP's file has", () => {
  it("keeps a numbered street's number and a typed direction", () => {
    // Branson, MO 65616: the file has NORTH ST and S 5TH ST, but no N 5th.
    const fifth = typed("North Fifth Street");
    expect(keepsTyped(fifth, filed("NORTH ST"))).toBe(false);
    expect(keepsTyped(fifth, filed("S 5TH ST"))).toBe(false);
    expect(keepsTyped(fifth, filed("N 5TH ST"))).toBe(true);
    expect(keepsTyped(fifth, filed("5TH ST N"))).toBe(true);
  });

  it("lets the file add or leave out a direction, but not turn it or make it the name", () => {
    expect(keepsTyped(typed("Hihg St"), filed("N HIGH ST"))).toBe(true);
    expect(keepsTyped(typed("N Hihg St"), filed("HIGH ST"))).toBe(true);
    expect(keepsTyped(typed("N Hihg St"), filed("S HIGH ST"))).toBe(false);
    expect(keepsTyped(typed("N Elm St"), filed("NORTH ST"))).toBe(false);
  });

  it("still reads a misspelled name", () => {
    expect(bySpelling(typed("Coffe Rd"), ["COFFEY RD", "MAIN ST"])?.street).toBe("COFFEY RD");
  });
});

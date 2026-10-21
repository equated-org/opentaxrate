/**
 * South Carolina: 6% state plus each county's local taxes (local option,
 * capital projects, school district, transportation, education capital
 * improvement), all countywide, and Myrtle Beach's 1% tourism development
 * tax inside its city limits. From the Department of Revenue's ST-500,
 * effective 2026-05-01, which is where coverage starts.
 *
 * Sales on the Catawba Indian Reservation and taxes counties or cities
 * collect themselves aren't in it.
 */
import { stateTable, type LocalRate } from "./tables.js";

const FROM = "2026-05-01";

/** County totals, state's 6% included. */
const COUNTIES: Record<string, number> = {
  Abbeville: 7, Aiken: 8, Allendale: 8, Anderson: 7, Bamberg: 8, Barnwell: 8,
  Beaufort: 6, Berkeley: 9, Calhoun: 8, Charleston: 9, Cherokee: 8,
  Chester: 8, Chesterfield: 8, Clarendon: 7, Colleton: 8, Darlington: 8,
  Dillon: 8, Dorchester: 7, Edgefield: 8, Fairfield: 7, Florence: 8,
  Georgetown: 7, Greenville: 6, Greenwood: 7, Hampton: 7, Horry: 8,
  Jasper: 9, Kershaw: 8, Lancaster: 8, Laurens: 8, Lee: 8, Lexington: 7,
  McCormick: 8, Marion: 8, Marlboro: 8, Newberry: 7, Oconee: 6,
  Orangeburg: 7, Pickens: 7, Richland: 8, Saluda: 8, Spartanburg: 7,
  Sumter: 8, Union: 7, Williamsburg: 8, York: 7,
};

export const southCarolina = stateTable("SC", () => ({
  stateRates: [{ rate: 0.06, from: FROM }],
  locals: [
    ...Object.entries(COUNTIES).map(
      ([name, total]): LocalRate => ({
        name,
        rate: Math.round((total / 100 - 0.06) * 1e6) / 1e6,
        from: FROM,
        type: "00",
      }),
    ),
    { name: "Myrtle Beach", rate: 0.01, from: FROM, type: "01" },
  ],
  source: "SC DOR ST-500 (effective 2026-05-01)",
}));

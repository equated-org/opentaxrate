/**
 * Idaho: 6% state, plus the resort cities that tax general retail sales,
 * from each city's own ordinance (the Tax Commission lists the cities but
 * not their rates; the cities collect). Exemptions vary by city and are the
 * caller's to apply: groceries (Ketchum, McCall, Harrison, Lava Hot
 * Springs), vehicles (Ketchum, McCall, Lava Hot Springs), building
 * materials and auto parts (Lava Hot Springs), and single purchases of
 * $1,000 or more (Bonners Ferry, Ponderay). Cities whose tax is on lodging,
 * food or drink only (Bellevue, Crouch, Hailey, Irwin, Kellogg, Mackay,
 * Salmon, Sandpoint) are left out.
 *
 * Ponderay's tax lapsed for 2025 (its renewal failed) and a new one runs
 * from 2026; Tetonia's began in 2026. Cascade's and Swan Valley's end with
 * 2026 (renewals on the November 3, 2026 ballot), Riggins' on 2027-01-31
 * and Lava Hot Springs' with 2032; Ketchum's base rate is on the November
 * 2026 ballot, so those need the results read before 2027. Each city's
 * page or ordinance is a publication below, so the monthly refresh files
 * it again and reports a change (artifacts/sources/GAPS.md: what isn't online).
 */
import { stateTable } from "./tables.js";

/** [city, general retail rate, first day, last day] */
const RESORT_CITIES: Array<[string, number, string?, string?]> = [
  ["Ketchum", 0.02],
  ["Sun Valley", 0.03],
  ["Stanley", 0.025],
  // Ten years from 2023-01-01 (2022 ballot, Secretary of State canvass 17592).
  ["Lava Hot Springs", 0.02, undefined, "2032-12-31"],
  ["McCall", 0.01],
  ["Cascade", 0.01, undefined, "2026-12-31"],
  ["Donnelly", 0.01],
  // Ten years from 2017-02-01 (2016 ballot, approved 157-57; council minutes).
  ["Riggins", 0.01, undefined, "2027-01-31"],
  ["Ponderay", 0.01, "2026-01-01", "2035-12-31"],
  ["Bonners Ferry", 0.01],
  ["Harrison", 0.01],
  ["Victor", 0.01],
  ["Swan Valley", 0.01, undefined, "2026-12-31"],
  ["Driggs", 0.005],
  ["Tetonia", 0.005, "2026-01-01"],
];

export const idaho = stateTable("ID", () => ({
  // Covered from 2025, the year the city rates were read.
  stateRates: [{ rate: 0.06, from: "2025-01-01" }],
  locals: RESORT_CITIES.map(([name, rate, from = "2025-01-01", to]) => ({
    name,
    rate,
    from,
    to,
    type: "01" as const,
  })),
  source: "ID resort city ordinances, 2026",
  publications: [
    { url: "https://tax.idaho.gov/taxes/sales-use/sales-tax/local-sales-tax/city-sales-tax/", name: "id-city-sales-tax.html" },
    ...[
      "https://ketchumidaho.gov/207/Local-Option-Tax-LOT",
      "https://ketchumidaho.gov/421/Local-Option-Tax-Ballot-Measure",
      "https://sunvalleyidaho.gov/optiontax",
      "https://www.cityofstanleyid.gov/option-tax",
      "https://www.lavahotspringscity.com/city-code",
      "https://www.mccall.id.us/197/Local-Option-Tax",
      "https://cascadeid.us/localoptiontax/",
      "https://cityofdonnelly.org/government/local-option-tax/",
      "https://cityofponderay.org/wp-content/uploads/2023/12/ORDINANCE-150-Local-Option-Sales-Tax.pdf",
      "https://www.bonnersferry.id.gov/193/Local-Option-Tax",
      "https://cityofharrisonid.com/local-option-tax-1",
      "https://www.cityofswanvalley.com/wp-content/uploads/2021/11/ORDINANCE-NO-89-SIGNED-AND-RECORDED.pdf",
      "https://victoridaho.gov/departments/city-treasurer-finance/sales-tax",
      "https://driggsidaho.org/departments/city-clerk/sales-tax/",
      "https://tetoniaidaho.com/documents/117/LOT_Ordinance_2025.05.pdf",
    ].map((url) => ({ url, name: `id-${new URL(url).host.replace(/^www\./, "").split(".")[0]}-${url.split("/").filter(Boolean).at(-1)!.replace(/[^A-Za-z0-9.-]/g, "_")}` })),
  ],
}));

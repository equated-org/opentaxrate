/**
 * New York: each county's combined rate (4% state plus county, and the
 * 0.375% commuter district tax around New York City), and the cities that
 * tax in place of their county, from Publication 718, effective 2025-03-01.
 * Most such cities have their county's rate but their own reporting code;
 * Yonkers's rate is higher. New York City's five counties share its rate.
 *
 * Covers sales from 2025-03-01; earlier rates are in Publication 718-A.
 */
import { stateTable, type LocalRate } from "./tables.js";

const FROM = "2025-03-01";
const STATE = 0.04;

/** [county, combined rate, cities taxing in its place with theirs] */
const COUNTIES: Array<[string, number, Array<[string, number]>?]> = [
  ["Albany", 8], ["Allegany", 8.5], ["Broome", 8],
  ["Cattaraugus", 8, [["Olean", 8], ["Salamanca", 8]]],
  ["Cayuga", 8, [["Auburn", 8]]], ["Chautauqua", 8], ["Chemung", 8],
  ["Chenango", 8, [["Norwich", 8]]], ["Clinton", 8], ["Columbia", 8],
  ["Cortland", 8], ["Delaware", 8], ["Dutchess", 8.125], ["Erie", 8.75],
  ["Essex", 8], ["Franklin", 8],
  ["Fulton", 8, [["Gloversville", 8], ["Johnstown", 8]]],
  ["Genesee", 8], ["Greene", 8], ["Hamilton", 8], ["Herkimer", 8.25],
  ["Jefferson", 8], ["Lewis", 8], ["Livingston", 8],
  ["Madison", 8, [["Oneida", 8]]], ["Monroe", 8], ["Montgomery", 8],
  ["Nassau", 8.625], ["Bronx", 8.875], ["Kings", 8.875], ["New York", 8.875],
  ["Queens", 8.875], ["Richmond", 8.875], ["Niagara", 8],
  ["Oneida", 8.75, [["Rome", 8.75], ["Utica", 8.75]]], ["Onondaga", 8],
  ["Ontario", 7.5], ["Orange", 8.125], ["Orleans", 8],
  ["Oswego", 8, [["Oswego", 8]]], ["Otsego", 8], ["Putnam", 8.375],
  ["Rensselaer", 8], ["Rockland", 8.375],
  ["St. Lawrence", 8, [["Ogdensburg", 8]]],
  ["Saratoga", 7, [["Saratoga Springs", 7]]], ["Schenectady", 8],
  ["Schoharie", 8], ["Schuyler", 8], ["Seneca", 8], ["Steuben", 8],
  ["Suffolk", 8.75], ["Sullivan", 8], ["Tioga", 8],
  ["Tompkins", 8, [["Ithaca", 8]]], ["Ulster", 8],
  ["Warren", 7, [["Glens Falls", 7]]], ["Washington", 7], ["Wayne", 8],
  ["Westchester", 8.375, [["Mount Vernon", 8.375], ["New Rochelle", 8.375], ["White Plains", 8.375], ["Yonkers", 8.875]]],
  ["Wyoming", 8], ["Yates", 8],
];

const local = (percent: number) => Math.round((percent / 100 - STATE) * 1e6) / 1e6;

export const newYork = stateTable("NY", () => ({
  stateRates: [{ rate: STATE, from: FROM }],
  locals: COUNTIES.flatMap(([county, rate, cities = []]): LocalRate[] => [
    { name: county, rate: local(rate), from: FROM, type: "00" },
    ...cities.map(([city, cityRate]): LocalRate => ({
      name: city,
      rate: local(cityRate),
      from: FROM,
      type: "01x",
    })),
  ]),
  source: "NY Publication 718 (effective 2025-03-01)",
  publications: [
    { url: "https://www.tax.ny.gov/pdf/publications/sales/pub718.pdf", name: "pub718.pdf" },
    { url: "https://www.tax.ny.gov/pdf/publications/sales/pub718a.pdf", name: "pub718a.pdf" },
  ],
}));

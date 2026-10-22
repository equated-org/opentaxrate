/**
 * Verified tax areas and held coverage, through the whole range engine
 * with a synthetic Minnesota: state
 * and county make 7%, a special district makes 9%, and no boundary-file area
 * includes the district. Held, 7% must never be the answer; complete and
 * dated, 9% must be.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { client, db } from '../src/db/client.js';
import {
  salesTaxAreas, salesTaxDataReleases, salesTaxJurisdictionRates, salesTaxShapes, salesTaxZipRanges, taxSourceSnapshots,
} from '../src/db/schema.js';
import { loadEvidence } from '../src/ingest/supplemental.js';
import { combination, indexVerifiedPolygons } from '../src/ingest/verify-polygons.js';
import { indexedOutcome, indexedTaxAreas, isBuiltArea } from '../src/rates/range-polygons.js';
import { addressRates, emptyTrace } from '../src/rates/index.js';
import { RateError } from '../src/errors.js';

const span = { startsOn: '2026-10-01', endsOn: '2026-12-31' };
// Loader-numbered ids, below the block built areas use.
const A = 27000901, B = 27000902;
const source = { id: 'mn-tax-areas', state: 'MN', url: 'https://example.test/mn_2026Q4/FeatureServer/0' };
const square = (x0: number, y0: number, x1: number, y1: number): Array<Array<[number, number]>> =>
  [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
const base = { taxst: '27', StFrmal: '6.875%', taxcty: '109', CtyFrmal: '0.125%', TotalFrmal: '7%' };
const district = { ...base, taxsp01: '99001', Spec01Frmal: '2%', TotalFrmal: '9%' };
const features = [
  { id: 'base', attributes: base, rings: square(-120, 38, -119.8, 39) },
  { id: 'district', attributes: district, rings: square(-119.8, 38.2, -119.2, 38.8) },
];
const at = { district: { lon: -119.5, lat: 38.5 }, base: { lon: -119.9, lat: 38.5 },
  none: { lon: -119.1, lat: 38.9 }, nearDistrict: { lon: -119.80005, lat: 38.5 } };
const snapshots: string[] = [];

const rate = (where: { lon: number; lat: number }, date = '2026-10-21', trace = emptyTrace()) =>
  addressRates.at({ state: 'MN', street: '1 Fixture Road', city: 'Fixture', zip: '55999', pickStreet: null,
    locate: async () => ({ ...where, accuracy: 'rooftop' }), trace }, date);
const declined = async (where: { lon: number; lat: number }, date?: string) => {
  const error = await rate(where, date).then(() => null, (e) => e);
  expect(error).toBeInstanceOf(RateError);
  return (error as RateError).message;
};
const index = () => indexVerifiedPolygons({ states: ['MN'], log: () => {} });
const evidence = async (list = features) => snapshots.push((await loadEvidence(source, list, { quarter: '2026Q4' })).id);
const shapes = () => db.select({ fips: salesTaxShapes.fips, areaId: salesTaxShapes.areaId, startsOn: salesTaxShapes.startsOn })
  .from(salesTaxShapes).where(and(eq(salesTaxShapes.state, 'MN'), sql`${salesTaxShapes.file} not like 'tl\\_%'`));
const builtAreas = async () => (await db.select({ id: salesTaxAreas.id }).from(salesTaxAreas).where(eq(salesTaxAreas.state, 'MN')))
  .map((a) => a.id).filter(isBuiltArea);
const setDistrictRate = async (startsOn: string | null) => {
  await db.delete(salesTaxJurisdictionRates).where(and(eq(salesTaxJurisdictionRates.state, 'MN'), eq(salesTaxJurisdictionRates.code, '99001')));
  if (startsOn) await db.insert(salesTaxJurisdictionRates).values({ state: 'MN', type: '63', code: '99001', rate: '.02', startsOn, endsOn: span.endsOn });
};
const releases = () => db.insert(salesTaxDataReleases).values([
  { state: 'MN', kind: 'rates', file: 'MN-fixture-rates', rows: 4 }, { state: 'MN', kind: 'boundaries', file: 'MN-fixture-boundaries', rows: 2 },
]).onConflictDoNothing();
const areas = async () => {
  await db.insert(salesTaxAreas).values([{ id: A, state: 'MN', county: '109', districts: '' }, { id: B, state: 'MN', county: '111', districts: '' }]).onConflictDoNothing();
  await db.delete(salesTaxZipRanges).where(eq(salesTaxZipRanges.state, 'MN'));
  await db.insert(salesTaxZipRanges).values([A, B].map((areaId) => ({ state: 'MN', zip5: '55999', plus4Low: 0, plus4High: 9999, kind: 'zip5', areaId, ...span })));
};

async function clean() {
  await db.delete(salesTaxShapes).where(eq(salesTaxShapes.state, 'MN'));
  await db.delete(salesTaxZipRanges).where(eq(salesTaxZipRanges.state, 'MN'));
  await db.delete(salesTaxAreas).where(eq(salesTaxAreas.state, 'MN'));
  await db.delete(salesTaxJurisdictionRates).where(eq(salesTaxJurisdictionRates.state, 'MN'));
  await db.delete(salesTaxDataReleases).where(eq(salesTaxDataReleases.state, 'MN'));
  await db.delete(taxSourceSnapshots).where(eq(taxSourceSnapshots.source, 'mn-tax-areas'));
}

beforeAll(async () => {
  const [{ name }] = await db.execute<{ name: string }>(sql`select current_database() as name`);
  if (!name.endsWith('_test')) throw new Error('Coverage fixtures require a *_test database');
  await clean();
});
beforeEach(async () => {
  await clean();
  await db.insert(salesTaxJurisdictionRates).values([
    { state: 'MN', type: '45', code: '27', rate: '.06875', ...span },
    { state: 'MN', type: '00', code: '109', rate: '.00125', ...span },
    { state: 'MN', type: '00', code: '111', rate: '.00625', ...span },
  ]);
  await releases();
  await areas();
  // Census county outlines: the ordinary map's fallback.
  for (const [fips, x] of [['109', -120], ['111', -119]] as const)
    await db.execute(sql`insert into sales_tax_shapes(state,kind,fips,name,geom,file)
      values('MN','county',${fips},${`County ${fips}`},st_multi(st_geomfromtext(${`POLYGON((${x} 38,${x + 1} 38,${x + 1} 39,${x} 39,${x} 38))`},4326)),'tl_fixture')`);
});
afterAll(async () => {
  await clean();
  await client.end();
});

describe('a district no boundary-file area includes', () => {
  it('is never answered with the smaller total while its rate is unverified', async () => {
    await evidence();
    await index();
    expect((await shapes()).map((s) => s.fips).sort()).toEqual([`area:${A}:2026-10-01`, 'held:mn-tax-areas:district:2026-10-01']);
    expect(await declined(at.district)).toMatch(/couldn't verify/);
    // Too near held coverage to tell, even after asking for a sharper point.
    expect(await declined(at.nearDistrict)).toMatch(/couldn't verify/);
    // Elsewhere the verified area and the ordinary map still answer.
    expect((await rate(at.base)).rate).toBe(0.07);
    expect((await rate(at.none)).rate).toBe(0.07);
  });

  it('answers the complete rate once every component is dated, with the deciding outline', async () => {
    await setDistrictRate(span.startsOn);
    await evidence();
    await index();
    const built = await builtAreas();
    expect(built).toHaveLength(1);
    // Not among ZIP 55999's candidates, and still reachable.
    const trace = emptyTrace();
    const found = await rate(at.district, '2026-10-21', trace);
    expect(found.rate).toBe(0.09);
    expect(found.match).toBe('map');
    expect(found.source).toContain('mn-tax-areas');
    expect(trace.outlines.find((o) => o.fips === `area:${built[0]}:2026-10-01`)).toMatchObject({ kind: 'district', inside: true, levies: true });
    expect((await shapes()).some((s) => s.fips.startsWith('held:'))).toBe(false);
  });

  it('splits at the district rate effective date', async () => {
    await setDistrictRate('2026-11-15');
    await evidence();
    await index();
    const held = (await shapes()).filter((s) => s.fips.startsWith('held:'));
    expect(held.map((s) => s.startsOn)).toEqual(['2026-10-01']);
    expect(await declined(at.district, '2026-11-14')).toMatch(/couldn't verify/);
    expect((await rate(at.district, '2026-11-15')).rate).toBe(0.09);
  });

  it('reuses its area across features and reruns, and drops it with its outline', async () => {
    await setDistrictRate(span.startsOn);
    await evidence([...features, { id: 'district-2', attributes: district, rings: square(-119.8, 38.85, -119.2, 38.95) }]);
    await index();
    await index();
    const built = await builtAreas();
    expect(built).toHaveLength(1);
    expect((await shapes()).filter((s) => s.areaId === built[0])).toHaveLength(1);
    // The district leaves the source: no orphaned combination stays.
    await evidence([features[0]]);
    await index();
    expect(await builtAreas()).toEqual([]);
  });

  it('keeps held coverage through an area rebuild and a source that cannot be validated', async () => {
    await evidence();
    await index();
    // The loader replaces a state's areas: their outlines go by cascade, held coverage stays.
    await db.delete(salesTaxAreas).where(eq(salesTaxAreas.state, 'MN'));
    expect((await shapes()).filter((s) => s.fips.startsWith('held:'))).toHaveLength(1);
    expect((await shapes()).some((s) => s.fips.startsWith('area:'))).toBe(false);
    // No release loaded: nothing can be validated, and nothing indexed is dropped.
    await db.delete(salesTaxDataReleases).where(eq(salesTaxDataReleases.state, 'MN'));
    const [result] = await index();
    expect(String(result.reason)).toMatch(/previously indexed data retained/);
    expect((await shapes()).filter((s) => s.fips.startsWith('held:'))).toHaveLength(1);
    // Rebuilt and reindexed, the verified area returns; the district stays held.
    await releases();
    await areas();
    await index();
    expect((await rate(at.base)).rate).toBe(0.07);
    expect(await declined(at.district)).toMatch(/couldn't verify/);
  });
});

describe('indexed outcome', () => {
  const row = (fips: string, area: number | null, inside: boolean, edge: number) => ({ fips, area_id: area, file: 'f', inside, edge });
  it('lets held coverage outrank a verified outline it overlaps', () => {
    expect(indexedOutcome([row('area:1:x', 1, true, 500), row('held:s:f:x', null, true, 400)], [1], 15)?.status).toBe('unresolved');
    expect(indexedOutcome([row('area:1:x', 1, true, 500), row('held:s:f:x', null, false, 10)], [1], 15)).toMatchObject({ status: 'near_edge', held: true });
    expect(indexedOutcome([row('area:1:x', 1, true, 500), row('held:s:f:x', null, false, 40)], [1], 15)).toMatchObject({ status: 'verified', areas: [1] });
  });
  it('keeps the ordinary paths where no coverage reaches the point', () => {
    expect(indexedOutcome([], [1], 15)).toBeNull();
    expect(indexedOutcome([row('area:1:x', 1, false, 400)], [1], 15)).toBeNull();
    expect(indexedOutcome([row('area:1:x', 1, true, 10)], [1], 15)).toMatchObject({ status: 'near_edge', held: false });
  });
  it('reaches built areas a ZIP does not list, but not other unlisted areas', () => {
    expect(indexedOutcome([row('area:x', 27900001, true, 500)], [5], 15)).toMatchObject({ areas: [27900001] });
    expect(indexedOutcome([row('area:x', 27000007, true, 500)], [5], 15)).toMatchObject({ areas: [] });
  });
});

describe('combination', () => {
  const rates = new Map([['45:27', .06875], ['00:109', .00125], ['63:99001', .02]]);
  it('builds an area only from complete, dated components', () => {
    expect(combination(new Map([['45:27', .06875], ['00:109', .00125], ['63:99001', .02]]), rates, '27'))
      .toEqual({ county: '109', place: null, districts: '63:99001' });
    // A component missing from the rate file, or at another rate, isn't inferred.
    expect(combination(new Map([['45:27', .06875], ['63:99002', .02]]), rates, '27')).toBeNull();
    expect(combination(new Map([['45:27', .06875], ['63:99001', .025]]), rates, '27')).toBeNull();
    expect(combination(new Map([['00:109', .00125]]), rates, '27')).toBeNull();
  });
});

it('consults nothing before ingestion', async () => {
  expect(await indexedTaxAreas('MN', [A], { ...at.district, accuracy: 'rooftop' }, '2026-10-21')).toBeNull();
  expect(await db.select().from(salesTaxShapes).where(and(eq(salesTaxShapes.state, 'MN'), like(salesTaxShapes.fips, 'held:%')))).toEqual([]);
  expect(await db.select().from(taxSourceSnapshots).where(inArray(taxSourceSnapshots.id, snapshots))).toEqual([]);
});

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, like, sql } from 'drizzle-orm';
import { db, client } from '../src/db/client.js';
import { salesTaxAreas, salesTaxZipRanges, salesTaxDataReleases, salesTaxShapes, salesTaxJurisdictionRates, salesTaxJurisdictions, taxSourceSnapshots } from '../src/db/schema.js';
import { loadEvidence } from '../src/ingest/supplemental.js';
import { indexVerifiedPolygons } from '../src/ingest/verify-polygons.js';
import { californiaIndexedRate } from '../src/rates/california.js';
import { indexedTaxAreas } from '../src/rates/range-polygons.js';
import { addressRates, emptyTrace } from '../src/rates/index.js';
const ids: string[] = [];
const rings: Array<Array<[number,number]>> = [[[-120,38],[-119,38],[-119,39],[-120,39],[-120,38]]];
const point = { lon:-119.5,lat:38.5,accuracy:'rooftop' as const };
const stamp = Date.parse('2026-10-01T00:00:00Z');
const source = {state:'CA',url:'https://example.test/FeatureServer/0',role:'tax-area' as const,note:'fixture'};
beforeAll(async()=>{
  const [{name}] = await db.execute<{name:string}>(sql`select current_database() as name`);
  if (!name.endsWith('_test')) throw new Error('Polygon fixtures require a *_test database');
  const current = await loadEvidence({...source,id:'ca-tax-areas'},[{id:'current',attributes:{RATE:.0875,DateStamp:stamp},rings}],{quarter:'2026Q4'});
  ids.push(current.id);
  const archive = await loadEvidence({...source,id:'ca-tax-history'},[{id:'tac',attributes:{RATE:.0875,TAC_txt:'TEST-TAC',DateStamp:stamp,START_DATE:stamp},rings}],{quarter:'2026Q4'});
  ids.push(archive.id);
  await indexVerifiedPolygons({states:['CA'],log:()=>{}});
});
afterAll(async()=>{
  vi.unstubAllGlobals();
  await db.delete(salesTaxAreas).where(and(eq(salesTaxAreas.state,'CA'),eq(salesTaxAreas.districts,'tac:TEST-TAC')));
  await db.delete(salesTaxShapes).where(and(eq(salesTaxShapes.state,'CA'),like(salesTaxShapes.fips,'held:ca-tax-history:%')));
  await db.delete(salesTaxJurisdictionRates).where(and(eq(salesTaxJurisdictionRates.state,'CA'),eq(salesTaxJurisdictionRates.code,'TEST-TAC')));
  await db.delete(salesTaxJurisdictions).where(and(eq(salesTaxJurisdictions.state,'CA'),eq(salesTaxJurisdictions.code,'TEST-TAC')));
  await db.delete(salesTaxAreas).where(eq(salesTaxAreas.state,'ZZ'));
  if(ids.length) await db.delete(taxSourceSnapshots).where(inArray(taxSourceSnapshots.id,ids));
  await client.end();
});
describe('verified polygons in existing lookup tables',()=>{
  it('serves a dated CA rate offline from the ordinary shapes/rates',async()=>{
    const fetch = vi.fn(async()=>{throw new Error('Unexpected network access');});
    vi.stubGlobal('fetch',fetch);
    const trace = emptyTrace();
    const rate = await addressRates.at({state:'CA',street:'1 Test Street',city:'Fixture',zip:'99999',locate:async()=>point,trace},'2026-10-21');
    expect(rate.rate).toBe(.0875);
    // The deciding outline is traced for display.
    expect(trace.outlines.find(o=>o.name==='CDTFA tax area TEST-TAC')).toMatchObject({kind:'district',fips:expect.stringMatching(/^area:69\d{5}:2026-10-01$/),inside:true,levies:true});
    expect(rate.locationCode).toBe('TEST-TAC');
    expect(rate.match).toBe('map');
    expect(rate.parts.map(p=>[p.code,p.rate])).toEqual([['CA',.0725],['tac:TEST-TAC',.015]]);
    expect(rate.source).toMatch(/^CDTFA indexed tax area TEST-TAC, ca-tax-history /);
    expect(fetch).not.toHaveBeenCalled();
    const [{table}] = await db.execute<{table:string|null}>(sql`select to_regclass('public.tax_source_reconciliations')::text as table`);
    expect(table).toBeNull();
    vi.unstubAllGlobals();
  });
  it('keeps date bounds and uncertainty checks',async()=>{
    expect(await californiaIndexedRate(point,'2027-01-01')).toBeNull();
    expect(await californiaIndexedRate({...point,lon:-119.00001},'2026-10-21')).toEqual({status:'near_edge',held:false});
  });
  it('reruns safely and keeps raw evidence out of lookup dependencies',async()=>{
    await indexVerifiedPolygons({states:['CA'],log:()=>{}});
    expect((await db.select().from(salesTaxShapes).where(and(eq(salesTaxShapes.state,'CA'),eq(salesTaxShapes.name,'CDTFA tax area TEST-TAC'))))).toHaveLength(1);
    // The tax area is an ordinary area built by verification, its district the TAC.
    expect(await db.select().from(salesTaxAreas).where(and(eq(salesTaxAreas.state,'CA'),eq(salesTaxAreas.districts,'tac:TEST-TAC')))).toHaveLength(1);
    // Removing downloaded evidence doesn't remove verified ordinary-table data.
    const [current] = await db.select().from(taxSourceSnapshots).where(eq(taxSourceSnapshots.id,ids[0]));
    await db.delete(taxSourceSnapshots).where(eq(taxSourceSnapshots.id,current.id));
    expect(await californiaIndexedRate(point,'2026-10-21')).toMatchObject({status:'verified',rate:.0875});
    const next = await loadEvidence({...source,id:'ca-tax-areas'},[{id:'current',attributes:{RATE:.09,DateStamp:stamp},rings}],{quarter:'2026Q4'});
    ids.push(next.id);
    // Replacement is validated at ingestion, not by every request.
    // The disagreeing layer holds the area: unresolved, not merely absent.
    await indexVerifiedPolygons({states:['CA'],log:()=>{}});
    expect(await californiaIndexedRate(point,'2026-10-21')).toEqual({status:'unresolved'});
  });
  it('narrows candidates and automatically removes polygons when areas are rebuilt',async()=>{
    const id=99099999;
    await db.insert(salesTaxAreas).values({id,state:'ZZ',districts:''});
    await db.execute(sql`insert into sales_tax_shapes(state,kind,fips,name,geom,file,area_id,starts_on,ends_on)
      values('ZZ','district','area:fixture','fixture',st_multi(st_geomfromtext('POLYGON((-120 38,-119 38,-119 39,-120 39,-120 38))',4326)),'fixture',${id},'2026-10-01','2026-12-31')`);
    expect(await indexedTaxAreas('ZZ',[id],point,'2026-10-21')).toMatchObject({status:'verified',areas:[id]});
    expect(await indexedTaxAreas('ZZ',[123],point,'2026-10-21')).toMatchObject({status:'verified',areas:[]});
    expect(await indexedTaxAreas('ZZ',[id],point,'2027-01-01')).toBeNull();
    expect(await indexedTaxAreas('ZZ',[id],{...point,lon:-119.00001},'2026-10-21')).toMatchObject({status:'near_edge',held:false});
    await db.delete(salesTaxAreas).where(eq(salesTaxAreas.id,id));
    expect(await indexedTaxAreas('ZZ',[id],point,'2026-10-21')).toBeNull();
  });
  it('asks no geocoder in California for a date with no indexed tax area',async()=>{
    const fetch = vi.fn(async()=>new Response(JSON.stringify({taxRateInfo:[{rate:.0775,tac:'LIVE'}],
      geocodeInfo:{matchCodes:['Good'],confidence:'High',calcMethod:'Rooftop'}})));
    vi.stubGlobal('fetch',fetch);
    const locate = vi.fn(async()=>point);
    const rate = await addressRates.at({state:'CA',street:'1 Test Street',city:'Fixture',zip:'99999',locate},'2030-01-02');
    expect(rate.match).toBe('authority');
    expect(locate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

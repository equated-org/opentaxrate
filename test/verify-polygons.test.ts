import { describe, expect, it } from 'vitest';
import { quarterWindow, minnesotaComponents, nebraskaComponents } from '../src/ingest/verify-polygons.js';
const span = { from: '2026-10-01', to: '2026-12-31' };
describe('verifying native source components', () => {
  it('keeps quarter validity bounded, including year end', () => {
    expect(quarterWindow('2026Q4')).toEqual(span);
    expect(quarterWindow('2024Q1')?.to).toBe('2024-03-31');
    expect(quarterWindow('2026Q5')).toBeNull();
  });
  it('uses explicit Minnesota codes and verifies the complete component sum', () => {
    const attrs = { taxst: '27', StFrmal: '6.875%', taxcty: '109', CtyFrmal: '0.5%', taxcity: '54880', CityFrmal: '0.75%', TotalFrmal: '8.125%', sst_code: 'stale' };
    expect([...minnesotaComponents(attrs)!]).toEqual([['45:27', .06875], ['00:109', .005], ['01:54880', .0075]]);
    expect(minnesotaComponents({ ...attrs, StFrmal: '6.875' })).not.toBeNull();
    expect(minnesotaComponents({ ...attrs, TotalFrmal: '8%' })).toBeNull();
    expect(minnesotaComponents({ ...attrs, taxcity: null })).toBeNull();
  });
  it('retains Nebraska state tax in city tiles and checks percent summary units', () => {
    const a = {StateFIPS:'31', StateRate:5.5, CountyFIPS:'N/A', CountyRate:0, CityFIPS:'37000', CityRate:1.5, TotalRate:7};
    expect([...nebraskaComponents(a)!]).toEqual([['45:31',.055],['01:37000',.015]]);
    expect(nebraskaComponents({...a,TotalRate:.07})).toBeNull();
    expect(nebraskaComponents({...a,CityFIPS:'N/A'})).toBeNull();
  });
});

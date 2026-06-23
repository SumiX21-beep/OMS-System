import { haversineKm } from './geo.util';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    expect(haversineKm(40.71, -74.0, 40.71, -74.0)).toBeCloseTo(0, 5);
  });

  it('approximates NYC→LA (~3940 km)', () => {
    const km = haversineKm(40.71, -74.0, 34.05, -118.24);
    expect(km).toBeGreaterThan(3900);
    expect(km).toBeLessThan(4000);
  });

  it('is symmetric', () => {
    const a = haversineKm(41.88, -87.63, 42.36, -71.06);
    const b = haversineKm(42.36, -71.06, 41.88, -87.63);
    expect(a).toBeCloseTo(b, 6);
  });
});

import { computeSeverity, DEFAULT_WEIGHTS, type SeverityInput } from './severity';

const base: SeverityInput = {
  category: 'pothole', immediateDanger: false, blocksRoad: false, exposure: 'vehicles',
  hasPhoto: true, hasDescription: true, reportCount: 1, daysOpen: 0,
};

describe('severity model', () => {
  it('is deterministic for identical input', () => {
    expect(computeSeverity(base)).toEqual(computeSeverity({ ...base }));
  });

  it('sums documented factors', () => {
    const r = computeSeverity(base);
    // 22 category + 6 vehicles + 5 confidence
    expect(r.score).toBe(33);
    expect(r.level).toBe('low');
    expect(r.factors.reduce((s, f) => s + f.points, 0)).toBe(33);
  });

  it('applies a High floor to life-threatening categories', () => {
    const r = computeSeverity({ ...base, category: 'electrical_wire', exposure: 'unknown', hasPhoto: false, hasDescription: false });
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.floors.lifeThreateningCategory);
    expect(['high', 'critical']).toContain(r.level);
  });

  it('makes active open manholes Critical', () => {
    const r = computeSeverity({ ...base, category: 'open_manhole', immediateDanger: true });
    expect(r.level).toBe('critical');
  });

  it('caps report volume so it cannot outweigh a life-threatening hazard', () => {
    const many = computeSeverity({ ...base, category: 'broken_footpath', exposure: 'pedestrians', reportCount: 500 });
    const wire = computeSeverity({ ...base, category: 'electrical_wire', exposure: 'unknown' });
    expect(many.score).toBeLessThan(wire.score);
    expect(many.factors.find((f) => f.key === 'corroboration')?.points).toBe(DEFAULT_WEIGHTS.corroboration.max);
  });

  it('caps the duration factor and clamps to 0–100', () => {
    const r = computeSeverity({ ...base, category: 'electrical_wire', immediateDanger: true, blocksRoad: true, exposure: 'both', reportCount: 50, daysOpen: 9999 });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.factors.find((f) => f.key === 'duration')?.points).toBe(DEFAULT_WEIGHTS.duration.max);
  });
});

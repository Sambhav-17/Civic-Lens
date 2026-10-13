import { makeRef, toCsv } from './format';

describe('format helpers', () => {
  it('creates unique incident references', () => {
    const refs = new Set(Array.from({ length: 500 }, makeRef));
    expect(refs.size).toBe(500);
    for (const r of refs) expect(r).toMatch(/^CL-[A-Z2-9]{6}$/);
  });
  it('escapes CSV and neutralises formula injection', () => {
    const csv = toCsv([{ a: '=HYPERLINK("x")', b: 'hello, world' }]);
    expect(csv).toBe(`a,b\n"'=HYPERLINK(""x"")","hello, world"`);
  });
});

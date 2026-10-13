import { allowedNext, canTransition } from './workflow';

describe('workflow', () => {
  it('blocks citizens and anonymous users from every transition', () => {
    expect(canTransition('reported', 'triaged', 'citizen')).toBe(false);
    expect(canTransition('reported', 'triaged', null)).toBe(false);
  });
  it('lets staff triage but not verify', () => {
    expect(canTransition('reported', 'triaged', 'staff')).toBe(true);
    expect(canTransition('verification_pending', 'verified_resolved', 'staff')).toBe(false);
    expect(canTransition('verification_pending', 'verified_resolved', 'reviewer')).toBe(true);
  });
  it('rejects skipping lifecycle steps', () => {
    expect(canTransition('reported', 'verified_resolved', 'admin')).toBe(false);
    expect(canTransition('reported', 'in_progress', 'admin')).toBe(false);
  });
  it('lists allowed next states per role', () => {
    expect(allowedNext('verified_resolved', 'staff')).toEqual([]);
    expect(allowedNext('verified_resolved', 'reviewer')).toEqual(['reopened']);
  });
});

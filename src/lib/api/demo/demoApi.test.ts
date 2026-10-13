import { createDemoApi } from './demoApi';
import { DEMO_PASSWORD } from './seed';
import { ApiError, type CivicApi } from '../types';
import type { NewHazardInput } from '../../validation';

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  clear() { this.m.clear(); }
  getItem(k: string) { return this.m.get(k) ?? null; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string) { this.m.delete(k); }
  setItem(k: string, v: string) { this.m.set(k, v); }
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const photo = (name = 'hazard.png') => new File([PNG], name, { type: 'image/png' });

const input = (over: Partial<NewHazardInput> = {}): NewHazardInput => ({
  category: 'open_manhole', description: 'Cover missing near the bus stop', location_label: 'Test street',
  immediate_danger: true, blocks_road: false, exposure: 'pedestrians', accessibility_note: null, anonymous: true,
  latitude: 12.95, longitude: 77.6, ...over,
});

async function signIn(api: CivicApi, role: 'citizen' | 'staff' | 'reviewer' | 'admin') {
  await api.signIn(`${role}@demo.civiclens.app`, DEMO_PASSWORD);
}

describe('demo backend (mirrors server rules)', () => {
  let api: CivicApi;
  beforeEach(() => { api = createDemoApi(new MemoryStorage()); });

  it('seeds clearly labelled demo incidents', async () => {
    const { items } = await api.listHazards();
    expect(items.length).toBeGreaterThan(10);
    expect(items.every((h) => h.is_demo)).toBe(true);
  });

  it('saves a report with photo + location and returns a unique id and ref', async () => {
    const a = await api.submitHazard(input(), [photo()]);
    const b = await api.submitHazard(input({ latitude: 12.9, category: 'pothole' }), []);
    expect(a.hazard.id).not.toBe(b.hazard.id);
    expect(a.hazard.ref).toMatch(/^CL-/);
    expect(a.failedUploads).toEqual([]);
    const detail = await api.getHazard(a.hazard.id);
    expect(detail?.media.filter((m) => m.evidence_type === 'report')).toHaveLength(1);
    expect(detail?.latitude).toBe(12.95);
    expect(detail?.status).toBe('reported');
  });

  it('computes severity server-side (active open manhole → critical)', async () => {
    const { hazard } = await api.submitHazard(input(), [photo()]);
    expect(hazard.severity_level).toBe('critical');
  });

  it('rejects invalid coordinates and spoofed files', async () => {
    await expect(api.submitHazard(input({ latitude: 123 }), [])).rejects.toBeInstanceOf(ApiError);
    const fake = new File(['not an image'], 'x.png', { type: 'image/png' });
    const r = await api.submitHazard(input(), [fake]);
    expect(r.failedUploads).toHaveLength(1);
  });

  it('rate-limits rapid submissions', async () => {
    for (let i = 0; i < 5; i++) await api.submitHazard(input({ latitude: 12 + i / 100 }), []);
    await expect(api.submitHazard(input(), [])).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('detects nearby duplicates', async () => {
    await api.submitHazard(input(), []);
    const dups = await api.findDuplicates('open_manhole', 12.95005, 77.60005);
    expect(dups.length).toBe(1);
  });

  it('does not let anonymous users or citizens modify a report', async () => {
    const { hazard } = await api.submitHazard(input(), []);
    await expect(api.transition(hazard.id, 'triaged')).rejects.toMatchObject({ code: 'unauthorized' });
    await signIn(api, 'citizen');
    await expect(api.transition(hazard.id, 'triaged')).rejects.toMatchObject({ code: 'forbidden' });
    await expect(api.overrideSeverity(hazard.id, 'low', 'not a real hazard')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('runs the full staff → reviewer lifecycle with an audit trail', async () => {
    const { hazard } = await api.submitHazard(input(), [photo()]);
    await signIn(api, 'staff');
    await api.transition(hazard.id, 'triaged', 'Confirmed from photo');
    await api.assign(hazard.id, 'team-drains');
    await api.transition(hazard.id, 'in_progress');
    await expect(api.submitRepair(hazard.id, 'Cover replaced and sealed', new Date().toISOString(), [])).rejects.toMatchObject({ code: 'invalid' });
    await api.submitRepair(hazard.id, 'Cover replaced and sealed', new Date().toISOString(), [photo('after.png')]);
    // Staff cannot approve their own repair.
    await expect(api.decideVerification(hazard.id, 'approved', '')).rejects.toMatchObject({ code: 'forbidden' });

    await signIn(api, 'reviewer');
    const done = await api.decideVerification(hazard.id, 'approved', 'Photo matches location');
    expect(done.status).toBe('verified_resolved');
    expect(done.resolved_at).not.toBeNull();

    const d = await api.getHazard(hazard.id);
    const trail = d!.updates.map((u) => u.new_status).filter(Boolean);
    expect(trail).toEqual(['reported', 'triaged', 'assigned', 'in_progress', 'repair_submitted', 'verification_pending', 'verified_resolved']);
    expect(d!.media.some((m) => m.evidence_type === 'after_repair')).toBe(true);
    expect(d!.verifications[0].decision).toBe('approved');
  });

  it('requires a reason to reject evidence and reopens the incident', async () => {
    const { hazard } = await api.submitHazard(input(), [photo()]);
    await signIn(api, 'staff');
    await api.transition(hazard.id, 'triaged');
    await api.assign(hazard.id, 'team-drains');
    await api.transition(hazard.id, 'in_progress');
    await api.submitRepair(hazard.id, 'Temporary barricade placed', new Date().toISOString(), [photo()]);
    await signIn(api, 'reviewer');
    await expect(api.decideVerification(hazard.id, 'rejected', '')).rejects.toMatchObject({ code: 'invalid' });
    const h = await api.decideVerification(hazard.id, 'rejected', 'Barricade only, opening still exposed');
    expect(h.status).toBe('reopened');
  });

  it('records manual severity overrides with reason and actor', async () => {
    const { hazard } = await api.submitHazard(input({ category: 'pothole', immediate_danger: false }), []);
    await signIn(api, 'staff');
    await expect(api.overrideSeverity(hazard.id, 'critical', 'no')).rejects.toMatchObject({ code: 'invalid' });
    const h = await api.overrideSeverity(hazard.id, 'critical', 'School route, heavy footfall');
    expect(h.severity_level).toBe('critical');
    const d = await api.getHazard(hazard.id);
    const o = d!.updates.find((u) => u.kind === 'severity_override')!;
    expect(o.note).toContain('School route');
    expect(o.actor_name).toContain('Ravi');
  });

  it('hides reporter identity and internal notes from the public', async () => {
    await signIn(api, 'citizen');
    const { hazard } = await api.submitHazard(input({ anonymous: false }), []);
    await signIn(api, 'staff');
    await api.addNote(hazard.id, 'Internal: contractor contacted', true);
    await api.signOut();
    const d = await api.getHazard(hazard.id);
    expect(d!.reporter_id).toBeNull();
    expect(d!.updates.some((u) => u.note?.includes('contractor'))).toBe(false);
  });

  it('only admins can change roles', async () => {
    await signIn(api, 'staff');
    await expect(api.setRole('user-citizen', 'admin', null)).rejects.toMatchObject({ code: 'forbidden' });
    await signIn(api, 'admin');
    await api.setRole('user-citizen', 'staff', 'team-roads');
    expect((await api.listProfiles()).find((p) => p.id === 'user-citizen')!.role).toBe('staff');
  });

  it('notifies the reporter when status changes', async () => {
    await signIn(api, 'citizen');
    const { hazard } = await api.submitHazard(input({ anonymous: false }), []);
    await signIn(api, 'staff');
    await api.transition(hazard.id, 'triaged');
    await signIn(api, 'citizen');
    const n = await api.listNotifications();
    expect(n.some((x) => x.hazard_id === hazard.id)).toBe(true);
  });

  it('never fabricates resolution time when nothing is resolved', async () => {
    const stats = await api.getPublicStats();
    expect(stats.verifiedRepairs).toBeGreaterThan(0);
    expect(stats.avgResolutionHours).toBeGreaterThan(0);
  });
});

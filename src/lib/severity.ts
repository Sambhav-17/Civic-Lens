import type { Category, Exposure, SeverityLevel } from './types';

/**
 * CivicLens severity model — transparent, weighted, 0–100.
 *
 * This file is the client-side mirror used for previews and explanations.
 * The authoritative score is computed by the backend (`compute_severity` in
 * supabase/migrations/0002_functions.sql, and the demo backend in demo mode),
 * which reads the same weights. The client never sends a score.
 */
export interface SeverityWeights {
  category: Record<Category, number>;
  immediateDanger: number;
  electricalExposure: number;
  openGround: number;
  exposure: Record<Exposure, number>;
  roadObstruction: number;
  confidence: { photo: number; description: number; max: number };
  corroboration: { perReport: number; max: number };
  duration: { perDay: number; max: number };
  /** Minimum scores ("floors") for life-threatening categories. */
  floors: { lifeThreateningCategory: number; lifeThreateningAndActive: number };
  thresholds: { critical: number; high: number; medium: number };
}

export const DEFAULT_WEIGHTS: SeverityWeights = {
  category: {
    electrical_wire: 50,
    open_manhole: 45,
    drain_cover: 35,
    traffic_signal: 30,
    fallen_tree: 25,
    pothole: 22,
    waterlogging: 20,
    broken_footpath: 15,
    other: 10,
  },
  immediateDanger: 18,
  electricalExposure: 12,
  openGround: 10,
  exposure: { both: 10, pedestrians: 6, vehicles: 6, unknown: 2 },
  roadObstruction: 8,
  confidence: { photo: 4, description: 1, max: 5 },
  corroboration: { perReport: 2, max: 8 },
  duration: { perDay: 0.5, max: 7 },
  floors: { lifeThreateningCategory: 70, lifeThreateningAndActive: 85 },
  thresholds: { critical: 80, high: 60, medium: 35 },
};

export const LIFE_THREATENING: Category[] = ['electrical_wire', 'open_manhole'];
export const OPEN_GROUND: Category[] = ['open_manhole', 'drain_cover'];

export interface SeverityInput {
  category: Category;
  immediateDanger: boolean;
  blocksRoad: boolean;
  exposure: Exposure;
  hasPhoto: boolean;
  hasDescription: boolean;
  /** Number of reports including the original (>= 1). */
  reportCount: number;
  /** Days the hazard has been unresolved. */
  daysOpen: number;
}

export interface SeverityFactor {
  key: string;
  label: string;
  points: number;
}

export interface SeverityResult {
  score: number;
  level: SeverityLevel;
  factors: SeverityFactor[];
  floorApplied: string | null;
}

export function levelFor(score: number, w: SeverityWeights = DEFAULT_WEIGHTS): SeverityLevel {
  if (score >= w.thresholds.critical) return 'critical';
  if (score >= w.thresholds.high) return 'high';
  if (score >= w.thresholds.medium) return 'medium';
  return 'low';
}

export function computeSeverity(input: SeverityInput, w: SeverityWeights = DEFAULT_WEIGHTS): SeverityResult {
  const factors: SeverityFactor[] = [];
  const add = (key: string, label: string, points: number) => {
    const rounded = Math.round(points * 10) / 10;
    if (rounded > 0) factors.push({ key, label, points: rounded });
  };

  add('category', `Category baseline`, w.category[input.category]);
  if (input.immediateDanger) add('danger', 'Actively endangering people', w.immediateDanger);
  if (input.category === 'electrical_wire') add('electrical', 'Electrical exposure', w.electricalExposure);
  if (OPEN_GROUND.includes(input.category)) add('opening', 'Open or unprotected ground opening', w.openGround);
  add('exposure', 'Pedestrian / vehicle exposure', w.exposure[input.exposure]);
  if (input.blocksRoad) add('obstruction', 'Blocks the road', w.roadObstruction);
  add(
    'confidence',
    'Report confidence (evidence)',
    Math.min(w.confidence.max, (input.hasPhoto ? w.confidence.photo : 0) + (input.hasDescription ? w.confidence.description : 0)),
  );
  // Volume is capped so it can never outweigh a life-threatening hazard.
  add('corroboration', 'Independent corroborating reports', Math.min(w.corroboration.max, Math.max(0, input.reportCount - 1) * w.corroboration.perReport));
  add('duration', 'Time unresolved', Math.min(w.duration.max, Math.max(0, input.daysOpen) * w.duration.perDay));

  let score = factors.reduce((s, f) => s + f.points, 0);
  let floorApplied: string | null = null;
  if (LIFE_THREATENING.includes(input.category)) {
    const floor = input.immediateDanger ? w.floors.lifeThreateningAndActive : w.floors.lifeThreateningCategory;
    if (score < floor) {
      floorApplied = input.immediateDanger
        ? 'Life-threatening hazard reported as active — minimum Critical'
        : 'Life-threatening category — minimum High';
      score = floor;
    }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, level: levelFor(score, w), factors, floorApplied };
}

export const SEVERITY_META: Record<SeverityLevel, { label: string; color: string; hex: string; rank: number; glyph: string }> = {
  critical: { label: 'Critical', color: 'text-critical', hex: '#FF4D5A', rank: 4, glyph: '▲▲' },
  high: { label: 'High', color: 'text-safety', hex: '#FF9D42', rank: 3, glyph: '▲' },
  medium: { label: 'Medium', color: 'text-[#F5D04C]', hex: '#F5D04C', rank: 2, glyph: '◆' },
  low: { label: 'Low', color: 'text-cyan', hex: '#36D9FF', rank: 1, glyph: '●' },
};

import {
  CircleDot, Zap, Construction, Footprints, Waves, Grid3x3, TreePine, TrafficCone, TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { Category } from './types';

export const CATEGORY_META: Record<Category, { label: string; short: string; icon: LucideIcon; hint: string; safety?: string }> = {
  open_manhole: {
    label: 'Open manhole', short: 'Manhole', icon: CircleDot,
    hint: 'Uncovered or broken manhole opening',
    safety: 'Keep well clear of the opening, especially in water or low light.',
  },
  electrical_wire: {
    label: 'Exposed or dangling electrical wire', short: 'Live wire', icon: Zap,
    hint: 'Fallen, hanging, sparking or exposed wiring',
    safety: 'Stay at least 10 m away. Never touch or approach wires — assume they are live. Photograph only from a safe distance, or skip the photo.',
  },
  pothole: { label: 'Pothole or damaged road', short: 'Pothole', icon: Construction, hint: 'Craters, cracks or sunken road surface' },
  broken_footpath: { label: 'Broken footpath', short: 'Footpath', icon: Footprints, hint: 'Missing slabs, trip hazards, blocked walkways' },
  waterlogging: {
    label: 'Waterlogging or flooding', short: 'Flooding', icon: Waves,
    hint: 'Standing water covering the road or path',
    safety: 'Avoid walking through floodwater — it may hide open drains or live wires.',
  },
  drain_cover: { label: 'Broken or missing drain cover', short: 'Drain cover', icon: Grid3x3, hint: 'Open or broken storm-drain grate', safety: 'Keep clear of the opening.' },
  fallen_tree: { label: 'Fallen tree or obstruction', short: 'Obstruction', icon: TreePine, hint: 'Trees, branches or debris blocking the way' },
  traffic_signal: { label: 'Damaged traffic signal', short: 'Signal', icon: TrafficCone, hint: 'Signal off, damaged or showing wrong lights' },
  other: { label: 'Other civic hazard', short: 'Other', icon: TriangleAlert, hint: 'Anything else that puts people at risk' },
};

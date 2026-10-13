import { z } from 'zod';
import { CATEGORIES } from './types';

export const coordinatesSchema = z.object({
  latitude: z.number().gte(-90).lte(90).refine((n) => Number.isFinite(n), 'Invalid latitude'),
  longitude: z.number().gte(-180).lte(180).refine((n) => Number.isFinite(n), 'Invalid longitude'),
});

export const newHazardSchema = z
  .object({
    category: z.enum(CATEGORIES, { errorMap: () => ({ message: 'Choose what kind of hazard this is.' }) }),
    description: z.string().trim().max(600, 'Keep the description under 600 characters.'),
    location_label: z.string().trim().max(200).nullable(),
    immediate_danger: z.boolean(),
    blocks_road: z.boolean(),
    exposure: z.enum(['pedestrians', 'vehicles', 'both', 'unknown']),
    accessibility_note: z.string().trim().max(300).nullable(),
    anonymous: z.boolean(),
  })
  .merge(coordinatesSchema);

export type NewHazardInput = z.infer<typeof newHazardSchema>;

export const signInSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const signUpSchema = z.object({
  display_name: z.string().trim().min(2, 'Use at least 2 characters.').max(60),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z
    .string()
    .min(10, 'Use at least 10 characters.')
    .regex(/[A-Za-z]/, 'Include at least one letter.')
    .regex(/[0-9]/, 'Include at least one number.'),
});

export const noteSchema = z.string().trim().min(3, 'Write at least 3 characters.').max(1000);
export const reasonSchema = z.string().trim().min(5, 'Give a reason of at least 5 characters.').max(500);
export const repairSchema = z.object({
  summary: z.string().trim().min(10, 'Describe the repair in at least 10 characters.').max(1000),
  completed_at: z.string().refine((s) => !Number.isNaN(Date.parse(s)) && Date.parse(s) <= Date.now() + 60_000, 'Completion time cannot be in the future.'),
});

export const teamSchema = z.object({
  name: z.string().trim().min(2).max(80),
  service_area: z.string().trim().min(2).max(120),
});

import { isSupabaseConfigured } from '../config';
import { createDemoApi } from './demo/demoApi';
import { createSupabaseApi } from './supabaseApi';
import type { CivicApi } from './types';

export const api: CivicApi = isSupabaseConfigured ? createSupabaseApi() : createDemoApi();
export * from './types';

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import 'dotenv/config';

export const ROOT = path.resolve(import.meta.dirname, '..');

export interface AppConfig {
  profiles: string[];
  search: {
    query: string;
    published_within_days: number;
    min_duration_sec: number;
    max_per_channel?: number;
    exclude_channels?: string[];
    exclude_title_words?: string[];
  };
  rising?: {
    query?: string;
    within_hours?: number;
    min_views?: number;
    max_views?: number;
    min_views_per_hour?: number;
    max_pages?: number;
    exclude_title_words?: string[];
  };
  comment: { min_chars: number; max_chars: number; brand: string };
  limits: { daily_max_comments: number; allow_shorts_post?: boolean };
}

export function loadConfig(): AppConfig {
  const raw = fs.readFileSync(path.join(ROOT, 'config.yaml'), 'utf8');
  return YAML.parse(raw) as AppConfig;
}

export const env = {
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',
  llmProvider: (process.env.LLM_PROVIDER ?? 'auto') as 'auto' | 'claude-code' | 'gemini',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  claudeModel: process.env.CLAUDE_MODEL || 'sonnet',
};

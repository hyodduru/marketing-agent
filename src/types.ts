export interface Video {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
  description: string;
  viewCount: number;
  commentCount: number | null;
  durationSec: number;
  viewsPerHour: number;
  rising?: boolean;
  alreadyCommented?: boolean;
}

export interface Status {
  profiles: string[];
  comment: { min_chars: number; max_chars: number; brand: string };
  dailyMax: number;
  todayCount: number;
  youtubeReady: boolean;
  llmProvider: string;
}

export interface CommentRecord {
  id: string;
  videoId: string;
  videoTitle: string;
  profile: string;
  text: string;
  status: 'running' | 'success' | 'failed';
  error?: string;
  screenshot?: string;
  commentUrl?: string;
  createdAt: string;
  finishedAt?: string;
}

export interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

export interface Draft {
  videoId: string;
  concern: string;
  moments: string[];
  persona: string;
  anchor: string;
  comment: string;
  source: 'transcript' | 'title_description';
  provider: string;
  attempts: number;
  checks: Check[];
  createdAt: string;
}

export interface ProfileInfo {
  name: string;
  loggedIn: boolean;
  checkedAt?: string;
  busy: boolean;
}

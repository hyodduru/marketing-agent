/**
 * YouTube Data API v3 래퍼.
 * 할당량: search.list 100 units, videos.list 1 unit, commentThreads.list 1 unit (하루 10,000 units 무료)
 */
import { env, loadConfig } from './config.js';

const BASE = 'https://www.googleapis.com/youtube/v3';

export interface VideoSummary {
  id: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
  description: string;
  viewCount: number;
  commentCount: number | null; // null = 댓글 사용 중지
  durationSec: number;
  viewsPerHour: number;
}

async function yt<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  if (!env.youtubeApiKey) throw new Error('YOUTUBE_API_KEY 가 .env 에 없습니다.');
  const qs = new URLSearchParams({ ...params, key: env.youtubeApiKey });
  const res = await fetch(`${BASE}/${endpoint}?${qs}`);
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(`YouTube API 오류: ${body?.error?.message ?? res.status}`);
  return body as T;
}

/** ISO8601 기간(PT1H2M3S) → 초 */
export function parseDuration(iso: string) {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
  if (!m) return 0;
  const [, d, h, mi, s] = m.map((x) => Number(x ?? 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

/** 유튜브 링크/ID → 영상 ID */
export function parseVideoId(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1, 12) || null;
    if (u.hostname.endsWith('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return v;
      const m = /\/(?:shorts|embed|live)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[1];
    }
  } catch {
    /* not a URL */
  }
  return null;
}

async function getVideos(ids: string[]): Promise<VideoSummary[]> {
  if (ids.length === 0) return [];
  const data = await yt<any>('videos', {
    part: 'snippet,statistics,contentDetails',
    id: ids.join(','),
    hl: 'ko',
  });
  const now = Date.now();
  return (data.items ?? []).map((v: any): VideoSummary => {
    const hours = Math.max((now - new Date(v.snippet.publishedAt).getTime()) / 3600_000, 0.1);
    const viewCount = Number(v.statistics?.viewCount ?? 0);
    return {
      id: v.id,
      title: v.snippet.title,
      channelTitle: v.snippet.channelTitle,
      publishedAt: v.snippet.publishedAt,
      thumbnail:
        v.snippet.thumbnails?.medium?.url ?? v.snippet.thumbnails?.default?.url ?? '',
      description: v.snippet.description ?? '',
      viewCount,
      commentCount: v.statistics?.commentCount != null ? Number(v.statistics.commentCount) : null,
      durationSec: parseDuration(v.contentDetails?.duration ?? ''),
      viewsPerHour: Math.round(viewCount / hours),
    };
  });
}

export async function getVideo(id: string) {
  const [v] = await getVideos([id]);
  return v ?? null;
}

const hasHangul = (s: string) => /[가-힣]/.test(s);

/** ① 연애 키워드 최신 영상 */
export async function searchLatest(opts?: { withinHours?: number; maxResults?: number }) {
  const cfg = loadConfig().search;
  const withinMs = (opts?.withinHours ?? cfg.published_within_days * 24) * 3600_000;
  const data = await yt<any>('search', {
    part: 'id',
    q: cfg.query,
    type: 'video',
    order: 'date',
    regionCode: 'KR',
    relevanceLanguage: 'ko',
    maxResults: String(Math.min(opts?.maxResults ?? 50, 50)),
    publishedAfter: new Date(Date.now() - withinMs).toISOString(),
  });
  const ids: string[] = (data.items ?? []).map((i: any) => i.id.videoId).filter(Boolean);
  const videos = await getVideos(ids);
  const lc = (x: string) => x.toLowerCase();
  const badCh = (cfg.exclude_channels ?? []).map(lc);
  const badTitle = (cfg.exclude_title_words ?? []).map(lc);
  return videos
    .filter((v) => hasHangul(v.title))
    .filter((v) => !badCh.some((c) => lc(v.channelTitle).includes(c)))
    .filter((v) => !badTitle.some((w) => lc(v.title).includes(w)))
    .filter((v) => v.durationSec >= cfg.min_duration_sec) // 쇼츠 제외
    .filter((v) => v.commentCount !== null) // 댓글 막힌 영상 제외
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
    .filter(perChannel(cfg.max_per_channel ?? 2)); // 한 채널이 목록을 독차지하지 않게
}

function perChannel(max: number) {
  const seen = new Map<string, number>();
  return (v: VideoSummary) => {
    const n = (seen.get(v.channelTitle) ?? 0) + 1;
    seen.set(v.channelTitle, n);
    return n <= max;
  };
}

/** 가점: 뜨기 직전 영상 (조회수 1,000~5,000 · 시간당 150 이상) */
export async function searchRising() {
  const vids = await searchLatest({ withinHours: 48, maxResults: 50 });
  return vids
    .filter((v) => v.viewCount >= 1000 && v.viewCount <= 5000 && v.viewsPerHour >= 150)
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour);
}

/** 인기 댓글 (댓글 생성 맥락용) */
export async function getTopComments(videoId: string, max = 20): Promise<string[]> {
  try {
    const data = await yt<any>('commentThreads', {
      part: 'snippet',
      videoId,
      order: 'relevance',
      maxResults: String(max),
      textFormat: 'plainText',
    });
    return (data.items ?? []).map(
      (t: any) => t.snippet.topLevelComment.snippet.textDisplay as string,
    );
  } catch {
    return [];
  }
}

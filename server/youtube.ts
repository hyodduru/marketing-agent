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
  rising?: boolean; // 실시간 조회수 상승 영상 (가점 조건 충족)
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
/** 드라마 · 예능 회차 클립 ("연애박사 11화", "3회 선공개") — 연애 '고민' 영상이 아님 */
const isEpisodeClip = (title: string) => /\d+\s?(화|회)(?![가-힣])/.test(title);

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
    safeSearch: 'strict',
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
    .filter((v) => !isEpisodeClip(v.title))
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

/**
 * 가점: '연애' 키워드로 뜨기 직전 영상 (조회수 1,000~5,000 · 시간당 150회 이상, 초안까지만)
 *
 * 조회수 ≤ 5,000 이면서 시간당 ≥ 150 이려면 올라온 지 5000/150 ≈ 33시간 이내여야 합니다.
 * 그래서 최근 34시간 영상을 '조회수순'으로 넘기다가, 조회수가 1,000 아래로 내려가면 멈춥니다.
 * (상위 영상은 대부분 5,000회를 넘으므로 여러 페이지를 봐야 함 · 페이지당 약 101 units, 최대 6페이지)
 */
export async function searchRising() {
  const cfg = loadConfig();
  const r = cfg.rising ?? {};
  const minV = r.min_views ?? 1000;
  const maxV = r.max_views ?? 5000;
  const minVph = r.min_views_per_hour ?? 150;
  const withinHours = Math.min(r.within_hours ?? 48, Math.ceil(maxV / minVph) + 1);
  const params = {
    part: 'id',
    q: r.query ?? '연애',
    type: 'video',
    order: 'viewCount',
    regionCode: 'KR',
    relevanceLanguage: 'ko',
    safeSearch: 'strict',
    maxResults: '50',
    publishedAfter: new Date(Date.now() - withinHours * 3600_000).toISOString(),
  };

  const videos: VideoSummary[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < (r.max_pages ?? 6); page++) {
    const data = await yt<any>('search', pageToken ? { ...params, pageToken } : params);
    const ids: string[] = (data.items ?? []).map((i: any) => i.id.videoId).filter(Boolean);
    const batch = await getVideos(ids);
    videos.push(...batch);
    pageToken = data.nextPageToken;
    const lowest = Math.min(...batch.map((v) => v.viewCount));
    if (!pageToken || !batch.length || lowest < minV) break;
  }

  const lc = (x: string) => x.toLowerCase();
  const badCh = (cfg.search.exclude_channels ?? []).map(lc);
  const badTitle = [...(cfg.search.exclude_title_words ?? []), ...(r.exclude_title_words ?? [])].map(lc);
  const seen = new Set<string>();
  return videos
    .filter((v) => !seen.has(v.id) && Boolean(seen.add(v.id))) // 페이지 간 중복 제거
    .filter((v) => hasHangul(v.title))
    .filter((v) => v.commentCount !== null)
    .filter((v) => !badCh.some((c) => lc(v.channelTitle).includes(c)))
    .filter((v) => !badTitle.some((w) => lc(v.title).includes(w)))
    .filter((v) => !isEpisodeClip(v.title))
    .filter((v) => v.viewCount >= minV && v.viewCount <= maxV && v.viewsPerHour >= minVph)
    .sort((a, b) => b.viewsPerHour - a.viewsPerHour);
}

/**
 * ① [영상 불러오기]: 최근 연애 고민 영상 + 실시간 조회수 상승 영상을 한 목록으로.
 * 상승 검색이 실패해도 최근 영상은 보여줍니다.
 */
export async function loadVideos() {
  const [latest, rising] = await Promise.allSettled([searchLatest(), searchRising()]);
  if (latest.status === 'rejected' && rising.status === 'rejected') throw latest.reason;
  const risingList = rising.status === 'fulfilled' ? rising.value : [];
  const risingIds = new Set(risingList.map((v) => v.id));
  const merged = new Map<string, VideoSummary>();
  for (const v of [...(latest.status === 'fulfilled' ? latest.value : []), ...risingList]) {
    merged.set(v.id, { ...v, rising: risingIds.has(v.id) });
  }
  return [...merged.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
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

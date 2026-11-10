/**
 * 유튜브 자막 가져오기 (공식 API는 남의 영상 자막 다운로드를 막아서, 플레이어 정보를 읽습니다).
 * 1순위: 영상 페이지의 '스크립트 표시'를 열어 화면의 자막을 읽음
 * 2순위: 페이지에 실린 자막 정보. 둘 다 없으면 null → 제목·설명으로 대체 (과제 요구사항).
 */
import { readTranscriptFromPage } from './transcript-reader.js';

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

interface Track {
  baseUrl: string;
  languageCode: string;
  kind?: string; // 'asr' = 자동 생성
}

function pickTrack(tracks: Track[]): Track | undefined {
  const ko = tracks.filter((t) => t.languageCode?.startsWith('ko'));
  return ko.find((t) => t.kind !== 'asr') ?? ko[0] ?? tracks[0];
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 10_000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function tracksFromWatchPage(videoId: string): Promise<Track[]> {
  const res = await fetchWithTimeout(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
  });
  const html = await res.text();
  const m = /"captionTracks":(\[.*?\])/.exec(html);
  return m ? (JSON.parse(m[1]) as Track[]) : [];
}

async function downloadTrack(track: Track): Promise<string> {
  const url = track.baseUrl.replace(/&fmt=[^&]*/, '') + '&fmt=json3';
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
  const text = await res.text();
  if (!text.trim()) return '';
  const data = JSON.parse(text) as any;
  return (data.events ?? [])
    .flatMap((e: any) => (e.segs ?? []).map((s: any) => s.utf8 as string))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 너무 긴 자막은 앞·중간·끝을 고르게 잘라 LLM에 넘깁니다 */
function sample(text: string, max = 7000) {
  if (text.length <= max) return text;
  const part = Math.floor(max / 3);
  const mid = Math.floor(text.length / 2 - part / 2);
  return [text.slice(0, part), text.slice(mid, mid + part), text.slice(-part)].join(' … ');
}

export async function getTranscript(videoId: string): Promise<string | null> {
  // 1) 영상 페이지의 '스크립트 표시'를 열어 읽기 (사람이 보는 그대로)
  try {
    const text = await readTranscriptFromPage(videoId);
    if (text) return sample(text);
  } catch (e) {
    console.warn('[자막] 스크립트 표시 읽기 실패:', (e as Error).message);
  }
  // 2) 페이지에 실린 자막 정보 (대부분 비어 있음)
  for (const source of [tracksFromWatchPage]) {
    try {
      const track = pickTrack(await source(videoId));
      if (!track) continue;
      const text = await downloadTrack(track);
      if (text.length > 50) return sample(text);
    } catch (e) {
      console.warn(`[자막] ${source.name} 실패:`, (e as Error).message);
    }
  }
  return null;
}


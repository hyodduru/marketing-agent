/**
 * ② 영상 분석 + 댓글 초안 생성.
 * 1) 자막(없으면 제목·설명) + 인기 댓글 수집
 * 2) AI가 고민 한 줄 · 구체 장면 · 시청자 페르소나를 먼저 정리하고 댓글 작성
 * 3) 코드로 규칙 검증 → 어기면 이유를 붙여 다시 생성 (최대 3회)
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from './config.js';
import { complete, extractJson } from './llm.js';
import { store } from './store.js';
import { getTranscript } from './transcript.js';
import { getTopComments, getVideo, type VideoSummary } from './youtube.js';

export interface Draft {
  videoId: string;
  concern: string; // 영상 속 고민 한 줄
  moments: string[]; // 영상 속 구체 장면·말
  persona: string; // 댓글 다는 시청자
  anchor: string; // 댓글이 짚은 장면 (댓글 안에 그대로 등장)
  comment: string;
  source: 'transcript' | 'title_description';
  provider: string;
  attempts: number;
  checks: Check[];
  createdAt: string;
}

export interface Check {
  ok: boolean;
  label: string;
  detail?: string;
}

/* ---------------- 검증 ---------------- */

const URL_RE = /(https?:\/\/|www\.|\.com\b|\.kr\b|\.net\b|\.co\b)/i;
// 운명원을 직접 이용해 본 것처럼 지어낸 후기 표현
const FAKE_REVIEW_RE =
  /운명원[^.!?~\n]{0,20}(봤는데|봤더니|봤어요|봤음|받아\s?봤|받았는데|받았더니|다녀왔|갔다\s?왔|가봤|해봤|상담\s?받|맞췄|맞더라|맞았|소름|후기)/;
const FIRST_PERSON_USE_RE = /(제가|내가|저도|나도)\s?(운명원에서|운명원\s?가서)/;
// 광고 티 나는 말투
const AD_RE = /(추천(합니다|해요|드려요)|강추|확인해\s?보세요|검색해\s?보세요|링크|DM|문의|할인|이벤트|예약하세요|꼭\s?가보세요)/;

function bigrams(s: string) {
  const t = s.replace(/\s+/g, '');
  const set = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
function similarity(a: string, b: string) {
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  A.forEach((x) => B.has(x) && inter++);
  return inter / Math.max(1, A.size + B.size - inter);
}

export function validate(comment: string, anchor = '', videoId = ''): Check[] {
  const cfg = loadConfig().comment;
  const len = [...comment].length;
  const checks: Check[] = [
    {
      ok: len >= cfg.min_chars && len <= cfg.max_chars,
      label: `${cfg.min_chars}~${cfg.max_chars}자`,
      detail: `${len}자`,
    },
    { ok: comment.includes(cfg.brand), label: `'${cfg.brand}' 언급` },
    { ok: !URL_RE.test(comment), label: '링크 없음' },
    { ok: !comment.includes('#'), label: '해시태그 없음' },
    {
      ok: !FAKE_REVIEW_RE.test(comment) && !FIRST_PERSON_USE_RE.test(comment),
      label: '지어낸 이용 후기 없음',
    },
    { ok: !AD_RE.test(comment), label: '광고 말투 없음' },
  ];
  if (anchor) {
    checks.push({
      ok: comment.includes(anchor),
      label: '영상 속 장면 언급',
      detail: anchor,
    });
  }
  const others = store
    .all()
    .filter((r) => r.videoId !== videoId)
    .map((r) => r.text);
  const maxSim = Math.max(0, ...others.map((o) => similarity(o, comment)));
  checks.push({
    ok: maxSim < 0.45,
    label: '다른 댓글과 다름',
    detail: `유사도 ${(maxSim * 100).toFixed(0)}%`,
  });
  return checks;
}

/* ---------------- 프롬프트 ---------------- */

function buildPrompt(
  v: VideoSummary,
  transcript: string | null,
  topComments: string[],
  pastComments: string[],
  feedback: string[],
) {
  const cfg = loadConfig().comment;
  return `너는 유튜브 연애 영상을 막 다 본 한국인 시청자다. 아래 영상 정보를 읽고 JSON으로만 답해라.

## 해야 할 일
1. 이 영상이 다루는 연애 고민을 한 줄로 정리 (concern)
2. 영상 속 구체적인 장면·말·사례를 2~3개 뽑기 (moments). 자막에 실제로 나온 표현을 짧게 인용.
3. 이 영상을 볼 법한 시청자 페르소나를 한 줄로 정하기 (persona). 예: "썸만 세 번째 끝난 20대 후반 직장인"
4. 그 페르소나로 댓글 작성 (comment)
   - moments 중 하나를 댓글에 꼭 직접 언급하고, 그 언급한 부분을 anchor에 댓글 속 표현 그대로(4~15자) 적기
   - 영상 내용에 공감 → 내 연애 고민·한탄 → "${cfg.brand}" 연애사주가 그렇게 잘 본다던데 한번 보고 싶다는 '궁금함'으로 자연스럽게 마무리
   - ${cfg.min_chars}~${cfg.max_chars}자 (공백 포함). 반말/존댓말 섞인 진짜 유튜브 댓글 말투, ㅠㅠ ㅋㅋ 정도는 OK
   - 금지: 링크, 해시태그, "${cfg.brand}"을 직접 가 봤거나 상담 받아 본 것처럼 쓰는 후기("봤는데 맞더라" 등), "추천합니다/확인해보세요" 같은 광고 말투, 이모지 남발
   - "${cfg.brand}"은 남한테 들은 소문(~라던데, ~래서)으로만 언급

## 좋은 예 (남자심리 분석 영상)
"근데 진짜 남자심리는 알다가도 모르겠다...ㅠㅠ 맨날 연애하면 차이기만 했던 1인. 결국 심리 알기는 개뿔 그냥 인연이면 만나는 것 같아요. 운명원 연애사주가 그렇게 잘 본다던데 나도 언제 짝 만나는지 한번 보고 싶다."

## 영상 정보
제목: ${v.title}
채널: ${v.channelTitle}
설명: ${v.description.slice(0, 1500)}
${transcript ? `자막: ${transcript}` : '자막: (없음) — moments는 제목·설명(챕터 포함)과 아래 인기 댓글이 실제로 언급한 구체적인 내용·사례·대사에서 뽑을 것. 영상에 없는 내용을 지어내지 말 것'}

## 이 영상의 인기 댓글 (말투와 영상 속 장면 파악용, 그대로 베끼지 말 것)
${topComments.slice(0, 20).map((c) => `- ${c.slice(0, 200)}`).join('\n') || '(없음)'}

## 이미 다른 영상에 단 댓글 (비슷하게 쓰지 말 것)
${pastComments.slice(0, 10).map((c) => `- ${c}`).join('\n') || '(없음)'}
${feedback.length ? `\n## 이전 시도에서 어긴 규칙 (반드시 고칠 것)\n${feedback.map((f) => `- ${f}`).join('\n')}` : ''}

## 출력 형식 (JSON만, 설명 금지)
{"concern":"...","moments":["...","..."],"persona":"...","comment":"...","anchor":"..."}`;
}

/* ---------------- 생성 ---------------- */

const CACHE = path.join(ROOT, 'data', 'drafts.json');
function readCache(): Record<string, Draft> {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}
function saveDraft(d: Draft) {
  const all = readCache();
  all[d.videoId] = d;
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(all, null, 2));
}
export function getCachedDraft(videoId: string): Draft | null {
  return readCache()[videoId] ?? null;
}

export async function generateDraft(
  videoId: string,
  onStep: (step: string) => void = () => {},
): Promise<Draft> {
  onStep('영상 정보 읽는 중');
  const video = await getVideo(videoId);
  if (!video) throw new Error('영상을 찾을 수 없습니다.');

  onStep('자막·인기 댓글 읽는 중');
  const [transcript, topComments] = await Promise.all([
    getTranscript(videoId),
    getTopComments(videoId),
  ]);
  const pastComments = store.all().map((r) => r.text);

  let feedback: string[] = [];
  let best: Draft | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    onStep(attempt === 1 ? '고민 정리 · 댓글 쓰는 중' : `규칙에 맞게 다시 쓰는 중 (${attempt}/3)`);
    const { text, provider } = await complete(
      buildPrompt(video, transcript, topComments, pastComments, feedback),
    );
    fs.writeFileSync(path.join(ROOT, 'data', 'last_llm.txt'), `[${provider}]\n${text}`);
    let out: { concern: string; moments: string[]; persona: string; comment: string; anchor: string };
    try {
      out = extractJson(text);
      if (!out.comment) throw new Error('comment 없음');
    } catch {
      feedback = ['지난 답은 JSON 형식이 아니었다. 다른 말 없이 JSON 객체 하나만 출력할 것'];
      continue;
    }
    const comment = out.comment.trim().replace(/^["“]|["”]$/g, '');
    const checks = validate(comment, out.anchor, videoId);
    const draft: Draft = {
      videoId,
      concern: out.concern,
      moments: out.moments ?? [],
      persona: out.persona,
      anchor: out.anchor,
      comment,
      source: transcript ? 'transcript' : 'title_description',
      provider,
      attempts: attempt,
      checks,
      createdAt: new Date().toISOString(),
    };
    const failed = checks.filter((c) => !c.ok);
    if (!best || failed.length < best.checks.filter((c) => !c.ok).length) best = draft;
    if (failed.length === 0) break;
    feedback = failed.map((c) => `${c.label}${c.detail ? ` (${c.detail})` : ''}`);
  }
  if (!best) throw new Error('AI가 올바른 형식으로 답하지 않았어요. 다시 생성해 주세요.');
  saveDraft(best);
  return best;
}

/**
 * 게시 작업 관리 + 운영 규칙 강제 (영상당 1개 · 하루 상한 · 프로필 배정).
 */
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.js';
import { validate } from './comment.js';
import { isBusy, listProfiles } from './profiles.js';
import { postComment, PostError, type PostStep } from './poster.js';
import { kstDate, store } from './store.js';

export interface JobEvent {
  type: 'step' | 'done' | 'fail';
  step?: PostStep;
  message?: string;
  commentUrl?: string;
  screenshot?: string;
}

interface Job {
  id: string;
  events: JobEvent[];
  emitter: EventEmitter;
  finished: boolean;
}

export const SHORTS_MAX_SEC = 180;

const jobs = new Map<string, Job>();
let running = false;

export function getJob(id: string) {
  return jobs.get(id);
}

/** 자동 배정: 로그인된 프로필 중 오늘 가장 적게 쓴 프로필 (같으면 설정 순서) */
export function pickProfile(): string {
  const today = kstDate();
  const counts = new Map<string, number>();
  store
    .all()
    .filter((r) => r.status !== 'failed' && kstDate(r.createdAt) === today)
    .forEach((r) => counts.set(r.profile, (counts.get(r.profile) ?? 0) + 1));
  const candidates = listProfiles().filter((p) => p.loggedIn && !p.busy);
  if (candidates.length === 0) throw new Error('로그인된 프로필이 없어요. ③에서 [로그인하기]를 먼저 해주세요.');
  candidates.sort((a, b) => (counts.get(a.name) ?? 0) - (counts.get(b.name) ?? 0));
  return candidates[0].name;
}

export function startPost(input: {
  videoId: string;
  videoTitle: string;
  text: string;
  profile: string;
  durationSec?: number;
}) {
  const cfg = loadConfig();
  const text = input.text.trim();

  // ── 운영 규칙: UI가 아니라 서버에서 막습니다 ──
  if (running) throw new Error('다른 댓글을 게시하는 중이에요. 끝난 뒤 다시 눌러주세요.');
  if (!cfg.limits.allow_shorts_post && input.durationSec !== undefined && input.durationSec <= SHORTS_MAX_SEC)
    throw new Error('쇼츠는 초안까지만 지원해요 (댓글 창 구조가 달라 게시는 막아 두었어요).');
  const failed = validate(text, '', input.videoId).filter((c) => !c.ok && c.label !== '다른 댓글과 다름');
  if (failed.length) throw new Error(`댓글 규칙 위반: ${failed.map((c) => c.label).join(', ')}`);
  if (store.findActiveForVideo(input.videoId)) throw new Error('이 영상에는 이미 댓글을 달았어요 (영상당 1개).');
  if (store.countToday() >= cfg.limits.daily_max_comments)
    throw new Error(`오늘 게시 상한(${cfg.limits.daily_max_comments}개)에 도달했어요.`);

  const profile = input.profile === 'auto' ? pickProfile() : input.profile;
  if (!cfg.profiles.includes(profile)) throw new Error(`설정에 없는 프로필: ${profile}`);
  if (isBusy(profile)) throw new Error(`${profile} 프로필이 사용 중이에요.`);

  const job: Job = { id: randomUUID().slice(0, 8), events: [], emitter: new EventEmitter(), finished: false };
  jobs.set(job.id, job);
  const emit = (e: JobEvent) => {
    job.events.push(e);
    job.emitter.emit('event', e);
  };

  store.insert({
    id: job.id,
    videoId: input.videoId,
    videoTitle: input.videoTitle,
    profile,
    text,
    status: 'running',
    createdAt: new Date().toISOString(),
  });

  running = true;
  postComment({ profile, videoId: input.videoId, text, jobId: job.id, onStep: (step) => emit({ type: 'step', step }) })
    .then(({ commentUrl }) => {
      store.update(job.id, { status: 'success', commentUrl, finishedAt: new Date().toISOString() });
      emit({ type: 'done', commentUrl });
    })
    .catch((e: PostError) => {
      store.update(job.id, {
        status: 'failed',
        error: e.message,
        screenshot: e.screenshot,
        finishedAt: new Date().toISOString(),
      });
      emit({ type: 'fail', message: e.message, screenshot: e.screenshot });
    })
    .finally(() => {
      running = false;
      job.finished = true;
    });

  return { jobId: job.id, profile };
}

/**
 * 댓글 기록 저장소 (data/comments.json).
 * 운영 규칙(영상당 1개, 하루 상한)은 UI가 아니라 여기서 강제합니다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';

export type CommentStatus = 'running' | 'success' | 'failed';

export interface CommentRecord {
  id: string;
  videoId: string;
  videoTitle: string;
  profile: string;
  text: string;
  status: CommentStatus;
  error?: string;
  screenshot?: string; // /screenshots/xxx.png
  commentUrl?: string;
  createdAt: string; // ISO
  finishedAt?: string;
}

const DATA_DIR = path.join(ROOT, 'data');
const FILE = path.join(DATA_DIR, 'comments.json');

function read(): CommentRecord[] {
  if (!fs.existsSync(FILE)) return [];
  return JSON.parse(fs.readFileSync(FILE, 'utf8')) as CommentRecord[];
}

function write(records: CommentRecord[]) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
  fs.renameSync(tmp, FILE);
}

/** 한국 시간 기준 날짜 문자열 (YYYY-MM-DD) */
export function kstDate(iso: string | Date = new Date()) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export const store = {
  all(): CommentRecord[] {
    return read().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  /** 이 영상에 이미 성공했거나 진행 중인 댓글 */
  findActiveForVideo(videoId: string) {
    return read().find((r) => r.videoId === videoId && r.status !== 'failed');
  },

  /** 오늘(KST) 게시 시도 수 — 성공 + 진행 중 */
  countToday() {
    const today = kstDate();
    return read().filter((r) => r.status !== 'failed' && kstDate(r.createdAt) === today).length;
  },

  insert(rec: CommentRecord) {
    const all = read();
    all.push(rec);
    write(all);
  },

  update(id: string, patch: Partial<CommentRecord>) {
    const all = read();
    const i = all.findIndex((r) => r.id === id);
    if (i >= 0) {
      all[i] = { ...all[i], ...patch };
      write(all);
    }
  },
};

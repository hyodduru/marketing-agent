/**
 * 크롬 프로필 관리.
 * - 평소 쓰는 기본 프로필은 자동 제어가 막혀 있으므로 profiles/<이름> 폴더를 따로 씁니다.
 * - 첫 로그인은 '일반 크롬'으로 그 폴더를 열어 사람이 직접 합니다 (비밀번호는 코드가 다루지 않음).
 * - 로그인 여부는 Playwright로 같은 폴더를 잠깐 열어 유튜브 로그인 쿠키가 있는지 확인합니다.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { loadConfig, ROOT } from './config.js';
import { chromePath, KEEP_REAL_KEYCHAIN } from './chrome.js';

const PROFILE_ROOT = path.join(ROOT, 'profiles');

export interface ProfileInfo {
  name: string;
  loggedIn: boolean;
  checkedAt?: string;
  busy: boolean;
}

const busy = new Set<string>();
export const isBusy = (name: string) => busy.has(name);
export function lockProfile(name: string) {
  if (busy.has(name)) throw new Error(`${name} 프로필이 이미 사용 중이에요.`);
  busy.add(name);
  return () => busy.delete(name);
}

export function profileDir(name: string) {
  if (!loadConfig().profiles.includes(name)) throw new Error(`설정에 없는 프로필: ${name}`);
  return path.join(PROFILE_ROOT, name);
}

const markerPath = (name: string) => path.join(profileDir(name), '.agent-login.json');

function readMarker(name: string): { loggedIn: boolean; checkedAt: string } | null {
  try {
    return JSON.parse(fs.readFileSync(markerPath(name), 'utf8'));
  } catch {
    return null;
  }
}

export function writeMarker(name: string, loggedIn: boolean) {
  fs.mkdirSync(profileDir(name), { recursive: true });
  fs.writeFileSync(markerPath(name), JSON.stringify({ loggedIn, checkedAt: new Date().toISOString() }));
}

export function listProfiles(): ProfileInfo[] {
  return loadConfig().profiles.map((name) => {
    const m = readMarker(name);
    return { name, loggedIn: Boolean(m?.loggedIn), checkedAt: m?.checkedAt, busy: busy.has(name) };
  });
}

/** 같은 프로필 폴더를 잠깐 열어 유튜브 로그인 쿠키 확인 */
export async function checkLogin(name: string): Promise<boolean> {
  const ctx = await chromium.launchPersistentContext(profileDir(name), {
    executablePath: chromePath(),
    ignoreDefaultArgs: KEEP_REAL_KEYCHAIN,
    headless: true,
  });
  try {
    const page = await ctx.newPage();
    await page.goto('https://www.youtube.com/?hl=ko', { waitUntil: 'domcontentloaded' });
    const cookies = await ctx.cookies('https://www.youtube.com');
    const loggedIn = cookies.some((c) => c.name === 'LOGIN_INFO' || c.name === 'SAPISID');
    writeMarker(name, loggedIn);
    return loggedIn;
  } finally {
    await ctx.close();
  }
}

/** 일반 크롬으로 프로필을 열어 사용자가 직접 로그인 → 창을 닫으면 로그인 확인 */
export function openForLogin(name: string): Promise<boolean> {
  const release = lockProfile(name);
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  let bin: string;
  try {
    bin = chromePath();
  } catch (e) {
    release();
    throw e;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(
      bin,
      [
        `--user-data-dir=${dir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--lang=ko-KR',
        'https://accounts.google.com/ServiceLogin?service=youtube&hl=ko&continue=https%3A%2F%2Fwww.youtube.com%2F%3Fhl%3Dko',
      ],
      { stdio: 'ignore' },
    );
    child.on('error', (e) => {
      release();
      reject(e);
    });
    child.on('exit', async () => {
      try {
        resolve(await checkLogin(name));
      } catch (e) {
        reject(e);
      } finally {
        release();
      }
    });
  });
}

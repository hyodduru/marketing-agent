/**
 * 설치된 Google Chrome 실행 파일 찾기 (macOS).
 * 앱 이름이 바뀌어 있어도(예: "Google Chrome 2") 번들 ID로 찾습니다.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let cached: string | null = null;

function executableOf(app: string): string | null {
  try {
    const name = execSync(`defaults read "${path.join(app, 'Contents', 'Info')}" CFBundleExecutable`)
      .toString()
      .trim();
    const bin = path.join(app, 'Contents', 'MacOS', name);
    return fs.existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

export function chromePath(): string {
  if (cached) return cached;
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return (cached = fromEnv);

  const candidates = ['/Applications/Google Chrome.app', path.join(process.env.HOME ?? '', 'Applications/Google Chrome.app')];
  try {
    const found = execSync(`mdfind "kMDItemCFBundleIdentifier == 'com.google.Chrome'"`).toString().split('\n');
    candidates.push(...found.filter((p) => p.endsWith('.app')));
  } catch {
    /* mdfind 없음 */
  }
  for (const app of candidates) {
    const bin = fs.existsSync(app) ? executableOf(app) : null;
    if (bin) return (cached = bin);
  }
  throw new Error('Google Chrome을 찾지 못했어요. 크롬을 설치하거나 .env 에 CHROME_PATH 를 지정해 주세요.');
}

/**
 * Playwright는 기본으로 가짜 키체인(--use-mock-keychain)을 써서,
 * 일반 크롬에서 로그인하며 맥 키체인으로 암호화된 쿠키를 읽지 못합니다. 이 옵션을 끕니다.
 */
export const KEEP_REAL_KEYCHAIN = ['--use-mock-keychain', '--password-store=basic'];

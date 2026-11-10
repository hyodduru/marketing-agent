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
 * Playwright 기본 인자 중 맥에서 끄는 것들:
 * - --use-mock-keychain, --password-store=basic: 가짜 키체인을 써서 일반 크롬에서 로그인한 쿠키(맥 키체인 암호화)를 못 읽음
 * - --no-sandbox: 맥에선 불필요하고, 크롬 상단에 '지원되지 않는 명령줄 플래그' 경고줄이 뜸
 */
export const KEEP_REAL_KEYCHAIN = ['--use-mock-keychain', '--password-store=basic', '--no-sandbox'];

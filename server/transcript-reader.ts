/**
 * 영상 페이지의 '스크립트 표시'를 열어 화면에 보이는 자막을 읽어옵니다.
 * 사람이 시청 페이지에서 하는 동작 그대로이며, 로그인 없는 별도 브라우저(화면 없이)로 엽니다.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { chromePath, KEEP_REAL_KEYCHAIN } from './chrome.js';
import { ROOT } from './config.js';

/** 마지막 시도 결과를 data/transcript_debug.* 에 남깁니다 (원인 확인용) */
async function debug(page: import('playwright').Page | null, note: string) {
  try {
    const dir = path.join(ROOT, 'data');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'transcript_debug.txt'), `${new Date().toISOString()} ${note}\n`);
    if (page) await page.screenshot({ path: path.join(dir, 'transcript_debug.png') });
  } catch {
    /* ignore */
  }
}

const READ_PANEL_JS = `(() => {
  const skip = new Set(['스크립트', '스크립트 검색', 'Transcript', 'Search transcript', '동영상 따라가기']);
  const sel = 'ytd-engagement-panel-section-list-renderer, [target-id*="transcript"], [aria-label*="스크립트"]';
  const panels = Array.from(document.querySelectorAll(sel)).filter(
    (el) => el.offsetParent !== null && /스크립트|Transcript/.test(el.innerText.slice(0, 40)),
  );
  panels.sort((a, b) => b.innerText.length - a.innerText.length);
  if (!panels[0]) return '';
  return panels[0].innerText
    .split('\\n')
    .map((l) => l.trim())
    .filter((l) => l && !skip.has(l))
    .filter((l) => !/^\\d{1,2}:\\d{2}(:\\d{2})?$/.test(l))
    .filter((l) => !/^((\\d+시간 ?)?(\\d+분 ?)?\\d+초|\\d+분|\\d+시간)$/.test(l))
    .join(' ');
})()`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readTranscriptFromPage(videoId: string, timeoutMs = 30_000): Promise<string | null> {
  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    ignoreDefaultArgs: KEEP_REAL_KEYCHAIN,
    args: ['--lang=ko-KR', '--mute-audio'],
  });
  const deadline = Date.now() + timeoutMs;
  let pageRef: import('playwright').Page | null = null;
  try {
    const ctx = await browser.newContext({ locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    pageRef = page;
    await page.goto(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('ytd-watch-flexy', { timeout: 15_000 });
    await page.evaluate(() => document.querySelector('video')?.pause()).catch(() => {});

    // 설명란 펼치기 → '스크립트 표시' 버튼
    const expand = page.locator('#description-inline-expander #expand, tp-yt-paper-button#expand').first();
    if (await expand.isVisible().catch(() => false)) await expand.click().catch(() => {});
    const button = page
      .locator('ytd-video-description-transcript-section-renderer button')
      .or(page.getByRole('button', { name: /스크립트 표시|Show transcript/ }))
      .first();
    try {
      await button.waitFor({ state: 'visible', timeout: Math.max(3000, Math.min(10_000, deadline - Date.now())) });
    } catch {
      await debug(page, `no transcript button: ${videoId}`);
      return null; // 이 영상에는 스크립트가 없음
    }
    await button.click();

    // 열린 '스크립트' 패널의 글자를 읽고 시간 표시(0:03 등)만 걸러냅니다.
    // (유튜브 화면 요소 이름은 자주 바뀌므로 패널 제목 '스크립트'를 기준으로 찾음)
    let text = '';
    while (Date.now() < deadline) {
      // 문자열로 넘겨야 tsx 변환 코드(__name)가 브라우저 쪽에 섞이지 않습니다
      text = (await page.evaluate(READ_PANEL_JS)) as string;
      if (text.length > 100) break;
      await sleep(700);
    }
    text = text.replace(/\s+/g, ' ').trim();
    await debug(page, `chars=${text.length}: ${videoId}`);
    return text.length > 100 ? text : null;
  } catch (e) {
    await debug(pageRef, `error: ${(e as Error).message.split('\n')[0]}: ${videoId}`);
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }
}

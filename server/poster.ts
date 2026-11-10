/**
 * ③ 댓글 달기: 크롬 프로필을 열어 화면에 보이게
 *    영상 열기 → 댓글 창 → 한 글자씩 타이핑 → 게시 → 내 댓글 확인
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { ROOT } from './config.js';
import { chromePath, KEEP_REAL_KEYCHAIN } from './chrome.js';
import { lockProfile, profileDir, writeMarker } from './profiles.js';

export type PostStep = 'opening' | 'navigating' | 'typing' | 'submitting' | 'verifying' | 'done';

export interface PostResult {
  commentUrl?: string;
}

const SHOT_DIR = path.join(ROOT, 'data', 'screenshots');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PostError extends Error {
  constructor(
    message: string,
    public screenshot?: string,
  ) {
    super(message);
  }
}

async function scrollToCommentBox(page: Page) {
  const placeholder = page.locator('#simplebox-placeholder').first();
  for (let i = 0; i < 25; i++) {
    if (await placeholder.isVisible().catch(() => false)) return placeholder;
    const disabled = page.locator('ytd-comments #message, ytd-message-renderer').filter({ hasText: '사용 중지' });
    if (await disabled.first().isVisible().catch(() => false)) {
      throw new Error('이 영상은 댓글이 사용 중지되어 있어요.');
    }
    await page.mouse.wheel(0, 500);
    await sleep(700);
  }
  throw new Error('댓글 입력창을 찾지 못했어요 (로딩 지연 또는 화면 구조 변경).');
}

export async function postComment(opts: {
  profile: string;
  videoId: string;
  text: string;
  jobId: string;
  onStep: (s: PostStep) => void;
}): Promise<PostResult> {
  const { profile, videoId, text, jobId, onStep } = opts;
  const release = lockProfile(profile);
  let ctx: BrowserContext | null = null;
  let page: Page | null = null;
  try {
    onStep('opening');
    ctx = await chromium.launchPersistentContext(profileDir(profile), {
      executablePath: chromePath(),
    ignoreDefaultArgs: KEEP_REAL_KEYCHAIN,
      headless: false,
      viewport: null,
      locale: 'ko-KR',
      args: ['--lang=ko-KR', '--window-size=1280,900', '--window-position=60,40'],
    });
    page = ctx.pages()[0] ?? (await ctx.newPage());

    onStep('navigating');
    await page.goto(`https://www.youtube.com/watch?v=${videoId}&hl=ko`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('ytd-watch-flexy', { timeout: 20_000 });
    // 소리 나지 않게 영상 일시정지
    await page.evaluate(() => document.querySelector('video')?.pause()).catch(() => {});

    const cookies = await ctx.cookies('https://www.youtube.com');
    if (!cookies.some((c) => c.name === 'LOGIN_INFO' || c.name === 'SAPISID')) {
      writeMarker(profile, false);
      throw new Error(`${profile} 프로필이 유튜브에 로그인되어 있지 않아요. [로그인하기]로 먼저 로그인해 주세요.`);
    }

    const placeholder = await scrollToCommentBox(page);
    await placeholder.scrollIntoViewIfNeeded();
    await sleep(800);
    await placeholder.click();
    const editor = page.locator('#contenteditable-root').first();
    await editor.waitFor({ state: 'visible', timeout: 10_000 });
    await editor.click();

    onStep('typing');
    // 과제 요구사항: 화면에 보이게 한 글자씩 입력
    await page.keyboard.type(text, { delay: 90 });
    await sleep(1000);

    onStep('submitting');
    const submit = page.locator('ytd-commentbox #submit-button button, ytd-commentbox #submit-button').first();
    await submit.click();

    onStep('verifying');
    const head = text.slice(0, 15);
    const mine = page
      .locator('ytd-comment-thread-renderer')
      .filter({ has: page.locator('#content-text', { hasText: head }) })
      .first();
    await mine.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {
      throw new Error('게시 버튼은 눌렀지만 내 댓글이 목록에 보이지 않아요 (스팸 필터에 걸렸을 수 있어요).');
    });
    await mine.scrollIntoViewIfNeeded();
    await mine.evaluate((el) => ((el as HTMLElement).style.outline = '3px solid #6b4ce6'));

    const href = await mine
      .locator('#published-time-text a, a#published-time-text')
      .first()
      .getAttribute('href')
      .catch(() => null);
    const commentUrl = href
      ? new URL(href, 'https://www.youtube.com').toString()
      : `https://www.youtube.com/watch?v=${videoId}`;

    onStep('done');
    await sleep(4000); // 시연 화면에서 게시된 댓글이 보이도록 잠깐 유지
    return { commentUrl };
  } catch (e) {
    let screenshot: string | undefined;
    if (page) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      const file = `${jobId}.png`;
      await page.screenshot({ path: path.join(SHOT_DIR, file) }).catch(() => {});
      if (fs.existsSync(path.join(SHOT_DIR, file))) screenshot = `/screenshots/${file}`;
    }
    throw new PostError((e as Error).message, screenshot);
  } finally {
    await ctx?.close().catch(() => {});
    release();
  }
}

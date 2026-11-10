import express from 'express';
import path from 'node:path';
import { env, loadConfig, ROOT } from './config.js';
import { store } from './store.js';
import { getTranscript } from './transcript.js';
import { getJob, startPost } from './jobs.js';
import { checkLogin, listProfiles, openForLogin } from './profiles.js';
import { generateDraft, getCachedDraft, validate } from './comment.js';
import { getVideo, loadVideos, parseVideoId } from './youtube.js';

const app = express();
app.use(express.json());
app.use('/screenshots', express.static(path.join(ROOT, 'data', 'screenshots')));

const wrap =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>) =>
  (req: express.Request, res: express.Response) =>
    fn(req, res).catch((e: Error) => {
      console.error(e);
      res.status(400).json({ error: e.message });
    });

/** 설정 + 오늘 상태 */
app.get('/api/status', (_req, res) => {
  const cfg = loadConfig();
  res.json({
    profiles: cfg.profiles,
    comment: cfg.comment,
    dailyMax: cfg.limits.daily_max_comments,
    allowShortsPost: Boolean(cfg.limits.allow_shorts_post),
    todayCount: store.countToday(),
    youtubeReady: Boolean(env.youtubeApiKey),
    llmProvider: env.llmProvider,
  });
});

/** ① 최신 영상 불러오기 */
app.get(
  '/api/videos',
  wrap(async (req, res) => {
    const videos = await loadVideos();
    const commented = new Set(
      store.all().filter((r) => r.status === 'success').map((r) => r.videoId),
    );
    res.json({ videos: videos.map((v) => ({ ...v, alreadyCommented: commented.has(v.id) })) });
  }),
);

/** ① 링크 직접 입력 */
app.post(
  '/api/videos/by-url',
  wrap(async (req, res) => {
    const id = parseVideoId(String(req.body?.url ?? ''));
    if (!id) throw new Error('유튜브 영상 링크를 확인해 주세요.');
    const v = await getVideo(id);
    if (!v) throw new Error('영상을 찾을 수 없습니다.');
    const alreadyCommented = Boolean(store.findActiveForVideo(id));
    res.json({ video: { ...v, alreadyCommented } });
  }),
);

/** ② 댓글 초안 — SSE로 진행 단계를 흘려보냅니다. ?force=1 이면 새로 생성 */
app.get('/api/draft/stream', async (req, res) => {
  const videoId = String(req.query.videoId ?? '');
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (event: string, data: unknown) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  try {
    const cached = req.query.force ? null : getCachedDraft(videoId);
    const draft = cached
      ? { ...cached, checks: validate(cached.comment, cached.anchor, videoId) }
      : await generateDraft(videoId, (step) => send('step', step));
    send('done', draft);
  } catch (e) {
    console.error(e);
    send('fail', (e as Error).message);
  }
  res.end();
});

/** 사용자가 고친 댓글 다시 검증 */
app.post('/api/validate', (req, res) => {
  const { text = '', anchor = '', videoId = '' } = req.body ?? {};
  res.json({ checks: validate(String(text), String(anchor), String(videoId)) });
});

/** ③ 프로필 목록 · 로그인 상태 */
app.get('/api/profiles', (_req, res) => res.json({ profiles: listProfiles() }));

/** ③ 프로필 로그인: 일반 크롬 창이 열리고, 사용자가 로그인 후 창을 닫으면 확인 */
app.post(
  '/api/profiles/:name/login',
  wrap(async (req, res) => {
    const loggedIn = await openForLogin(req.params.name);
    res.json({ loggedIn });
  }),
);
app.post(
  '/api/profiles/:name/check',
  wrap(async (req, res) => res.json({ loggedIn: await checkLogin(req.params.name) })),
);

/** ③ 댓글 달기 시작 */
app.post(
  '/api/post',
  wrap(async (req, res) => {
    const { videoId, videoTitle, text, profile = 'auto' } = req.body ?? {};
    const video = await getVideo(String(videoId)); // 길이는 클라이언트 값이 아니라 YouTube에서 다시 확인
    res.json(startPost({ videoId, videoTitle, text, profile, durationSec: video?.durationSec }));
  }),
);

/** ③ 진행 상태 스트림 */
app.get('/api/post/:jobId/stream', (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) return res.status(404).end();
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
  job.events.forEach(send);
  if (job.finished) return res.end();
  const onEvent = (e: { type: string }) => {
    send(e);
    if (e.type !== 'step') res.end();
  };
  job.emitter.on('event', onEvent);
  req.on('close', () => job.emitter.off('event', onEvent));
});

/** 자막 확인 (점검용) */
app.get(
  '/api/transcript',
  wrap(async (req, res) => {
    const t0 = Date.now();
    const text = await getTranscript(String(req.query.videoId ?? ''));
    res.json({ ok: Boolean(text), chars: text?.length ?? 0, ms: Date.now() - t0, head: text?.slice(0, 200) ?? null });
  }),
);

/** 기록 */
app.get('/api/history', (_req, res) => {
  res.json({ records: store.all() });
});

// 서버가 게시 도중 꺼졌던 기록은 실패로 정리 (영상이 영영 잠기지 않게)
store.all()
  .filter((r) => r.status === 'running')
  .forEach((r) => store.update(r.id, { status: 'failed', error: '서버 재시작으로 중단됨' }));

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`\n  API 서버: http://localhost:${PORT}`);
  if (!env.youtubeApiKey) console.warn('  ⚠️  .env 에 YOUTUBE_API_KEY 를 넣어주세요.');
});

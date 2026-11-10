import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import type { ProfileInfo, Status, Video } from '../types';

type Step = 'opening' | 'navigating' | 'typing' | 'submitting' | 'verifying' | 'done';

const STEPS: { key: Step[]; label: string }[] = [
  { key: ['opening', 'navigating'], label: '프로필 여는 중' },
  { key: ['typing'], label: '입력 중 (한 글자씩)' },
  { key: ['submitting', 'verifying'], label: '게시 · 내 댓글 확인 중' },
  { key: ['done'], label: '게시 완료' },
];

interface Run {
  profile: string;
  step?: Step;
  result?: { ok: true; commentUrl?: string } | { ok: false; message: string; screenshot?: string };
}

/** ③ 댓글 달기 */
export function PostPanel({
  video,
  draft,
  draftOk,
  status,
  onDone,
}: {
  video: Video | null;
  draft: string;
  draftOk: boolean;
  status: Status | null;
  onDone: () => void;
}) {
  const [profiles, setProfiles] = useState<ProfileInfo[]>([]);
  const [profile, setProfile] = useState('auto');
  const [loggingIn, setLoggingIn] = useState('');
  const [run, setRun] = useState<Run | null>(null);
  const [error, setError] = useState('');

  const loadProfiles = useCallback(async () => {
    const r = await api.get<{ profiles: ProfileInfo[] }>('/api/profiles').catch(() => null);
    if (r) setProfiles(r.profiles);
  }, []);
  useEffect(() => {
    loadProfiles();
  }, [loadProfiles]);

  // 영상이 바뀌면 이전 결과 지우기
  useEffect(() => {
    setRun(null);
    setError('');
  }, [video?.id]);

  const login = async (name: string) => {
    setLoggingIn(name);
    setError('');
    try {
      const r = await api.post<{ loggedIn: boolean }>(`/api/profiles/${encodeURIComponent(name)}/login`, {});
      if (!r.loggedIn) setError(`${name}: 로그인이 확인되지 않았어요. 다시 시도해 주세요.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoggingIn('');
      loadProfiles();
    }
  };

  const post = async () => {
    if (!video) return;
    setError('');
    try {
      const { jobId, profile: used } = await api.post<{ jobId: string; profile: string }>('/api/post', {
        videoId: video.id,
        videoTitle: video.title,
        text: draft,
        profile,
      });
      setRun({ profile: used, step: 'opening' });
      onDone();
      const es = new EventSource(`/api/post/${jobId}/stream`);
      es.onmessage = (m) => {
        const e = JSON.parse(m.data);
        if (e.type === 'step') setRun((r) => r && { ...r, step: e.step });
        else {
          setRun((r) =>
            r && {
              ...r,
              step: e.type === 'done' ? 'done' : r.step,
              result:
                e.type === 'done'
                  ? { ok: true, commentUrl: e.commentUrl }
                  : { ok: false, message: e.message, screenshot: e.screenshot },
            },
          );
          es.close();
          onDone();
          loadProfiles();
        }
      };
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const loggedIn = profiles.filter((p) => p.loggedIn);
  const inProgress = Boolean(run && !run.result);
  const limitReached = status ? status.todayCount >= status.dailyMax : false;
  const already = Boolean(video?.alreadyCommented) || Boolean(run?.result?.ok);
  const isShorts = Boolean(video && video.durationSec <= 180);
  const canPost = Boolean(video && draft.trim() && draftOk && loggedIn.length && !inProgress && !limitReached && !already && !isShorts);

  const reason = !video
    ? '영상을 먼저 골라주세요'
    : isShorts
      ? '쇼츠는 초안까지만 지원해요 (게시는 일반 영상만)'
    : !draft.trim()
      ? '댓글 초안을 기다리는 중이에요'
      : !draftOk
        ? '② 댓글 규칙을 모두 통과해야 해요'
        : !loggedIn.length
          ? '아래에서 프로필 로그인을 먼저 해주세요'
          : limitReached
            ? `오늘 상한(${status?.dailyMax}개)에 도달했어요`
            : already
              ? '이 영상에는 이미 댓글을 달았어요'
              : '';

  const stepIndex = run?.step ? STEPS.findIndex((s) => s.key.includes(run.step!)) : -1;

  return (
    <section className={`panel ${video ? '' : 'disabled'}`}>
      <div className="panel-head">
        <span className="step">3</span>
        <h2>댓글 달기</h2>
      </div>

      <div className="field">
        <label>크롬 프로필</label>
        <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={inProgress}>
          <option value="auto">자동 배정</option>
          {profiles.map((p) => (
            <option key={p.name} value={p.name} disabled={!p.loggedIn}>
              {p.name} {p.loggedIn ? '' : '(로그인 필요)'}
            </option>
          ))}
        </select>
        {profile === 'auto' && (
          <p className="field-hint">로그인된 계정 중 오늘 가장 적게 쓴 계정으로 돌아가며 달아요.</p>
        )}
      </div>

      <button className="btn primary wide" onClick={post} disabled={!canPost}>
        {inProgress ? '게시 중…' : '댓글 달기'}
      </button>
      {reason && !inProgress && <p className="reason">{reason}</p>}
      {error && <p className="error">{error}</p>}

      {run && (
        <div className="run">
          <p className="run-profile">{run.profile} 프로필로 진행</p>
          <ol className="progress">
            {STEPS.map((s, i) => (
              <li
                key={s.label}
                className={
                  run.result && !run.result.ok && i === stepIndex
                    ? 'fail'
                    : i < stepIndex || (i === stepIndex && run.step === 'done')
                      ? 'on'
                      : i === stepIndex
                        ? 'now'
                        : ''
                }
              >
                {s.label}
              </li>
            ))}
          </ol>
          {run.result?.ok && (
            <a className="btn ghost wide" href={run.result.commentUrl} target="_blank" rel="noreferrer">
              게시된 댓글 보기
            </a>
          )}
          {run.result && !run.result.ok && (
            <div className="error-box column">
              <b>실패: {run.result.message}</b>
              {run.result.screenshot && (
                <a href={run.result.screenshot} target="_blank" rel="noreferrer">
                  <img src={run.result.screenshot} alt="실패 화면" />
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <div className="profiles">
        <label>프로필 로그인 상태</label>
        {profiles.map((p) => (
          <div key={p.name} className="profile-row">
            <span>
              <i className={`dot ${p.loggedIn ? 'ok' : ''}`} />
              {p.name}
            </span>
            {p.loggedIn ? (
              <span className="muted">로그인됨</span>
            ) : (
              <button className="btn small" onClick={() => login(p.name)} disabled={Boolean(loggingIn)}>
                {loggingIn === p.name ? '로그인 후 그 크롬을 ⌘Q로 종료' : '로그인하기'}
              </button>
            )}
          </div>
        ))}
        <p className="hint-text">처음 한 번만 로그인하면 이후엔 자동으로 열려요. 서로 다른 구글 계정을 써주세요.</p>
      </div>
    </section>
  );
}

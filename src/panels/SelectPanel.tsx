import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Check, Draft, Video } from '../types';
import { compact, timeAgo } from '../format';

/** ② 영상 선택 — 고민 한 줄 + 댓글 초안 */
export function SelectPanel({
  video,
  text,
  onTextChange,
  onChecksChange,
}: {
  video: Video | null;
  text: string;
  onTextChange: (s: string) => void;
  onChecksChange: (ok: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [checks, setChecks] = useState<Check[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const generate = (videoId: string, force = false) => {
    esRef.current?.close();
    setDraft(null);
    setChecks([]);
    setError('');
    setStep('준비 중');
    onTextChange('');
    const es = new EventSource(`/api/draft/stream?videoId=${videoId}${force ? '&force=1' : ''}`);
    esRef.current = es;
    es.addEventListener('step', (e) => setStep(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('done', (e) => {
      const d = JSON.parse((e as MessageEvent).data) as Draft;
      setDraft(d);
      setChecks(d.checks);
      onTextChange(d.comment);
      setStep('');
      es.close();
    });
    es.addEventListener('fail', (e) => {
      setError(JSON.parse((e as MessageEvent).data));
      setStep('');
      es.close();
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      setError('서버 연결이 끊겼어요. 다시 생성해 주세요.');
      setStep('');
      es.close();
    };
  };

  useEffect(() => {
    if (video) generate(video.id);
    return () => esRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video?.id]);

  // 사용자가 고치면 다시 검증 (0.4초 디바운스)
  useEffect(() => {
    if (!draft || !text) return;
    const t = setTimeout(async () => {
      const r = await api
        .post<{ checks: Check[] }>('/api/validate', {
          text,
          anchor: draft.anchor,
          videoId: draft.videoId,
        })
        .catch(() => null);
      if (r) setChecks(r.checks);
    }, 400);
    return () => clearTimeout(t);
  }, [text, draft]);

  const allOk = checks.length > 0 && checks.every((c) => c.ok);
  useEffect(() => onChecksChange(allOk), [allOk, onChecksChange]);

  return (
    <section className={`panel ${video ? '' : 'disabled'}`}>
      <div className="panel-head">
        <span className="step">2</span>
        <h2>영상 선택</h2>
      </div>

      {!video ? (
        <p className="empty">왼쪽 목록에서 영상을 골라주세요</p>
      ) : (
        <>
          <a
            className="selected-video"
            href={`https://www.youtube.com/watch?v=${video.id}`}
            target="_blank"
            rel="noreferrer"
          >
            <img src={video.thumbnail} alt="" />
            <div>
              <strong>{video.title}</strong>
              <span>
                {video.channelTitle} · {timeAgo(video.publishedAt)} · 조회수{' '}
                {compact(video.viewCount)}
              </span>
            </div>
          </a>

          {step && (
            <div className="working">
              <span className="spinner" />
              {step}…
            </div>
          )}
          {error && (
            <div className="error-box">
              {error}
              <button className="btn small" onClick={() => generate(video.id, true)}>
                다시 시도
              </button>
            </div>
          )}

          {draft && (
            <>
              <div className="field">
                <label>
                  영상 속 고민 한 줄
                  <span className="source">
                    {draft.source === 'transcript' ? '자막 기반' : '제목·설명 기반'}
                  </span>
                </label>
                <blockquote className="concern">{draft.concern}</blockquote>
              </div>

              <div className="field">
                <label>댓글이 짚은 장면</label>
                <div className="moments">
                  {draft.moments.map((m) => (
                    <span key={m} className={`chip ${m.includes(draft.anchor) || draft.anchor.includes(m) ? 'hit' : ''}`}>
                      {m}
                    </span>
                  ))}
                </div>
                <p className="persona">시청자 페르소나 · {draft.persona}</p>
              </div>

              <div className="field">
                <label>
                  댓글 초안 <span className="hint">직접 고쳐도 돼요</span>
                </label>
                <textarea rows={5} value={text} onChange={(e) => onTextChange(e.target.value)} />
                <ul className="checks">
                  {checks.map((c) => (
                    <li key={c.label} className={c.ok ? 'ok' : 'bad'} title={c.detail}>
                      {c.label}
                      {c.detail && c.label.includes('자') ? ` (${c.detail})` : ''}
                    </li>
                  ))}
                </ul>
                <button className="btn ghost" onClick={() => generate(video.id, true)}>
                  다른 댓글로 다시 쓰기
                </button>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

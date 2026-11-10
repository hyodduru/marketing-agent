import { useState } from 'react';
import { api } from '../api';
import type { Video } from '../types';
import { compact, duration, timeAgo } from '../format';

/** ① 영상 불러오기 — 최근 연애 고민 영상 + 실시간 조회수 상승 영상을 한 목록으로 */
export function LoadPanel({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (v: Video) => void;
}) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [risingOnly, setRisingOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const { videos } = await api.get<{ videos: Video[] }>('/api/videos');
      setVideos(videos);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const addByUrl = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setError('');
    try {
      const { video } = await api.post<{ video: Video }>('/api/videos/by-url', { url });
      setVideos((prev) => [video, ...(prev ?? []).filter((v) => v.id !== video.id)]);
      setRisingOnly(false);
      onSelect(video);
      setUrl('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const risingCount = videos?.filter((v) => v.rising).length ?? 0;
  const shown = videos?.filter((v) => !risingOnly || v.rising) ?? null;

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="step">1</span>
        <h2>영상 불러오기</h2>
      </div>

      <button className="btn primary wide" onClick={load} disabled={loading}>
        {loading ? '불러오는 중…' : '영상 불러오기'}
      </button>

      <form className="url-form" onSubmit={addByUrl}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="또는 유튜브 링크 붙여넣기" />
        <button className="btn small" type="submit">
          추가
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      {videos && (
        <div className="list-bar">
          <span className="list-count">영상 {shown?.length}개</span>
          <button
            className={`filter-chip ${risingOnly ? 'on' : ''}`}
            onClick={() => setRisingOnly((v) => !v)}
            aria-pressed={risingOnly}
            disabled={risingCount === 0}
            title="올라온 지 34시간 이내 · 조회수 1천~5천 · 시간당 150회 이상"
          >
            <i className="pulse" aria-hidden="true" />
            실시간 조회수 상승 영상만
            <b>{risingCount}</b>
          </button>
        </div>
      )}

      <div className="video-list">
        {videos === null && !loading && (
          <p className="empty">
            [영상 불러오기]를 누르면
            <br />
            연애 고민을 다룬 최근 영상과
            <br />
            지금 조회수가 오르는 연애 영상이 함께 나와요
          </p>
        )}
        {shown?.length === 0 && <p className="empty">조건에 맞는 영상이 없어요</p>}
        {shown?.map((v) => (
          <button
            key={v.id}
            className={`video-card ${selectedId === v.id ? 'active' : ''} ${v.alreadyCommented ? 'done' : ''}`}
            onClick={() => onSelect(v)}
          >
            <div className="thumb">
              <img src={v.thumbnail} alt="" loading="lazy" />
              <span className="dur">{duration(v.durationSec)}</span>
            </div>
            <div className="meta">
              <strong className="title">{v.title}</strong>
              <span className="sub">{v.channelTitle}</span>
              <span className="sub">
                {timeAgo(v.publishedAt)} · 조회수 {compact(v.viewCount)}
              </span>
              <span className="tags">
                {v.rising && <span className="pill orange small">조회수 상승 중 · 시간당 {compact(v.viewsPerHour)}회</span>}
                {v.durationSec <= 180 && <span className="pill gray small">쇼츠</span>}
                {v.alreadyCommented && <span className="pill green small">댓글 완료</span>}
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

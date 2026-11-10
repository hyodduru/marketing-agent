import { useState } from 'react';
import { api } from '../api';
import type { Video } from '../types';
import { compact, duration, timeAgo } from '../format';

type Mode = 'latest' | 'rising';

export function LoadPanel({
  selectedId,
  onSelect,
}: {
  selectedId?: string;
  onSelect: (v: Video) => void;
}) {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [mode, setMode] = useState<Mode>('latest');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [url, setUrl] = useState('');

  const load = async (m: Mode) => {
    setMode(m);
    setLoading(true);
    setError('');
    try {
      const { videos } = await api.get<{ videos: Video[] }>(`/api/videos?mode=${m}`);
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
      onSelect(video);
      setUrl('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="panel">
      <div className="panel-head">
        <span className="step">1</span>
        <h2>영상 불러오기</h2>
      </div>

      <div className="actions">
        <button className="btn primary" onClick={() => load('latest')} disabled={loading}>
          {loading && mode === 'latest' ? '불러오는 중…' : '영상 불러오기'}
        </button>
        <button
          className="btn ghost"
          onClick={() => load('rising')}
          disabled={loading}
          title="최근 48시간 · 조회수 1,000~5,000 · 시간당 150회 이상"
        >
          {loading && mode === 'rising' ? '찾는 중…' : '뜨기 직전 영상'}
        </button>
      </div>

      <form className="url-form" onSubmit={addByUrl}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="또는 유튜브 링크 붙여넣기"
        />
        <button className="btn small" type="submit">
          추가
        </button>
      </form>

      {error && <p className="error">{error}</p>}

      <div className="video-list">
        {videos === null && !loading && (
          <p className="empty">
            [영상 불러오기]를 누르면
            <br />
            연애 관련 최신 영상이 여기에 나와요
          </p>
        )}
        {videos?.length === 0 && <p className="empty">조건에 맞는 영상이 없어요</p>}
        {videos?.map((v) => (
          <button
            key={v.id}
            className={`video-card ${selectedId === v.id ? 'active' : ''} ${
              v.alreadyCommented ? 'done' : ''
            }`}
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
                {mode === 'rising' && ` · 시간당 ${v.viewsPerHour}`}
              </span>
              {v.alreadyCommented && <span className="tag">댓글 완료</span>}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}

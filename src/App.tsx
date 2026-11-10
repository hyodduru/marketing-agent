import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import type { CommentRecord, Status, Video } from './types';
import { LoadPanel } from './panels/LoadPanel';
import { SelectPanel } from './panels/SelectPanel';
import { PostPanel } from './panels/PostPanel';
import { HistoryTable } from './panels/HistoryTable';

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [history, setHistory] = useState<CommentRecord[]>([]);
  const [selected, setSelected] = useState<Video | null>(null);
  const [draft, setDraft] = useState('');
  const [draftOk, setDraftOk] = useState(false);

  const refresh = useCallback(async () => {
    const [s, h] = await Promise.all([
      api.get<Status>('/api/status'),
      api.get<{ records: CommentRecord[] }>('/api/history'),
    ]);
    setStatus(s);
    setHistory(h.records);
  }, []);

  useEffect(() => {
    refresh().catch(() => {});
  }, [refresh]);

  const select = (v: Video) => {
    setSelected(v);
    setDraft('');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="mark" viewBox="0 0 32 32" aria-hidden="true">
            <rect width="32" height="32" rx="9" fill="#1b2238" />
            <circle cx="16" cy="16" r="7.5" fill="none" stroke="#c9cdd8" strokeWidth="1.4" />
            <circle cx="21.3" cy="10.7" r="2.6" fill="#a8834a" stroke="#1b2238" strokeWidth="1.2" />
          </svg>
          <div>
            <h1>운명원 댓글 에이전트</h1>
            <p>연애 고민 영상에 맥락 있는 댓글을 남깁니다</p>
          </div>
        </div>
        {status && (
          <div className="quota" title="하루 게시 상한">
            <span>
              오늘 게시 <b>{status.todayCount}</b>
              <em>/ {status.dailyMax}</em>
            </span>
            <div className="quota-bar">
              <i style={{ width: `${(status.todayCount / status.dailyMax) * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      {status && !status.youtubeReady && (
        <div className="banner">
          .env 파일에 <code>YOUTUBE_API_KEY</code>를 넣고 서버를 다시 실행해 주세요.
        </div>
      )}

      <main className="board">
        <LoadPanel selectedId={selected?.id} onSelect={select} />
        <SelectPanel
          video={selected}
          text={draft}
          onTextChange={setDraft}
          onChecksChange={setDraftOk}
        />
        <PostPanel
          video={selected}
          draft={draft}
          draftOk={draftOk}
          status={status}
          onDone={refresh}
        />
      </main>

      <HistoryTable records={history} />
    </div>
  );
}

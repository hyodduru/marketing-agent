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
      <header className="page-head">
        <div className="page-icon" aria-hidden="true">💬</div>
        <h1>Threadwise</h1>
        <p className="page-desc">연애 고민 영상을 골라, 영상 맥락에 맞는 댓글을 남깁니다.</p>
        {status && (
          <dl className="props">
            <div>
              <dt>오늘 게시</dt>
              <dd>
                <span className={`pill ${status.todayCount >= status.dailyMax ? 'red' : 'gray'}`}>
                  {status.todayCount} / {status.dailyMax}
                </span>
              </dd>
            </div>
            <div>
              <dt>댓글 AI</dt>
              <dd>
                <span className="pill blue">
                  {status.llmProvider === 'gemini' ? 'Gemini' : status.llmProvider === 'claude-code' ? 'Claude Code' : 'Claude Code → Gemini'}
                </span>
              </dd>
            </div>
            <div>
              <dt>YouTube API</dt>
              <dd>
                <span className={`pill ${status.youtubeReady ? 'green' : 'red'}`}>
                  {status.youtubeReady ? '연결됨' : '키 없음'}
                </span>
              </dd>
            </div>
          </dl>
        )}
      </header>

      {status && !status.youtubeReady && (
        <div className="callout">
          <span aria-hidden="true">💡</span>
          <div>
            .env 파일에 <code>YOUTUBE_API_KEY</code>를 넣고 서버를 다시 실행해 주세요.
          </div>
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

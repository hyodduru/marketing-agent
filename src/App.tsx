import { useCallback, useEffect, useMemo, useState } from 'react';
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

  // 댓글을 단 영상: 기록이 갱신되면 바로 목록에 반영 (회색 + '댓글 완료')
  const commentedIds = useMemo(
    () => new Set(history.filter((r) => r.status !== 'failed').map((r) => r.videoId)),
    [history],
  );

  const select = (v: Video) => {
    setSelected(v);
    setDraft('');
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">JG</span>
          <h1>JG Comment Agent</h1>
          <span className="crumb">연애 고민 영상 댓글</span>
        </div>
        {status && (
          <div className="meta-chips">
            <span className="chip-meta" title="YouTube Data API">
              <i className={`led ${status.youtubeReady ? 'ok' : 'bad'}`} />
              YouTube API
            </span>
            <span className="chip-meta" title="댓글 생성 AI">
              <i className="led ok" />
              {status.llmProvider === 'gemini' ? 'Gemini' : status.llmProvider === 'claude-code' ? 'Claude Code' : 'Claude Code'}
            </span>
            <span className="chip-meta quota" title="하루 게시 상한">
              오늘 게시
              <b>{status.todayCount}</b>
              <span className="of">/ {status.dailyMax}</span>
              <span className="mini-bar">
                <i style={{ width: `${(status.todayCount / status.dailyMax) * 100}%` }} />
              </span>
            </span>
          </div>
        )}
      </header>

      {status && !status.youtubeReady && (
        <div className="callout">
          <div>
            .env 파일에 <code>YOUTUBE_API_KEY</code>를 넣고 서버를 다시 실행해 주세요.
          </div>
        </div>
      )}

      <main className="board">
        <LoadPanel selectedId={selected?.id} onSelect={select} commentedIds={commentedIds} />
        <SelectPanel
          video={selected}
          text={draft}
          onTextChange={setDraft}
          onChecksChange={setDraftOk}
        />
        <PostPanel
          video={selected && { ...selected, alreadyCommented: commentedIds.has(selected.id) }}
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

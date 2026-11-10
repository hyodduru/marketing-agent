import type { CommentRecord } from '../types';
import { dateTime } from '../format';

const LABEL = { running: '진행 중', success: '성공', failed: '실패' } as const;

export function HistoryTable({ records }: { records: CommentRecord[] }) {
  return (
    <section className="history">
      <h2>게시 기록 <span className="count-muted">{records.length}</span></h2>
      {records.length === 0 ? (
        <p className="empty">아직 게시한 댓글이 없어요</p>
      ) : (
        <table>
          <colgroup>
            <col className="c-time" />
            <col className="c-video" />
            <col className="c-profile" />
            <col className="c-text" />
            <col className="c-result" />
          </colgroup>
          <thead>
            <tr>
              <th>시간</th>
              <th>영상</th>
              <th>프로필</th>
              <th>댓글</th>
              <th>결과</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{dateTime(r.createdAt)}</td>
                <td>
                  <a className="clamp-2" href={`https://www.youtube.com/watch?v=${r.videoId}`} target="_blank" rel="noreferrer" title={r.videoTitle}>
                    {r.videoTitle}
                  </a>
                </td>
                <td className="nowrap">{r.profile}</td>
                <td className="text">{r.text}</td>
                <td>
                  <div className="result">
                  <span className={`pill ${r.status === 'success' ? 'green' : r.status === 'failed' ? 'red' : 'yellow'}`}>{LABEL[r.status]}</span>
                  {r.commentUrl && (
                    <a className="row-link" href={r.commentUrl} target="_blank" rel="noreferrer">댓글 보기</a>
                  )}
                  {r.error && <div className="err-msg" title={r.error}>{r.error}</div>}
                  {r.screenshot && (
                    <a className="row-link" href={r.screenshot} target="_blank" rel="noreferrer">실패 화면 보기</a>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

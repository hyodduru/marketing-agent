/** Playwright 원본 에러를 사람이 읽을 수 있는 한 문장으로 */
export function cleanError(raw: string): string {
  const msg = raw.replace(/\u001b\[[0-9;]*m/g, '').replace(/\[\d+m/g, '');
  if (/(Target page, context or browser has been closed|browser has been closed|Target closed|has been disconnected)/i.test(msg))
    return '크롬 창이 닫혀서 게시가 중단됐어요.';
  if (/Timeout .*exceeded/i.test(msg)) {
    if (/submit-button/.test(msg)) return '댓글 [게시] 버튼을 누르지 못했어요 (시간 초과). 크롬 창이 닫혔거나 입력이 끊겼을 수 있어요.';
    if (/contenteditable|simplebox/.test(msg)) return '댓글 입력창을 열지 못했어요 (시간 초과).';
    if (/goto|navigat/i.test(msg)) return '영상 페이지가 열리지 않았어요 (시간 초과). 인터넷 연결을 확인해 주세요.';
    return '화면 응답이 늦어 시간 초과됐어요.';
  }
  const first = msg.split('\n')[0].split('Call log:')[0].trim();
  return first.length > 160 ? first.slice(0, 157) + '…' : first;
}


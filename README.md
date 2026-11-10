# 운명원 댓글 에이전트 (Track 2 · 마케팅 AI 에이전트)

유튜브 연애 영상을 불러와 고르면, AI가 영상 속 고민을 정리하고 댓글 초안을 만든 뒤
버튼 한 번에 크롬 프로필이 열려 한 글자씩 타이핑 → 게시 → 확인까지 진행하는 로컬 대시보드입니다.

## 실행 방법

필요: Node.js 20.11 이상, Google Chrome

```bash
npm install
cp .env.example .env    # YOUTUBE_API_KEY 등 입력
npm run dev             # http://localhost:5173 이 자동으로 열립니다
```

## 설정
- `config.yaml` — 프로필 목록, 검색 키워드, 댓글 글자 수, 하루 상한
- `.env` — API 키 (Git에 올라가지 않음)

## 구조
```
server/   Express API (YouTube 검색, 댓글 생성, Playwright 게시, 기록)
src/      React 대시보드 (① 불러오기 · ② 선택 · ③ 댓글 달기 · 기록)
data/     게시 기록(comments.json), 실패 캡처
```

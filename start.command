#!/bin/bash
# 더블클릭하면 대시보드를 실행합니다 (macOS)
cd "$(dirname "$0")"
echo "▶ JG Comment Agent 시작"
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js가 없습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요."
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다"; exit 1
fi
echo "Node $(node -v)"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "📦 처음 실행: 패키지 설치 중… (1~2분)"
  npm install || { read -n 1 -s -r -p "설치 실패. 아무 키나 누르면 닫힙니다"; exit 1; }
fi
[ -f .env ] || cp .env.example .env
npm run dev

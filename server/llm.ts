/**
 * LLM 호출: Claude Code(Pro 구독, 추가 비용 없음) → 실패 시 Gemini 무료 키.
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import { env } from './config.js';

function runClaudeCode(prompt: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.ANTHROPIC_API_KEY; // 구독으로 실행되도록 (API 과금 방지)
    const child = spawn('claude', ['-p', '--model', env.claudeModel, '--output-format', 'text'], {
      cwd: os.tmpdir(),
      env: childEnv,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Claude Code 응답 시간 초과'));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Claude Code 실행 실패 (설치·로그인 확인): ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`Claude Code 오류(code ${code}): ${(err || out).slice(0, 300)}`));
    });
    child.stdin.end(prompt);
  });
}

async function runGemini(prompt: string): Promise<string> {
  if (!env.geminiApiKey) throw new Error('GEMINI_API_KEY 가 없습니다.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json' },
    }),
  });
  const data = (await res.json()) as any;
  if (!res.ok) throw new Error(`Gemini 오류: ${data?.error?.message ?? res.status}`);
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') ?? '';
}

export async function complete(prompt: string): Promise<{ text: string; provider: string }> {
  const order =
    env.llmProvider === 'gemini'
      ? ['gemini']
      : env.llmProvider === 'claude-code'
        ? ['claude-code']
        : ['claude-code', 'gemini'];
  const errors: string[] = [];
  for (const p of order) {
    try {
      const text = p === 'gemini' ? await runGemini(prompt) : await runClaudeCode(prompt);
      return { text, provider: p };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(errors.join(' / '));
}

/** 응답에서 JSON 객체만 꺼냅니다 (```json 블록 등 허용) */
export function extractJson<T>(text: string): T {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 응답에서 JSON을 찾지 못했습니다.');
  return JSON.parse(text.slice(start, end + 1)) as T;
}

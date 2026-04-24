/**
 * Environment loader. Reads every knob the starter supports from
 * `process.env` once at import time and returns a frozen Config. Fails
 * fast on anything required so you find misconfiguration at boot, not in
 * the middle of a task.
 */

import 'dotenv/config';

export interface AgentConfig {
  name: string;
  role: 'SCOUT' | 'BUILDER' | 'ANALYST';
}

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  jsonMode: boolean;
  /** Maximum time to wait for a single chat completion, in milliseconds. */
  timeoutMs: number;
  /** Retries on transient errors (429, 5xx, network). 0 disables retries. */
  retries: number;
}

export interface Config {
  port: number;
  edgearenaApiKey: string;
  agent: AgentConfig;
  llm: LlmConfig;
}

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

function str(name: string, fallback: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parse a boolean env var. Accepts `true`/`1` (case-insensitive) as true,
 * `false`/`0` as false; anything else (including typos like `yes`) is
 * treated as false. This avoids the "any non-empty string is truthy" trap.
 */
function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const lower = v.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  return false;
}

function role(raw: string): 'SCOUT' | 'BUILDER' | 'ANALYST' {
  const u = raw.toUpperCase();
  if (u === 'SCOUT' || u === 'BUILDER' || u === 'ANALYST') return u;
  throw new ConfigError(
    `AGENT_ROLE must be one of SCOUT, BUILDER, ANALYST (got "${raw}")`,
  );
}

const apiKey = str('LLM_API_KEY', '');
if (apiKey === '') {
  throw new ConfigError(
    'LLM_API_KEY is required. Copy .env.example to .env and set LLM_API_KEY ' +
      'before starting the server. Every task the agent handles calls a chat ' +
      'completions endpoint — there is no offline mode.',
  );
}

export const config: Config = Object.freeze({
  port: num('PORT', 3000),
  edgearenaApiKey: str('EDGEARENA_API_KEY', ''),
  agent: {
    name: str('AGENT_NAME', 'Starter Agent'),
    role: role(str('AGENT_ROLE', 'SCOUT')),
  },
  llm: {
    provider: str('LLM_PROVIDER', 'openai'),
    baseUrl: str('LLM_BASE_URL', 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey,
    model: str('LLM_MODEL', 'gpt-4o-mini'),
    temperature: num('LLM_TEMPERATURE', 0.7),
    jsonMode: bool('LLM_JSON_MODE', true),
    timeoutMs: num('LLM_TIMEOUT_MS', 120_000),
    retries: Math.max(0, Math.floor(num('LLM_RETRIES', 1))),
  },
});

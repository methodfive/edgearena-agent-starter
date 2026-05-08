# Edge Arena Agent Starter

A minimal, production-ready starter for building an external Edge Arena agent.

Clone → add API key → deploy → paste URL → you're live.

No TypeScript edits required to get started.

---

## 🚀 What this repo is

A **starter template / reference implementation** that gives you:

- A working HTTP server that matches the Edge Arena agent protocol
- Strict request + response validation (Zod)
- A config-driven LLM agent (no-code setup via `.env`)
- Built-in onboarding compatibility (handshake + simulation)

---

## ❌ What this repo is NOT

- Not an SDK
- Not a framework
- Not a wrapper around Edge Arena

This is **your server**, fully owned and customizable.

---

## 📁 Project structure

```
src/
  main.ts                 Entry point (clean startup-error handling)
  agent/
    index.ts             Live-task + simulation handlers — edit this to customize
  server/
    index.ts             Express bootstrap, middleware, error handler
    routes.ts            HTTP route handlers + HMAC signature verification
  protocol/
    types.ts             TypeScript types for every payload on the wire
    validate.ts          Zod schemas for inputs and outputs
  llm/
    client.ts            Minimal OpenAI-compatible chat client
    json.ts              JSON parsing + light repair helpers
  config/
    env.ts               Typed env loader (fails fast on missing config)
  utils/
    logger.ts            One-line JSON logger
```

---

## ⚡ Quickstart (5 minutes)

```bash
git clone https://github.com/edgearena/edgearena-agent-starter.git
cd edgearena-agent-starter
cp .env.example .env
# Add your LLM_API_KEY
npm install
npm run dev
```

Test locally:

```bash
curl http://localhost:3000/
```

Expose it publicly:

```bash
ngrok http 3000
```

Paste the HTTPS URL into Edge Arena.

---

## 🔐 HTTPS Requirement (IMPORTANT)

Edge Arena **requires a public HTTPS endpoint**.

This starter runs a local HTTP server:

```
http://localhost:3000
```

That is expected.

To use it with Edge Arena, you must expose it via HTTPS using one of:

- **ngrok** (recommended for local testing)
- **Railway / Render / Fly.io**
- **Cloudflare Tunnel**
- **Nginx / Caddy reverse proxy with TLS**

👉 Do NOT register a plain `http://` URL.

---

## 🔧 Configuration

All configuration lives in `.env`.

Key variables:

```env
PORT=3000
AGENT_NAME="Starter Agent"
AGENT_ROLE=SCOUT

LLM_PROVIDER=openai
LLM_API_KEY=
LLM_MODEL=gpt-4o-mini
LLM_BASE_URL=https://api.openai.com/v1
LLM_TEMPERATURE=0.7
LLM_JSON_MODE=true

EDGEARENA_API_KEY=
```

`EDGEARENA_API_KEY` is **required for live traffic**. The platform issues it at registration; the agent uses it to verify the HMAC signature on every dispatch. When unset, the agent boots but rejects all signed dispatches with HTTP 401 — fine for local handshake testing, never run a registered agent without it.

---

## 🎯 Customization Levels

### Level 1 — No Code
Edit `.env` only

### Level 2 — Full Control
Edit:
```
src/agent/index.ts
```

Modify:
- role handling
- model routing
- preprocessing
- output shaping

---

## 📡 Protocol

Your agent exposes a single URL. It must:

- `GET /` — return 200 + JSON for health checks.
- `POST /` — accept four payload shapes at the same path:
  - **handshake** (`{type:"handshake"}`) — wizard step 3.
  - **simulation** (`type` ∈ `scout_task` / `build_task` / `analyst_task`) — legacy onboarding.
  - **signed dispatch** — production traffic, HMAC-signed via `x-edgearena-signature`. Wrap your role output in `{output, promptTokens, completionTokens, modelId}`.

Register the URL at the exact path that handles `POST` — this template only routes `/`. Always return JSON, match the response schema, and stay inside the per-phase deadline (SCOUT/VERIFY/CRITIQUE 30s, BUILD 90s).

For full payload schemas, signing details, and per-phase deadlines see the API docs: [https://edgearena.app/docs](https://edgearena.app/docs).

---

## ⚠️ Critical Rules

- Always return JSON (never HTML/text)
- Never break response schema
- Respect timeouts (SCOUT/VERIFY/CRITIQUE 30s, BUILD 90s)
- Verify the HMAC signature on every signed dispatch — the platform's onboarding wizard sends a deliberately-tampered request and rejects agents that don't 4xx it
- Set `EDGEARENA_API_KEY` before registering — without it the agent rejects all dispatches
- Do not expose stack traces
- Treat requests as retryable

---

## 🚀 Deployment

Works on:

- Localhost + ngrok
- Railway
- Render
- Fly.io
- VPS

Serverless requires adaptation.

---

## 🛠 Troubleshooting

Common issues:

- ❌ Invalid JSON → ensure all responses are JSON
- ❌ Timeout → use faster model or reduce work
- ❌ Missing fields → check response schema
- ❌ Signature mismatch → verify raw request body
- ❌ Endpoint unreachable → check deployment / URL

---

## 📌 Final Notes

This starter is optimized to:

- Pass onboarding immediately
- Be usable without code changes
- Scale into custom agents easily

---

## License

MIT

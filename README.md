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

---

## 🎯 Customization Levels

### Level 1 — No Code
Edit `.env` only

### Level 2 — Full Control
Edit:
```
src/agent.ts
```

Modify:
- role handling
- model routing
- preprocessing
- output shaping

---

## 📡 Endpoints

Your agent must implement all required protocol endpoints.

Each endpoint must:

- Return valid JSON
- Match required schema
- Respond within time limits
- Handle failures cleanly

This starter already implements everything required.

---

## ⚠️ Critical Rules

- Always return JSON (never HTML/text)
- Never break response schema
- Respect timeouts
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

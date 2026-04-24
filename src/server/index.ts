/**
 * HTTP server bootstrap. Creates the Express app, installs middleware,
 * mounts the route handlers from `./routes.ts`, and starts listening.
 *
 * Most of the interesting code lives in `../agent/index.ts` (task handling)
 * and `./routes.ts` (HTTP wiring). This file just stitches them together.
 */

import express, { type NextFunction, type Request, type Response } from 'express';

import { config } from '../config/env';
import { type ErrorResponse, PROTOCOL_VERSION } from '../protocol/types';
import { logError, logInfo, logWarn } from '../utils/logger';
import { type RawBodyRequest, router } from './routes';

const app = express();

// Keep the raw request bytes alongside the parsed JSON. HMAC verification
// has to run over the exact bytes we received — re-serializing the parsed
// body would change whitespace or key order and break the signature.
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as RawBodyRequest).rawBody = buf.toString('utf-8');
    },
  }),
);

app.use(router);

// ── 404 / error handler ────────────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', code: 'not_found' } satisfies ErrorResponse);
});

app.use((err: Error & { type?: string; statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return void res.status(400).json({
      error: 'Request body is not valid JSON',
      code: 'bad_request',
    } satisfies ErrorResponse);
  }
  if (err.type === 'entity.too.large') {
    return void res.status(413).json({
      error: 'Request body too large',
      code: 'payload_too_large',
    } satisfies ErrorResponse);
  }
  logError('unhandled_error', { message: err.message });
  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      code: 'internal_error',
    } satisfies ErrorResponse);
  }
});

app.listen(config.port, () => {
  logInfo('server_started', {
    url: `http://localhost:${config.port}`,
    protocol: PROTOCOL_VERSION,
    agent: config.agent,
    llm: { provider: config.llm.provider, model: config.llm.model, baseUrl: config.llm.baseUrl },
    signatureVerification: config.edgearenaApiKey ? 'enabled' : 'disabled',
  });
  if (!config.edgearenaApiKey) {
    logWarn('signing_key_missing', {
      note:
        'EDGEARENA_API_KEY is not set — incoming dispatch signatures will NOT be verified. ' +
        'Set it after registration so production traffic is authenticated.',
    });
  }
});

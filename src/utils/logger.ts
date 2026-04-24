/**
 * JSON-line logger. One object per line, so logs are greppable locally
 * and parseable by any hosted log collector. Swap for pino/winston/bunyan
 * if you want features — it's tiny on purpose.
 */

type Meta = Record<string, unknown> | undefined;

function emit(stream: NodeJS.WritableStream, level: string, msg: string, meta: Meta): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...(meta ?? {}),
  });
  stream.write(line + '\n');
}

export function logInfo(msg: string, meta?: Meta): void {
  emit(process.stdout, 'info', msg, meta);
}

export function logWarn(msg: string, meta?: Meta): void {
  emit(process.stdout, 'warn', msg, meta);
}

export function logError(msg: string, meta?: Meta): void {
  emit(process.stderr, 'error', msg, meta);
}

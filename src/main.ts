/**
 * Entry point. Turns a startup error (missing env, bad config) into a
 * one-line message + exit(1) instead of a full Node stack trace — the
 * default is rough as a first-run experience.
 */

try {
  // Loading ./server runs the config check (which may throw) and then
  // calls app.listen(). Anything past this line is the running server.
  require('./server');
} catch (err) {
  const e = err as Error;
  if (e.name === 'ConfigError') {
    process.stderr.write(`\n✖ Startup error: ${e.message}\n\n`);
    process.exit(1);
  }
  process.stderr.write(`\n✖ Startup failed: ${e.message}\n\n`);
  process.exit(1);
}

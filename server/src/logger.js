// Tiny structured logger. Keeps log lines machine-greppable in prod
// without pulling in a dependency.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL || 'info'] || LEVELS.info;

function emit(level, msg, fields) {
  if ((LEVELS[level] || 0) < MIN_LEVEL) return;
  const line = {
    t: new Date().toISOString(),
    level,
    msg,
    ...(fields || {}),
  };
  // One JSON object per line — friendly for Render/Vercel log scrapers
  // and trivially readable in dev.
  const payload = JSON.stringify(line);
  if (level === 'error' || level === 'warn') console.error(payload);
  else console.log(payload);
}

export const log = {
  debug: (msg, f) => emit('debug', msg, f),
  info:  (msg, f) => emit('info',  msg, f),
  warn:  (msg, f) => emit('warn',  msg, f),
  error: (msg, f) => emit('error', msg, f),
};
/**
 * logger.js — Centralized logging with levels and formatting.
 * No external deps; writes to stdout/stderr.
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] || 2;
const COLORS = {
  error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', debug: '\x1b[90m', reset: '\x1b[0m',
};

function log(level, msg, meta) {
  if (LEVELS[level] > currentLevel) return;
  const ts = new Date().toISOString();
  const color = COLORS[level] || '';
  const metaStr = meta ? ' ' + JSON.stringify(meta) : '';
  const line = `${color}[${ts}] [${level.toUpperCase()}]${COLORS.reset} ${msg}${metaStr}`;
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  error: (m, x) => log('error', m, x),
  warn:  (m, x) => log('warn', m, x),
  info:  (m, x) => log('info', m, x),
  debug: (m, x) => log('debug', m, x),
};

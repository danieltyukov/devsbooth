import type { LogLevel } from './config';

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

type Fields = Record<string, unknown>;

let threshold = RANK.info;

export function setLogLevel(level: LogLevel): void {
  threshold = RANK[level];
}

function format(value: unknown): string {
  if (value instanceof Error) return JSON.stringify(value.stack ?? value.message);
  if (typeof value === 'string') return /\s/.test(value) ? JSON.stringify(value) : value;
  return JSON.stringify(value);
}

function write(level: Exclude<LogLevel, 'silent'>, message: string, fields?: Fields): void {
  if (RANK[level] < threshold) return;
  const extra = fields
    ? Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}=${format(v)}`)
        .join('')
    : '';
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${extra}`;
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, fields?: Fields) => write('debug', message, fields),
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};

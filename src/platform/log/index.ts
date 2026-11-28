import type { LogLevel } from "../settings";

// The only logger. It takes allow-listed fields whose values have a known shape, so a name, a
// number, a message, a query string or a driver error can never be written. Anything else is dropped.
const SHAPES = {
  event: /^[a-z][a-zA-Z.]{0,60}$/,
  requestId: /^[0-9a-f-]{8,64}$/,
  routeId: /^[A-Z]{3,7} \/[a-zA-Z0-9/:{}._-]{0,100}$/,
  method: /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/,
  errorCode: /^[a-z][a-zA-Z0-9.]{0,60}$/,
  limitId: /^[a-z][a-zA-Z0-9.]{0,60}$/,
  sqlState: /^[0-9A-Z]{5}$/,
  draftState: /^[a-z_]{1,30}$/,
  setting: /^[A-Z][A-Z0-9_]{1,40}$/,
} as const satisfies Record<string, RegExp>;

type TextField = keyof typeof SHAPES;

type LogRecord = { readonly event: string } & Partial<Record<Exclude<TextField, "event">, string>> & {
    readonly status?: number;
    readonly durationMs?: number;
    readonly settings?: readonly string[];
  };

export type LogLine = Record<string, string | number | readonly string[]>;
export type LogSink = (level: LogLevel, line: LogLine) => void;

const RANK: Readonly<Record<LogLevel, number>> = { debug: 0, info: 1, warn: 2, error: 3 };

function clean(record: LogRecord): LogLine {
  const line: LogLine = {};
  for (const [key, value] of Object.entries(record)) {
    if (Object.hasOwn(SHAPES, key) && typeof value === "string" && SHAPES[key as TextField].test(value))
      line[key] = value;
    else if ((key === "status" || key === "durationMs") && Number.isFinite(value)) line[key] = value as number;
    else if (key === "settings" && Array.isArray(value)) {
      line[key] = value.filter(
        (setting): setting is string => typeof setting === "string" && SHAPES.setting.test(setting),
      );
    }
  }
  return line;
}

export type Logger = Readonly<Record<LogLevel, (record: LogRecord) => void>>;

export function createLogger(threshold: LogLevel, sink: LogSink = consoleSink): Logger {
  const write = (level: LogLevel) => (record: LogRecord) => {
    if (RANK[level] >= RANK[threshold]) sink(level, clean(record));
  };
  return { debug: write("debug"), info: write("info"), warn: write("warn"), error: write("error") };
}

function consoleSink(level: LogLevel, line: LogLine): void {
  const text = JSON.stringify({ level, ...line });
  if (level === "error" || level === "warn") console.error(text);
  else console.log(text);
}

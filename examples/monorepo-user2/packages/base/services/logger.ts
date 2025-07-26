enum LogLevel {
  ERROR = 0,
  INFO = 1,
  LOG = 2
}

let currentLevel: LogLevel = LogLevel.LOG
if (process.env.NODE_ENV !== 'development') {
  currentLevel = LogLevel.ERROR
}

export function setLogLevel(level: LogLevel) {
  currentLevel = level
}

export function log(...args: unknown[]) {
  if (currentLevel >= LogLevel.LOG) {
    console.log('[LOG]', ...args)
  }
}

export function info(...args: unknown[]) {
  if (currentLevel >= LogLevel.INFO) {
    console.info('[INFO]', ...args)
  }
}

export function error(...args: unknown[]) {
  if (currentLevel >= LogLevel.ERROR) {
    console.error('[ERROR]', ...args)
  }
}

// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'

const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_RETRY_DELAYS_MS = [10, 20, 40, 80, 160, 320]

export interface RenameRetryOptions {
  platform?: NodeJS.Platform
  rename?: (from: string, to: string) => void
  sleep?: (ms: number) => void
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Windows refuses a rename onto a file another process holds open, such as a
// poller reading ready.json, so a short bounded retry outlasts the reader.
export function renameSyncWithRetry(
  from: string,
  to: string,
  options: RenameRetryOptions = {}
): void {
  const platform = options.platform ?? process.platform
  const rename = options.rename ?? fs.renameSync
  const sleep = options.sleep ?? sleepSync

  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to)

      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code
      const delay = RENAME_RETRY_DELAYS_MS[attempt]

      if (
        platform !== 'win32' ||
        !code ||
        !RETRYABLE_RENAME_CODES.has(code) ||
        delay === undefined
      ) {
        throw error
      }

      sleep(delay)
    }
  }
}

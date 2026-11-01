// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'

export const WEBDRIVER_REQUEST_FILE = 'webdriver-request.json'

const POLL_MS = 1000

export function webdriverRequestPathFor(readyPath: string): string {
  return path.join(path.dirname(readyPath), WEBDRIVER_REQUEST_FILE)
}

// A tool whose WebDriver session died writes this file next to ready.json and
// the dev run opens a new session, so a live run recovers without a restart.
// The file is taken before the request runs, and one request runs at a time.
export function watchWebDriverRequests(
  requestPath: string,
  onRequest: () => Promise<void>,
  pollMs: number = POLL_MS
): () => void {
  let running = false

  const tick = async () => {
    if (running || !fs.existsSync(requestPath)) return

    running = true

    try {
      fs.rmSync(requestPath, {force: true})
      await onRequest()
    } catch {
      // A failed request stamps its own reason, the watcher keeps going
    } finally {
      running = false
    }
  }

  const timer = setInterval(() => void tick(), pollMs)
  timer.unref?.()

  return () => clearInterval(timer)
}

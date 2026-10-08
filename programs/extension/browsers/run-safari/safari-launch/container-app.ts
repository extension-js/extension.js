// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {SafariPipelineTools} from './tools'

const RAISE_WAIT_MS = 5000
const QUIT_MS = 3000
const POLL_MS = 250

// The container apps this process raised, by pid. They are quit on the way
// out under the same ownership rule as the automation Safari in webdriver.ts:
// a pid that was there before `open` is a copy the user opened and stays.
const raisedApps = new Set<number>()
let handlersInstalled = false

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

function terminate(pid: number): void {
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Already gone
  }
}

function quitAllOnExit(): void {
  for (const pid of raisedApps) terminate(pid)
}

function quitAllOnSignal(): void {
  void closeSafariContainerApps()
}

function installHandlersOnce(): void {
  if (handlersInstalled) return

  handlersInstalled = true
  process.on('SIGINT', quitAllOnSignal)
  process.on('SIGTERM', quitAllOnSignal)
  process.on('SIGHUP', quitAllOnSignal)
  process.on('exit', quitAllOnExit)
}

// Records the app pids that appeared after `open`, polling because the app
// comes up a moment after `open` returns.
export async function rememberRaisedContainerApp(
  tools: SafariPipelineTools,
  appPath: string,
  before: Set<number>
): Promise<number[]> {
  const deadline = Date.now() + RAISE_WAIT_MS
  let raised: number[] = []

  while (Date.now() < deadline) {
    raised = (await tools.listAppPids(appPath)).filter(
      (pid) => !before.has(pid)
    )

    if (raised.length > 0) break

    await sleep(POLL_MS)
  }

  for (const pid of raised) raisedApps.add(pid)
  if (raised.length > 0) installHandlersOnce()

  return raised
}

export async function closeSafariContainerApps(): Promise<void> {
  const pids = [...raisedApps]
  raisedApps.clear()

  for (const pid of pids) terminate(pid)

  const deadline = Date.now() + QUIT_MS

  while (Date.now() < deadline && pids.some(processAlive)) {
    await sleep(POLL_MS)
  }
}

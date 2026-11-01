// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as http from 'node:http'
import * as net from 'node:net'
import type {SafariPipelineTools, SafariWebDriverProcess} from './tools'

const DRIVER_READY_MS = 5000
const DRIVER_POLL_MS = 100
// Creating the session raises a Safari automation window, which takes seconds
// on a cold start.
const SESSION_CREATE_MS = 30_000
const SESSION_ATTEMPTS = 2
const SESSION_CLOSE_MS = 5000
const NAVIGATE_MS = 30_000
const AUTOMATION_QUIT_MS = 3000

export const WEBDRIVER_NOT_ASKED_YET =
  'the launcher has not asked safaridriver for a session yet: it opens the app and enables the extension first, then asks, and this line is replaced by the session or by the reason it got none'

export const WEBDRIVER_SESSION_PENDING = `the launcher is asking safaridriver for a session now: each request waits up to ${SESSION_CREATE_MS / 1000} s and one Safari never answered is asked once more, and this line is replaced by the session or by the reason it got none`

export interface SafariWebDriverSession {
  port: number
  sessionId: string
  close(): Promise<void>
}

export type SafariWebDriverOutcome =
  | {session: SafariWebDriverSession; reason?: undefined}
  | {session?: undefined; reason: string}

interface DriverReply {
  status: number
  body: {value?: {sessionId?: unknown; message?: unknown; error?: unknown}}
}

const activeSessions = new Set<SafariWebDriverSession>()
const activeDrivers = new Set<SafariWebDriverProcess>()
let handlersInstalled = false

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

function driverRequest(
  port: number,
  method: string,
  pathname: string,
  body: unknown,
  timeoutMs: number
): Promise<DriverReply> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: timeoutMs
      },
      (response) => {
        let text = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => (text += chunk))
        response.on('end', () => {
          let parsed: DriverReply['body'] = {}

          try {
            parsed = text ? JSON.parse(text) : {}
          } catch {
            parsed = {value: {message: text.trim()}}
          }

          resolve({status: response.statusCode || 0, body: parsed})
        })
      }
    )

    request.on('timeout', () => request.destroy(new Error('timed out')))
    request.on('error', reject)
    request.end(payload)
  })
}

async function waitForDriver(port: number): Promise<string | null> {
  const deadline = Date.now() + DRIVER_READY_MS
  let lastError = ''

  while (Date.now() < deadline) {
    try {
      const reply = await driverRequest(port, 'GET', '/status', undefined, 1000)
      if (reply.status === 200) return null

      lastError = `HTTP ${reply.status}`
    } catch (error) {
      lastError = String((error as Error)?.message || error)
    }

    await new Promise((resolve) => setTimeout(resolve, DRIVER_POLL_MS))
  }

  return `safaridriver did not answer on port ${port} within ${DRIVER_READY_MS}ms (${lastError})`
}

function refusalReason(reply: DriverReply): string {
  const value = reply.body?.value
  const message = typeof value?.message === 'string' ? value.message.trim() : ''
  if (message) return message

  const error = typeof value?.error === 'string' ? value.error.trim() : ''

  return error || `safaridriver answered HTTP ${reply.status}`
}

function stopAllDriversOnExit() {
  for (const driver of activeDrivers) driver.stop()
}

function closeAllOnSignal() {
  void closeSafariWebDriverSessions()
}

function installHandlersOnce() {
  if (handlersInstalled) return

  handlersInstalled = true
  process.on('SIGINT', closeAllOnSignal)
  process.on('SIGTERM', closeAllOnSignal)
  process.on('SIGHUP', closeAllOnSignal)
  process.on('exit', stopAllDriversOnExit)
}

// Ends every session this process opened: the session first, so Safari closes
// its automation window, then the driver that owned it.
export async function closeSafariWebDriverSessions(): Promise<void> {
  await Promise.all([...activeSessions].map((session) => session.close()))
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

// Safari's automation instance outlives both the deleted session and the
// driver, so the one this session raised is quit by pid. Only pids that were
// not there before the driver spawned qualify, a Safari the user had open
// stays, automation flag or not.
async function quitRaisedAutomation(
  tools: SafariPipelineTools,
  before: Set<number>
): Promise<void> {
  const raised = (await tools.listAutomationPids()).filter(
    (pid) => !before.has(pid)
  )

  for (const pid of raised) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // Already gone
    }
  }

  const deadline = Date.now() + AUTOMATION_QUIT_MS

  while (Date.now() < deadline && raised.some(processAlive)) {
    await new Promise((resolve) => setTimeout(resolve, DRIVER_POLL_MS))
  }
}

// Points the automation window at a page. Answers null once Safari loaded it,
// or the reason it did not.
export async function navigateSafariWebDriverSession(
  session: Pick<SafariWebDriverSession, 'port' | 'sessionId'>,
  url: string
): Promise<string | null> {
  try {
    const reply = await driverRequest(
      session.port,
      'POST',
      `/session/${session.sessionId}/url`,
      {url},
      NAVIGATE_MS
    )

    return reply.status === 200 ? null : refusalReason(reply)
  } catch (error) {
    return `the navigation request failed: ${String(
      (error as Error)?.message || error
    )}`
  }
}

// What a session request that never answered leaves behind, read off the
// process table: a Safari automation instance that was already up before this
// driver spawned belongs to another session, and Safari serves one at a time.
// Remote Automation being off is never the cause, safaridriver refuses that at
// once in its own words.
function asSeconds(ms: number): number {
  return Number((ms / 1000).toFixed(1))
}

export function describeSessionTimeout(input: {
  waitedMs: number
  before: number[]
  after: number[]
}): {reason: string; retry: boolean} {
  const seconds = asSeconds(input.waitedMs)
  const waited = `safaridriver did not answer the session request within ${seconds} s`

  if (input.before.length > 0) {
    return {
      retry: false,
      reason: `${waited}: Safari already runs an automation instance from another WebDriver session (pid ${input.before.join(', ')}), and Safari serves one session at a time. End that session or quit that automation Safari, then run again`
    }
  }

  const raised = input.after.filter((pid) => !input.before.includes(pid))

  if (raised.length === 0) {
    return {
      retry: true,
      reason: `${waited}, and Safari never started its automation instance: Safari holds the request behind a window that waits for an answer (Safari Settings, a password prompt or a dialog). Close it in Safari, then run again`
    }
  }

  return {
    retry: true,
    reason: `${waited}: Safari started its automation instance (pid ${raised.join(', ')}) but did not open the automation window, which a dialog or a prompt in Safari holds. Answer it in Safari, then run again`
  }
}

export interface SafariWebDriverOptions {
  createMs?: number
  attempts?: number
}

async function requestSession(
  tools: SafariPipelineTools,
  createMs: number
): Promise<
  | {session: SafariWebDriverSession; reason?: undefined; retry?: undefined}
  | {session?: undefined; reason: string; retry: boolean}
> {
  let port: number

  try {
    port = await freePort()
  } catch (error) {
    return {
      reason: `no free port for safaridriver: ${String(error)}`,
      retry: false
    }
  }

  const before = new Set(await tools.listAutomationPids())
  const driver = await tools.startWebDriver(port)

  if (!driver.ok) {
    return {
      reason: `safaridriver could not start: ${driver.output}`,
      retry: false
    }
  }

  activeDrivers.add(driver)
  installHandlersOnce()

  const stopDriver = async () => {
    driver.stop()
    activeDrivers.delete(driver)
    await quitRaisedAutomation(tools, before)
  }

  const notReady = await waitForDriver(port)

  if (notReady) {
    await stopDriver()

    return {reason: notReady, retry: false}
  }

  let created: DriverReply

  try {
    created = await driverRequest(
      port,
      'POST',
      '/session',
      {capabilities: {alwaysMatch: {browserName: 'safari'}}},
      createMs
    )
  } catch (error) {
    const message = String((error as Error)?.message || error)

    if (message !== 'timed out') {
      await stopDriver()

      return {
        reason: `the WebDriver session request failed: ${message}`,
        retry: false
      }
    }

    const after = await tools.listAutomationPids()
    await stopDriver()
    const timeout = describeSessionTimeout({
      waitedMs: createMs,
      before: [...before],
      after
    })

    return {
      reason: `the WebDriver session request failed: ${timeout.reason}`,
      retry: timeout.retry
    }
  }

  const sessionId = created.body?.value?.sessionId

  if (created.status !== 200 || typeof sessionId !== 'string' || !sessionId) {
    await stopDriver()

    return {reason: refusalReason(created), retry: false}
  }

  let closing: Promise<void> | null = null

  const session: SafariWebDriverSession = {
    port,
    sessionId,
    close: () => {
      if (closing) return closing

      closing = (async () => {
        activeSessions.delete(session)

        try {
          await driverRequest(
            port,
            'DELETE',
            `/session/${sessionId}`,
            undefined,
            SESSION_CLOSE_MS
          )
        } catch {
          // The driver may already be gone, the stop below covers it
        }

        await stopDriver()
      })()

      return closing
    }
  }

  activeSessions.add(session)

  return {session}
}

export async function openSafariWebDriverSession(
  tools: SafariPipelineTools,
  options: SafariWebDriverOptions = {}
): Promise<SafariWebDriverOutcome> {
  const createMs = options.createMs ?? SESSION_CREATE_MS
  const attempts = Math.max(1, options.attempts ?? SESSION_ATTEMPTS)
  const reasons: string[] = []

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const outcome = await requestSession(tools, createMs)

    if (outcome.session) return {session: outcome.session}

    reasons.push(outcome.reason)

    if (!outcome.retry) break
  }

  if (reasons.length === 1) return {reason: reasons[0]}

  const last = reasons[reasons.length - 1]

  return {
    reason: `${last} (asked ${reasons.length} times, ${asSeconds(createMs)} s each)`
  }
}

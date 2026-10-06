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
const SESSION_CLOSE_MS = 5000
const AUTOMATION_QUIT_MS = 3000

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

export async function openSafariWebDriverSession(
  tools: SafariPipelineTools
): Promise<SafariWebDriverOutcome> {
  let port: number

  try {
    port = await freePort()
  } catch (error) {
    return {reason: `no free port for safaridriver: ${String(error)}`}
  }

  const before = new Set(await tools.listAutomationPids())
  const driver = await tools.startWebDriver(port)

  if (!driver.ok) {
    return {reason: `safaridriver could not start: ${driver.output}`}
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

    return {reason: notReady}
  }

  let created: DriverReply

  try {
    created = await driverRequest(
      port,
      'POST',
      '/session',
      {capabilities: {alwaysMatch: {browserName: 'safari'}}},
      SESSION_CREATE_MS
    )
  } catch (error) {
    await stopDriver()

    return {
      reason: `the WebDriver session request failed: ${String(
        (error as Error)?.message || error
      )}`
    }
  }

  const sessionId = created.body?.value?.sessionId

  if (created.status !== 200 || typeof sessionId !== 'string' || !sessionId) {
    await stopDriver()

    return {reason: refusalReason(created)}
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

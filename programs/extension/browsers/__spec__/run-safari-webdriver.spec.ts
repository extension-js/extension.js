import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import * as messages from '../browsers-lib/messages'
import {
  closeSafariWebDriverSessions,
  packageSafariExtension
} from '../run-safari/safari-launch'
import {
  type FakeSafariTools,
  type FakeSafariToolsOptions,
  fakeSafariTools
} from './safari-fake-tools'

const STAND_IN = `
const http = require('node:http')
const fs = require('node:fs')
const args = process.argv.slice(2)
const after = (flag) => args[args.indexOf(flag) + 1]
const port = Number(after('-p'))
const mode = after('--mode')
const log = after('--log')
const sessionId = after('--session-id')
const record = (line) => fs.appendFileSync(log, line + '\\n')
http
  .createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      record(req.method + ' ' + req.url + ' ' + body)
      const send = (status, value) => {
        res.writeHead(status, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({value}))
      }
      if (req.method === 'GET' && req.url === '/status') {
        return send(200, {ready: true, message: ''})
      }
      if (req.method === 'POST' && req.url === '/session') {
        if (mode === 'refuse') {
          return send(500, {
            error: 'session not created',
            message: 'Could not create a session: Allow Remote Automation is off'
          })
        }
        return send(200, {sessionId, capabilities: {browserName: 'Safari'}})
      }
      if (req.method === 'DELETE' && req.url === '/session/' + sessionId) {
        return send(200, null)
      }
      send(404, {error: 'unknown command', message: req.url})
    })
  })
  .listen(port, '127.0.0.1', () => record('listening ' + port))
`

function processAlive(pid: number | undefined): boolean {
  if (!pid) return false

  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

async function waitForExit(pid: number | undefined): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!processAlive(pid)) return true

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  return !processAlive(pid)
}

describe('safari dev session and its safaridriver', () => {
  let root: string
  let distDir: string
  let readyPath: string
  let standIn: string
  let driverLog: string
  let sessionId: string

  const manifest = {
    name: 'MyExt',
    permissions: ['storage'],
    content_scripts: [{matches: ['<all_urls>'], js: ['content.js']}]
  }

  function readReady() {
    return JSON.parse(fs.readFileSync(readyPath, 'utf8'))
  }

  function standInTools(mode: 'ok' | 'refuse') {
    return fakeSafariTools({
      webdriver: {
        command: process.execPath,
        args: [
          standIn,
          '--mode',
          mode,
          '--log',
          driverLog,
          '--session-id',
          sessionId
        ]
      }
    })
  }

  async function runDevPackage(
    tools: FakeSafariTools,
    host: Record<string, unknown> = {announceDevReady: true}
  ) {
    fs.mkdirSync(distDir, {recursive: true})
    fs.writeFileSync(
      path.join(distDir, 'manifest.json'),
      JSON.stringify(manifest)
    )

    const logs: string[] = []
    const record = (line: unknown) => logs.push(String(line))
    await packageSafariExtension(
      {extension: [distDir], browser: 'safari', tools, ...host} as any,
      distDir,
      {info: record, warn: record, error: record, debug: () => {}},
      'full'
    )

    return logs
  }

  function driverRequests() {
    return fs.existsSync(driverLog)
      ? fs
          .readFileSync(driverLog, 'utf8')
          .split('\n')
          .filter((line) => line && !line.startsWith('listening'))
          .map((line) => line.split(' ').slice(0, 2).join(' '))
      : []
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-safari-wd-'))
    distDir = path.join(root, 'dist', 'safari')
    readyPath = path.join(root, 'dist', 'extension-js', 'safari', 'ready.json')
    standIn = path.join(root, 'safaridriver-stand-in.cjs')
    driverLog = path.join(root, 'safaridriver.log')
    sessionId = `standin-${crypto.randomBytes(6).toString('hex')}`
    fs.mkdirSync(path.dirname(readyPath), {recursive: true})
    fs.writeFileSync(standIn, STAND_IN)
    fs.writeFileSync(
      readyPath,
      JSON.stringify({
        status: 'ready',
        browser: 'safari',
        command: 'dev',
        runId: 'run-A'
      })
    )
  })

  afterEach(async () => {
    await closeSafariWebDriverSessions()
    fs.rmSync(root, {recursive: true, force: true})
  })

  it('automation allowed: holds one session and stamps its port and id', async () => {
    const tools = standInTools('ok')
    const logs = await runDevPackage(tools)

    expect(tools.calls.webdriver).toHaveLength(1)
    const port = tools.calls.webdriver[0]
    expect(readReady()).toMatchObject({
      status: 'ready',
      runId: 'run-A',
      browserPid: 4242,
      webdriverPort: port,
      webdriverSessionId: sessionId
    })

    expect('webdriverUnavailableReason' in readReady()).toBe(false)
    expect(driverRequests()).toContain('POST /session')
    expect(driverRequests()).not.toContain(`DELETE /session/${sessionId}`)
    expect(logs).toContain(messages.safariWebDriverSession(port, sessionId))
    expect(logs).toContain(messages.safariRegistered('MyExt'))
    expect(processAlive(tools.webdriverProcesses[0]?.pid)).toBe(true)
  })

  it('stop: deletes the session it opened and ends its safaridriver', async () => {
    const tools = standInTools('ok')
    await runDevPackage(tools)
    const pid = tools.webdriverProcesses[0]?.pid

    await closeSafariWebDriverSessions()

    expect(driverRequests()).toEqual([
      'GET /status',
      'POST /session',
      `DELETE /session/${sessionId}`
    ])

    expect(await waitForExit(pid)).toBe(true)
  })

  it('automation off: stamps the refusal as the reason and carries on', async () => {
    const tools = standInTools('refuse')
    const logs = await runDevPackage(tools)
    const pid = tools.webdriverProcesses[0]?.pid

    const ready = readReady()
    expect(ready.webdriverUnavailableReason).toBe(
      'Could not create a session: Allow Remote Automation is off'
    )

    expect('webdriverPort' in ready).toBe(false)
    expect('webdriverSessionId' in ready).toBe(false)
    expect(ready).toMatchObject({status: 'ready', browserPid: 4242})
    expect(logs).toContain(
      messages.safariWebDriverUnavailable(ready.webdriverUnavailableReason)
    )

    expect(logs).toContain(messages.safariRegistered('MyExt'))
    expect(driverRequests()).not.toContain(`DELETE /session/${sessionId}`)
    expect(await waitForExit(pid)).toBe(true)
  })

  it('no safaridriver: names the spawn error as the reason and carries on', async () => {
    const tools = fakeSafariTools({
      webdriver: {spawnError: 'Error: spawn safaridriver ENOENT'}
    } satisfies FakeSafariToolsOptions)
    const logs = await runDevPackage(tools)

    expect(readReady().webdriverUnavailableReason).toBe(
      'safaridriver could not start: Error: spawn safaridriver ENOENT'
    )

    expect(tools.calls.openApp).toHaveLength(1)
    expect(logs).toContain(messages.safariRegistered('MyExt'))
  })

  it('build packaging: never starts a driver and stamps nothing about one', async () => {
    const tools = standInTools('ok')
    await runDevPackage(tools, {})

    expect(tools.calls.webdriver).toHaveLength(0)
    const ready = readReady()
    expect('webdriverPort' in ready).toBe(false)
    expect('webdriverUnavailableReason' in ready).toBe(false)
  })
})

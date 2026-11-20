import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as http from 'node:http'
import type {AddressInfo, Socket} from 'node:net'
import * as path from 'node:path'
import {pathToFileURL} from 'node:url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {trackTempFolders} from '../../__spec__/helpers/temp-folders'
import checkUpdates, {
  lookupLatest,
  resolveRegistry,
  settleUpdateCheck,
  UPDATE_CHECK_BOUND_MS,
  updateCheckWanted
} from '../check-updates'

const makeTempFolder = trackTempFolders()
type Env = Record<string, string | undefined>
const CLI = {name: 'extension', version: '2.0.0'}

interface Asked {
  url: string
  headers: http.IncomingHttpHeaders
}

type Answer = {status: number; body: string} | 'never' | 'endless'

// A loopback registry the test owns. 'never' accepts and never answers,
// 'endless' answers 200 and keeps sending body bytes until the client leaves.
async function startRegistry(answer: Answer) {
  const asked: Asked[] = []
  const sockets = new Set<Socket>()
  const closed: Socket[] = []
  const server = http.createServer((request, response) => {
    asked.push({url: String(request.url), headers: request.headers})
    if (answer === 'never') return

    response.writeHead(answer === 'endless' ? 200 : answer.status, {
      'content-type': 'application/json'
    })

    if (answer !== 'endless') {
      response.end(answer.body)

      return
    }

    const chunk = `{"pad":"${'x'.repeat(64 * 1024)}`
    const timer = setInterval(() => response.write(chunk), 5)

    response.on('close', () => clearInterval(timer))
  })

  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => closed.push(socket))
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const {port} = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}/`,
    asked,
    connections: () => sockets.size,
    closedConnections: () => closed.length,
    async close() {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

// The dist-tag document: the package.json of the version the tag names.
const latestIs = (version: string) => ({
  status: 200,
  body: JSON.stringify({name: 'extension', version})
})

const registries: Array<{close(): Promise<void>}> = []

async function registry(answer: Answer) {
  const started = await startRegistry(answer)

  registries.push(started)

  return started
}

function isolatedEnv(extra: Env = {}): Env {
  const home = makeTempFolder('extjs-update-home-')

  return {
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: path.join(home, '.cache'),
    ...extra
  }
}

function deps(env: Env, extra: object = {}) {
  return {
    env,
    homedir: () => String(env.HOME),
    readPackageJson: () => CLI,
    ...extra
  }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()

  for (const started of registries.splice(0)) await started.close()
})

describe('when the update check runs', () => {
  const rows: Array<
    [string, Parameters<typeof updateCheckWanted>[0], boolean]
  > = [
    ['dev', {command: 'dev', json: false, env: {}}, true],
    ['start', {command: 'start', json: false, env: {}}, true],
    ['preview', {command: 'preview', json: false, env: {}}, true],
    ['build', {command: 'build', json: false, env: {}}, true],
    ['create', {command: 'create', json: false, env: {}}, false],
    ['doctor', {command: 'doctor', json: false, env: {}}, false],
    ['no command', {command: undefined, json: false, env: {}}, false],
    ['build --output json', {command: 'build', json: true, env: {}}, false],
    [
      'EXTENSION_NO_UPDATE_CHECK=1',
      {command: 'dev', json: false, env: {EXTENSION_NO_UPDATE_CHECK: '1'}},
      false
    ],
    [
      'EXTENSION_NO_UPDATE_CHECK=0',
      {command: 'dev', json: false, env: {EXTENSION_NO_UPDATE_CHECK: '0'}},
      true
    ],
    [
      'NO_UPDATE_NOTIFIER=1',
      {command: 'build', json: false, env: {NO_UPDATE_NOTIFIER: '1'}},
      false
    ],
    ['CI=true', {command: 'build', json: false, env: {CI: 'true'}}, false],
    ['CI=false', {command: 'build', json: false, env: {CI: 'false'}}, true]
  ]

  it.each(rows)('%s', (_name, input, wanted) => {
    expect(updateCheckWanted(input)).toBe(wanted)
  })
})

describe('the registry the check asks', () => {
  it('takes npm_registry first, the name the earlier check read', () => {
    const env = isolatedEnv({
      npm_config_registry: 'http://127.0.0.1:1/',
      npm_registry: 'http://127.0.0.1:2/'
    })

    expect(resolveRegistry(env, () => String(env.HOME))?.href).toBe(
      'http://127.0.0.1:2/'
    )
  })

  it('then npm_config_registry, over the user .npmrc', () => {
    const env = isolatedEnv({npm_config_registry: 'http://127.0.0.1:1/mirror'})

    fs.writeFileSync(
      path.join(String(env.HOME), '.npmrc'),
      'registry=http://127.0.0.1:3/\n'
    )

    expect(resolveRegistry(env, () => String(env.HOME))?.href).toBe(
      'http://127.0.0.1:1/mirror/'
    )
  })

  it('reads the upper-case spelling too', () => {
    const env = isolatedEnv({NPM_CONFIG_REGISTRY: 'http://127.0.0.1:1/'})

    expect(resolveRegistry(env, () => String(env.HOME))?.href).toBe(
      'http://127.0.0.1:1/'
    )
  })

  it('then the registry line of the user .npmrc', () => {
    const env = isolatedEnv({MIRROR_HOST: '127.0.0.1:3'})

    fs.writeFileSync(
      path.join(String(env.HOME), '.npmrc'),
      '; a comment\nsave-exact=true\nregistry = "http://${MIRROR_HOST}/npm"\n'
    )

    expect(resolveRegistry(env, () => String(env.HOME))?.href).toBe(
      'http://127.0.0.1:3/npm/'
    )
  })

  it('then the file npm_config_userconfig names', () => {
    const env = isolatedEnv()
    const file = path.join(String(env.HOME), 'custom-npmrc')

    fs.writeFileSync(file, 'registry=http://127.0.0.1:4/\n')
    env.npm_config_userconfig = file

    expect(resolveRegistry(env, () => String(env.HOME))?.href).toBe(
      'http://127.0.0.1:4/'
    )
  })

  it('falls back to the public npm registry', () => {
    const env = isolatedEnv()

    expect(resolveRegistry(env, () => String(env.HOME))?.href).toBe(
      'https://registry.npmjs.org/'
    )
  })

  it('asks nothing when the setting cannot be read as an http URL', () => {
    for (const value of ['not a url', 'file:///tmp/registry', 'ftp://x/']) {
      const env = isolatedEnv({npm_config_registry: value})

      expect(resolveRegistry(env, () => String(env.HOME))).toBeNull()
    }
  })

  it('drops credentials written into the registry URL', () => {
    const env = isolatedEnv({
      npm_config_registry: 'http://someone:hunter2@127.0.0.1:5/'
    })

    expect(resolveRegistry(env, () => String(env.HOME))?.href).toBe(
      'http://127.0.0.1:5/'
    )
  })
})

describe('the update check against a loopback registry', () => {
  it('asks for the latest dist-tag of the CLI package only and prints the notice', async () => {
    const answering = await registry(latestIs('2.1.0'))
    const env = isolatedEnv({npm_config_registry: answering.url})
    const result = await checkUpdates(deps(env))

    expect(result?.message).toMatch(/update is available/i)
    expect(result?.suffix).toMatch(/2\.1\.0/)
    expect(answering.asked.map((entry) => entry.url)).toEqual([
      '/extension/latest'
    ])

    // Nothing that names the user, the machine or the project.
    const {headers} = answering.asked[0]

    expect(headers).toEqual({
      accept: 'application/json',
      connection: 'close',
      host: new URL(answering.url).host
    })
  })

  it('sends no credentials from the registry URL', async () => {
    const answering = await registry(latestIs('2.1.0'))
    const env = isolatedEnv({
      npm_config_registry: answering.url.replace('http://', 'http://me:pw@')
    })

    await checkUpdates(deps(env))

    expect(answering.asked).toHaveLength(1)
    expect(answering.asked[0].headers.authorization).toBeUndefined()
  })

  it('prints nothing for a prerelease latest', async () => {
    const answering = await registry(latestIs('2.1.0-beta.1'))
    const env = isolatedEnv({npm_config_registry: answering.url})

    expect(await checkUpdates(deps(env))).toBeNull()
  })

  it('prints nothing when the registry refuses', async () => {
    const answering = await registry({status: 401, body: '{}'})
    const env = isolatedEnv({npm_config_registry: answering.url})

    expect(await checkUpdates(deps(env))).toBeNull()
    expect(answering.asked).toHaveLength(1)
  })

  it('says why in debug mode when the lookup fails', async () => {
    vi.stubEnv('EXTENSION_DEBUG', '1')

    const answering = await registry({status: 500, body: '{}'})
    const env = isolatedEnv({npm_config_registry: answering.url})

    await checkUpdates(deps(env))

    expect(vi.mocked(console.error).mock.calls.join('\n')).toMatch(
      /Couldn't check for updates/
    )
  })

  it('reuses an answer for an hour, per registry, in the user cache folder', async () => {
    const first = await registry(latestIs('2.1.0'))
    const second = await registry(latestIs('2.2.0'))
    const env = isolatedEnv({npm_config_registry: first.url})
    let now = 1_000_000

    const at = (url: string) => ({
      ...deps({...env, npm_config_registry: url}),
      now: () => now
    })

    expect((await checkUpdates(at(first.url)))?.suffix).toMatch(/2\.1\.0/)
    expect((await checkUpdates(at(first.url)))?.suffix).toMatch(/2\.1\.0/)
    expect(first.asked).toHaveLength(1)

    // Another registry never gets the first one's answer.
    expect((await checkUpdates(at(second.url)))?.suffix).toMatch(/2\.2\.0/)
    expect(second.asked).toHaveLength(1)

    now += 3_600_001
    await checkUpdates(at(first.url))
    expect(first.asked).toHaveLength(2)

    const cacheFolder = path.join(String(env.XDG_CACHE_HOME), 'extensionjs')

    expect(fs.readdirSync(cacheFolder)).toEqual(['update-check.json'])
  })

  it('a registry that never answers ends the check within its bound', async () => {
    const silent = await registry('never')
    const env = isolatedEnv({npm_config_registry: silent.url})
    const started = Date.now()

    expect(await checkUpdates(deps(env, {boundMs: 300}))).toBeNull()
    expect(Date.now() - started).toBeLessThan(UPDATE_CHECK_BOUND_MS)
    // The request is torn down, not left open on the socket. The server side
    // can see the connection after the client gave up, so both are awaited.
    await vi.waitFor(() => {
      expect(silent.connections()).toBe(1)
      expect(silent.closedConnections()).toBe(1)
    })
  })

  it('the default bound is two seconds', () => {
    expect(UPDATE_CHECK_BOUND_MS).toBe(2000)
  })

  // The CLI never awaits the check, so a pending one must not hold the process.
  it('a pending lookup does not keep a process alive', async () => {
    const silent = await registry('never')
    const scratch = makeTempFolder('extjs-update-child-')
    const script = path.join(scratch, 'pending-lookup.mjs')
    const moduleUrl = pathToFileURL(
      path.join(__dirname, '..', 'check-updates.ts')
    )

    // A ref'd 1 s timer gives the lookup time to connect, then nothing else runs.
    fs.writeFileSync(
      script,
      `const mod = await import(${JSON.stringify(moduleUrl.href)})\n` +
        `const lookupLatest = mod.lookupLatest ?? mod.default.lookupLatest\n` +
        `lookupLatest('extension', new URL(${JSON.stringify(silent.url)}), 60000).catch(() => {})\n` +
        'setTimeout(() => {}, 1000)\n'
    )

    const child = spawn(process.execPath, ['--import', 'tsx', script], {
      cwd: path.join(__dirname, '..', '..'),
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {...process.env, NODE_NO_WARNINGS: '1'}
    })
    let stderr = ''

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    const started = Date.now()
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const guard = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error('the child was still alive after 30 s'))
      }, 30_000)

      child.once('exit', (code) => {
        clearTimeout(guard)
        resolve(code)
      })
    })

    expect(exitCode, stderr).toBe(0)
    expect(silent.asked).toHaveLength(1)
    expect(Date.now() - started).toBeLessThan(30_000)
  })

  it('lookupLatest rejects on a bound, never later', async () => {
    const silent = await registry('never')

    await expect(
      lookupLatest('extension', new URL(silent.url), 200)
    ).rejects.toThrow(/200 ms/)
  })

  it('an answer over 1 MB is cut off before the bound', async () => {
    const endless = await registry('endless')
    const started = Date.now()

    await expect(
      lookupLatest('extension', new URL(endless.url), 30_000)
    ).rejects.toThrow(/over 1 MB/)

    expect(Date.now() - started).toBeLessThan(30_000)
    await vi.waitFor(() => expect(endless.closedConnections()).toBe(1))
  })

  it('an oversized answer gives no notice', async () => {
    const endless = await registry('endless')
    const env = isolatedEnv({npm_config_registry: endless.url})

    expect(await checkUpdates(deps(env, {boundMs: 30_000}))).toBeNull()
  })
})

describe('holding a finished command for its update check', () => {
  function timers() {
    const armed: Array<{run: () => void; ms: number}> = []
    const cleared: unknown[] = []

    return {
      armed,
      cleared,
      set: (run: () => void, ms: number) => armed.push({run, ms}),
      clear: (timer: unknown) => cleared.push(timer)
    }
  }

  it.each([
    ['answers', () => Promise.resolve('a notice')],
    ['fails', () => Promise.reject(new Error('refused'))]
  ])('ends as soon as the check %s, and lets the timer go', async (_name, check) => {
    const clock = timers()

    await settleUpdateCheck(check(), 2000, clock)

    expect(clock.armed.map(({ms}) => ms)).toEqual([2000])
    expect(clock.cleared).toEqual([1])
  })

  it('ends at the bound when the check never settles', async () => {
    const clock = timers()
    let ended = false
    const settled = settleUpdateCheck(new Promise(() => {}), 2000, clock).then(
      () => {
        ended = true
      }
    )

    await Promise.resolve()
    expect(ended).toBe(false)

    clock.armed[0].run()
    await settled

    expect(ended).toBe(true)
  })
})

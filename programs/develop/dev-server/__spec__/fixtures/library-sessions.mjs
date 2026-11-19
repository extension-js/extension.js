import fs from 'node:fs'
import path from 'node:path'
import {endSessionAsFailed, extensionDev} from '../../../dist/module.mjs'

// A host that goes on running: dev sessions started from the built library,
// each ended by a failure, and what the process still holds after them.
const [scenario, root] = process.argv.slice(2)

const HOST_EVENTS = [
  'exit',
  'SIGINT',
  'SIGTERM',
  'SIGHUP',
  'uncaughtException',
  'unhandledRejection'
]

const listeners = () => HOST_EVENTS.map((event) => process.listenerCount(event))

const listening = () =>
  process
    ._getActiveHandles()
    .filter((handle) => handle?.listening === true)
    .map((handle) => handle.address()?.port)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// The names of the variables that differ from a copy of the environment.
const envCopy = () => ({...process.env})

const envChangedSince = (before) =>
  [...new Set([...Object.keys(before), ...Object.keys(process.env)])]
    .filter((name) => before[name] !== process.env[name])
    .sort()

async function until(read, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (read()) return true

    await wait(50)
  }

  return false
}

// What each failure needs from the config a project ships.
const CONFIGS = {
  // Refused before a compiler exists.
  config: `export default {config: () => { throw new Error('config hook broke') }}`,
  // Thrown while the bundle is wired, after the compiler exists.
  bundle: `export default {config: (config) => {
    config.plugins = [...(config.plugins || []), {apply(compiler) {
      compiler.hooks.done.tapPromise = () => { throw new Error('tap broke') }
    }}]
    return config
  }}`,
  // The server cannot start, on the first start or on the one a marker picks.
  start: `import fs from 'node:fs'
  import path from 'node:path'
  const marker = path.join(import.meta.dirname, 'break-next-start')
  export default {config: (config) => {
    config.plugins = [...(config.plugins || []), {apply(compiler) {
      if (process.env.FAIL_FIRST_START === '1' || fs.existsSync(marker)) {
        compiler.watch = () => { throw new Error('watch broke') }
      }
    }}]
    return config
  }}`
}

const manifest = (extra = {}) =>
  JSON.stringify({
    manifest_version: 3,
    name: 'library-session',
    version: '0.0.0',
    background: {service_worker: 'bg.js'},
    ...extra
  })

function project(name, config) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0', type: 'module'})
  )

  fs.writeFileSync(path.join(dir, 'manifest.json'), manifest())
  fs.writeFileSync(path.join(dir, 'bg.js'), "console.log('bg')\n")
  fs.writeFileSync(path.join(dir, 'cs.js'), "console.log('cs')\n")
  fs.writeFileSync(path.join(dir, 'extension.config.js'), config)

  return dir
}

const distManifest = (dir) =>
  path.join(dir, 'dist', 'chromium', 'manifest.json')

// The run the contract on disk names, read once its session has ended.
function readyField(dir, field) {
  const file = path.join(dir, 'dist', 'extension-js', 'chromium', 'ready.json')

  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))[field] ?? null
  } catch {
    return null
  }
}

const readyRunId = (dir) => readyField(dir, 'runId')

function start(dir, options = {}) {
  let ready = false
  const session = extensionDev(dir, {
    ...options,
    browser: 'chromium',
    noBrowser: true,
    port: 0,
    install: false,
    // As a CLI host does, for the terminal frame the engine writes.
    hintFor: (code) => `host hint for ${code}`,
    onReady: () => {
      ready = true
    }
  }).then(
    () => ({started: true}),
    (error) => ({
      started: false,
      code: error?.code,
      message: String(error?.message ?? error).split('\n')[0],
      instanceId: error?.session?.instanceId,
      runId: error?.session?.runId,
      readyRunId: readyRunId(dir),
      framed: error?.framed
    })
  )

  return {session, isReady: () => ready}
}

// The node:fs functions a session could patch, to compare with later.
const fsSurface = () => [
  fs.writeFile,
  fs.writeFileSync,
  fs.createWriteStream,
  fs.open,
  fs.openSync,
  fs.rename,
  fs.renameSync,
  fs.promises.writeFile
]

// A host's own write to a session's output manifest lands on disk.
function manifestWriteGoesThrough(dir) {
  const file = distManifest(dir)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, '{"written": "by the host"}')

  try {
    return fs.readFileSync(file, 'utf8') === '{"written": "by the host"}'
  } catch {
    return false
  }
}

async function failingStarts() {
  if (scenario === 'start') process.env.FAIL_FIRST_START = '1'

  const dir = project('failing', CONFIGS[scenario])
  const before = listeners()
  const sessions = []

  for (let index = 0; index < 4; index++) {
    const env = envCopy()
    const session = await start(dir).session

    sessions.push({...session, envChanged: envChangedSince(env)})
  }

  // A closing socket leaves the handle list a moment after its close.
  const socketsClosed = await until(() => listening().length === 0, 5000)

  return {
    before,
    after: listeners(),
    sessions,
    socketsClosed,
    listening: listening(),
    instanceIdLeft: process.env.EXTENSION_INSTANCE_ID ?? null,
    manifestWriteGoesThrough: manifestWriteGoesThrough(dir)
  }
}

// Two sessions live at once. The newer one loses its server at a restart
// and is released, and the older one must go on restarting.
async function restartWhileAnotherSessionLives() {
  const before = listeners()
  const fsBefore = fsSurface()
  const older = project('older', CONFIGS.start)
  const newer = project('newer', CONFIGS.start)
  const a = start(older)
  const olderStarted = await a.session
  await until(() => a.isReady())

  // What the older session alone holds, which the newer one must give back.
  const olderAlone = listeners()
  const envWithOlderAlone = envCopy()
  const b = start(newer)
  const started = [olderStarted, await b.session]
  const bothReady = await until(() => a.isReady() && b.isReady())
  const live = listeners()
  const listeningLive = listening().length
  const fsAsFoundWhileLive = fsSurface().every(
    (fn, index) => fn === fsBefore[index]
  )
  const manifestWriteGoesThroughWhileLive = manifestWriteGoesThrough(newer)
  const withContentScript = manifest({
    content_scripts: [{matches: ['https://example.com/*'], js: ['cs.js']}]
  })

  fs.writeFileSync(path.join(newer, 'break-next-start'), 'x')
  fs.writeFileSync(path.join(newer, 'manifest.json'), withContentScript)

  const newerReleased = await until(
    () =>
      listeners().join() !== live.join() && listening().length < listeningLive
  )
  // The exit listener comes off last, after the server, bridge and port.
  const newerSettled = await until(
    () => listeners().join() === olderAlone.join()
  )
  const afterNewerEnded = listeners()
  const envChangedByNewer = envChangedSince(envWithOlderAlone)

  fs.writeFileSync(path.join(older, 'manifest.json'), withContentScript)

  // Only a compiler built for the new entry list emits the content script.
  const olderRestarted = await until(() => {
    try {
      return fs
        .readdirSync(path.join(older, 'dist', 'chromium', 'content_scripts'))
        .some((name) => /^content-0\..*\.js$/.test(name))
    } catch {
      return false
    }
  })

  return {
    before,
    olderAlone,
    live,
    afterNewerEnded,
    newerSettled,
    envChangedByNewer,
    started,
    bothReady,
    fsAsFoundWhileLive,
    manifestWriteGoesThroughWhileLive,
    newerReleased,
    olderRestarted
  }
}

// As the CLI host does: the session exits the process, and a signal the host
// sends itself next changes nothing. Windows ends a process on any signal.
async function endedAsFailedByTheCli() {
  const before = endSessionAsFailed('E_PARENT_GONE', 'too early')
  const session = start(project('ended', CONFIGS.start), {exitOnError: true})
  await session.session
  await until(() => session.isReady())

  const ended = endSessionAsFailed('E_PARENT_GONE', 'the owner is gone')

  process.on('exit', (code) => {
    fs.writeSync(
      1,
      `\nRESULT ${JSON.stringify({before, ended, exitCode: code})}\n`
    )
  })

  if (process.platform !== 'win32') process.kill(process.pid, 'SIGTERM')

  await wait(30000)

  return {before, ended, exitCode: null}
}

// A library host ends the newer of two sessions as failed and goes on, and
// the older one keeps its server and restarts on the next entry change.
async function endedAsFailedByALibraryHost() {
  const older = project('older', CONFIGS.start)
  const newer = project('newer', CONFIGS.start)
  const a = start(older)
  await a.session
  await until(() => a.isReady())
  const olderAlone = listeners()
  const b = start(newer)
  await b.session
  const bothReady = await until(() => a.isReady() && b.isReady())
  const unknown = endSessionAsFailed('E_PARENT_GONE', 'gone', 'no-such-id')
  const ended = endSessionAsFailed('E_PARENT_GONE', 'the owner is gone')
  const again = endSessionAsFailed(
    'E_PARENT_GONE',
    'gone',
    readyField(newer, 'instanceId')
  )
  const newerSettled = await until(
    () => listeners().join() === olderAlone.join()
  )

  fs.writeFileSync(
    path.join(older, 'manifest.json'),
    manifest({
      content_scripts: [{matches: ['https://example.com/*'], js: ['cs.js']}]
    })
  )

  const olderRestarted = await until(() => {
    try {
      return fs
        .readdirSync(path.join(older, 'dist', 'chromium', 'content_scripts'))
        .some((name) => /^content-0\..*\.js$/.test(name))
    } catch {
      return false
    }
  })

  return {
    bothReady,
    unknown,
    ended,
    again,
    newerSettled,
    olderRestarted,
    olderId: readyField(older, 'instanceId'),
    newerId: readyField(newer, 'instanceId'),
    newerStatus: readyField(newer, 'status'),
    newerEndedAs: readyField(newer, 'endedAsFailedCode')
  }
}

// A launcher that refuses a pin the way the real one does: it stamps the
// contract, then throws the usage code. The library host is released.
async function usageRefusalKeepsTheContract() {
  const before = listeners()
  const dir = project('usage', CONFIGS.start)
  const file = path.join(dir, 'dist', 'extension-js', 'chromium', 'ready.json')
  let launches = 0

  const launcher = async () => {
    launches += 1
    const ready = JSON.parse(fs.readFileSync(file, 'utf8'))
    Object.assign(ready, {
      status: 'error',
      code: 'browser_launch_failed',
      message:
        'the chromium process could not start (bad pin), nothing is running',
      browserLaunchFailedAt: new Date().toISOString(),
      browserLaunchFailedReason: 'bad pin',
      browserLaunchFailedCode: 'E_BROWSER_BINARY_INVALID'
    })

    fs.writeFileSync(file, JSON.stringify(ready))

    throw Object.assign(new Error('bad pin'), {
      code: 'E_BROWSER_BINARY_INVALID'
    })
  }

  const started = await extensionDev(dir, {
    browser: 'chromium',
    port: 0,
    install: false,
    launcher
  }).then(
    () => true,
    () => false
  )
  // The watch closes during the release, and the exit listener comes off last.
  const released = await until(() => listeners().join() === before.join())
  const ready = JSON.parse(fs.readFileSync(file, 'utf8'))

  return {
    started,
    launches,
    released,
    ready: {
      status: ready.status,
      code: ready.code,
      browserLaunchFailedCode: ready.browserLaunchFailedCode,
      endedAsFailedCode: ready.endedAsFailedCode
    }
  }
}

// Two starts of one project and browser in one tick: one runs, the other is
// refused, and once the first has ended a new start is taken.
async function twoStartsInOneTick() {
  const before = listeners()
  const dir = project('same', CONFIGS.start)
  const first = start(dir)
  const second = start(dir)
  const results = [await first.session, await second.session]
  const running = [first, second][results.findIndex((r) => r.started)]
  await until(() => running?.isReady())
  const firstId = readyField(dir, 'instanceId')
  const ended = endSessionAsFailed('E_PARENT_GONE', 'the owner is gone')
  const released = await until(() => listeners().join() === before.join())
  const third = start(dir)
  const thirdResult = await third.session
  await until(() => third.isReady())
  endSessionAsFailed('E_PARENT_GONE', 'done')
  await until(() => listeners().join() === before.join())

  return {
    results: results.map(({started, code, framed}) => ({
      started,
      code,
      framed
    })),
    firstId,
    ended,
    released,
    third: {started: thirdResult.started, code: thirdResult.code}
  }
}

// The wiring after the server starts throws: the claim must come off with
// the rest, so the next start of the project runs.
async function wiringThrowsAfterTheServerStarts() {
  const before = listeners()
  const dir = project('wiring', CONFIGS.start)
  const on = process.on
  let armed = true

  process.on = function (event, listener) {
    if (armed && event === 'uncaughtException') {
      armed = false

      throw new Error('the host refused a listener')
    }

    return on.call(this, event, listener)
  }

  const first = await start(dir).session
  process.on = on
  const released = await until(() => listeners().join() === before.join())
  const second = start(dir)
  const secondResult = await second.session
  await until(() => second.isReady())
  endSessionAsFailed('E_PARENT_GONE', 'done')
  await until(() => listeners().join() === before.join())

  return {
    first: {started: first.started, message: first.message},
    released,
    second: {started: secondResult.started, code: secondResult.code}
  }
}

// The engine is loaded and no session is live: the host's call is answered
// false, and nothing the engine left behind writes a frame after it.
async function endedBeforeAnySession() {
  const before = listeners()
  const ended = endSessionAsFailed('E_PARENT_GONE', 'no session yet')
  const after = listeners()

  process.stdout.write(`\nRESULT ${JSON.stringify({ended, before, after})}\n`)

  if (process.platform === 'win32') process.exit(1)

  process.kill(process.pid, 'SIGTERM')
  await wait(30000)
  process.exit(1)
}

const result =
  scenario === 'usage-refusal'
    ? await usageRefusalKeepsTheContract()
    : scenario === 'same-tick'
      ? await twoStartsInOneTick()
      : scenario === 'wiring'
        ? await wiringThrowsAfterTheServerStarts()
        : scenario === 'end-before-session'
          ? await endedBeforeAnySession()
          : scenario === 'restart'
            ? await restartWhileAnotherSessionLives()
            : scenario === 'end-as-failed'
              ? await endedAsFailedByALibraryHost()
              : scenario === 'end-as-failed-cli'
                ? await endedAsFailedByTheCli()
                : await failingStarts()

process.stdout.write(`\nRESULT ${JSON.stringify(result)}\n`)
process.exit(0)

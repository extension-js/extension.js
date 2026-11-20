import {EventEmitter} from 'node:events'
import fs from 'node:fs'
import path from 'node:path'
import {
  endSessionAsFailed,
  extensionBuild,
  extensionDev
} from '../../../dist/module.mjs'

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

// What the scenarios wait for is announced here: a host listener added or
// removed, a session ready, a server closed. Each wait checks again on
// those events, so none races a short fixed budget.
const changed = new EventEmitter()
const announce = () => setImmediate(() => changed.emit('change'))

process.on('newListener', announce)
process.on('removeListener', announce)

// Every server listening now says when it closes.
function watchServers() {
  for (const handle of process._getActiveHandles()) {
    if (handle?.listening === true) handle.once?.('close', announce)
  }
}

// One deadline for the whole scenario, below the spec's own process timeout.
// A wait still open then answers false and is named in the STUCK line, so a
// scenario that chains several never ends as a kill with no result.
const SCENARIO_DEADLINE_MS =
  Number(process.env.LIBRARY_HOST_DEADLINE_MS) || 120_000
const STEP_GRACE_MS = 15_000
const RECHECK_MS = 250
const deadline = Date.now() + SCENARIO_DEADLINE_MS
const stuckWaits = []

const stuckLine = () =>
  stuckWaits.length > 0 ? `\nSTUCK ${JSON.stringify(stuckWaits)}` : ''

// A step that is no wait (a start that never settles) has no false to give,
// so the host says where it stood and exits before the spec would kill it.
setTimeout(() => {
  stuckWaits.push('a step that is not a wait')
  fs.writeSync(1, `${stuckLine()}\n`)
  process.exit(1)
}, SCENARIO_DEADLINE_MS + STEP_GRACE_MS).unref()

// The beat covers what no event announces, such as an output file the
// session wrote.
function until(name, read) {
  return new Promise((resolve) => {
    const finish = (value) => {
      clearTimeout(cap)
      clearInterval(beat)
      changed.off('change', check)
      resolve(value)
    }

    const check = () => {
      if (read()) finish(true)
    }

    const cap = setTimeout(
      () => {
        stuckWaits.push(name)
        finish(false)
      },
      Math.max(0, deadline - Date.now())
    )
    const beat = setInterval(check, RECHECK_MS)

    changed.on('change', check)
    check()
  })
}

// Kept alive until the process ends, the exit the scenario is about.
const untilThisProcessEnds = () =>
  new Promise(() => {
    setInterval(() => {}, 60_000)
  })

// The names of the variables that differ from a copy of the environment.
const envCopy = () => ({...process.env})

const envChangedSince = (before) =>
  [...new Set([...Object.keys(before), ...Object.keys(process.env)])]
    .filter((name) => before[name] !== process.env[name])
    .sort()

// A content script emitted by the compiler a restart built for it.
const untilContentScript = (dir) =>
  until('the content script of a restart', () => {
    try {
      return fs
        .readdirSync(path.join(dir, 'dist', 'chromium', 'content_scripts'))
        .some((name) => /^content-0\..*\.js$/.test(name))
    } catch {
      return false
    }
  })

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
      announce()
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
  // The config reads it, so it is on process.env until the session ends.
  fs.writeFileSync(path.join(dir, '.env'), 'EXTENSION_PUBLIC_HOST_PROBE=1\n')
  const before = listeners()
  const sessions = []

  for (let index = 0; index < 4; index++) {
    const env = envCopy()
    const session = await start(dir).session

    sessions.push({...session, envChanged: envChangedSince(env)})
  }

  // A closing socket leaves the handle list a moment after its close.
  watchServers()
  const socketsClosed = await until(
    'every socket closed',
    () => listening().length === 0
  )

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
  const envBefore = envCopy()
  const fsBefore = fsSurface()
  const older = project('older', CONFIGS.start)
  const newer = project('newer', CONFIGS.start)
  const a = start(older)
  const olderStarted = await a.session
  await until('the older session ready', () => a.isReady())

  // What the older session alone holds, which the newer one must give back.
  const olderAlone = listeners()
  const envWithOlderAlone = envCopy()
  const b = start(newer)
  const started = [olderStarted, await b.session]
  const bothReady = await until(
    'both sessions ready',
    () => a.isReady() && b.isReady()
  )
  const live = listeners()
  // Where a session listens is its own, so no live session writes it here.
  const coordinatesInEnvWhileLive = envChangedSince(envBefore).filter((name) =>
    /^EXTENSION_(DEV_SERVER_|CONTROL_PORT$|INSTANCE_ID$)/.test(name)
  )
  const listeningLive = listening().length
  const fsAsFoundWhileLive = fsSurface().every(
    (fn, index) => fn === fsBefore[index]
  )
  const manifestWriteGoesThroughWhileLive = manifestWriteGoesThrough(newer)
  const withContentScript = manifest({
    content_scripts: [{matches: ['https://example.com/*'], js: ['cs.js']}]
  })

  fs.writeFileSync(path.join(newer, 'break-next-start'), 'x')
  watchServers()
  fs.writeFileSync(path.join(newer, 'manifest.json'), withContentScript)

  const newerReleased = await until(
    'the newer session released',
    () =>
      listeners().join() !== live.join() && listening().length < listeningLive
  )
  // The exit listener comes off last, after the server, bridge and port.
  const newerSettled = await until(
    'the newer session settled',
    () => listeners().join() === olderAlone.join()
  )
  const afterNewerEnded = listeners()
  const envChangedByNewer = envChangedSince(envWithOlderAlone)

  fs.writeFileSync(path.join(older, 'manifest.json'), withContentScript)

  // Only a compiler built for the new entry list emits the content script.
  const olderRestarted = await untilContentScript(older)

  return {
    before,
    olderAlone,
    live,
    afterNewerEnded,
    newerSettled,
    envChangedByNewer,
    coordinatesInEnvWhileLive,
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
  await until('the session ready', () => session.isReady())

  const ended = endSessionAsFailed('E_PARENT_GONE', 'the owner is gone')

  process.on('exit', (code) => {
    fs.writeSync(
      1,
      `${stuckLine()}\nRESULT ${JSON.stringify({before, ended, exitCode: code})}\n`
    )
  })

  if (process.platform !== 'win32') process.kill(process.pid, 'SIGTERM')

  await untilThisProcessEnds()

  return {before, ended, exitCode: null}
}

// A library host ends the newer of two sessions as failed and goes on, and
// the older one keeps its server and restarts on the next entry change.
async function endedAsFailedByALibraryHost() {
  const older = project('older', CONFIGS.start)
  const newer = project('newer', CONFIGS.start)
  const a = start(older)
  await a.session
  await until('the older session ready', () => a.isReady())
  const olderAlone = listeners()
  const b = start(newer)
  await b.session
  const bothReady = await until(
    'both sessions ready',
    () => a.isReady() && b.isReady()
  )
  const unknown = endSessionAsFailed('E_PARENT_GONE', 'gone', 'no-such-id')
  const ended = endSessionAsFailed('E_PARENT_GONE', 'the owner is gone')
  const again = endSessionAsFailed(
    'E_PARENT_GONE',
    'gone',
    readyField(newer, 'instanceId')
  )
  const newerSettled = await until(
    'the newer session settled',
    () => listeners().join() === olderAlone.join()
  )

  fs.writeFileSync(
    path.join(older, 'manifest.json'),
    manifest({
      content_scripts: [{matches: ['https://example.com/*'], js: ['cs.js']}]
    })
  )

  const olderRestarted = await untilContentScript(older)

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
  const released = await until(
    'the host listeners released',
    () => listeners().join() === before.join()
  )
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
  await until('the running start ready', () => running?.isReady())
  const firstId = readyField(dir, 'instanceId')
  const ended = endSessionAsFailed('E_PARENT_GONE', 'the owner is gone')
  const released = await until(
    'the host listeners released',
    () => listeners().join() === before.join()
  )
  const third = start(dir)
  const thirdResult = await third.session
  await until('the third start ready', () => third.isReady())
  endSessionAsFailed('E_PARENT_GONE', 'done')
  await until(
    'the last session released',
    () => listeners().join() === before.join()
  )

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
  const released = await until(
    'the host listeners released',
    () => listeners().join() === before.join()
  )
  const second = start(dir)
  const secondResult = await second.session
  await until('the second start ready', () => second.isReady())
  endSessionAsFailed('E_PARENT_GONE', 'done')
  await until(
    'the last session released',
    () => listeners().join() === before.join()
  )

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
  await untilThisProcessEnds()
  process.exit(1)
}

// A dev session holds the project's env files, and a build of the same
// project that ends beside it must leave them where the session reads them.
async function buildBesideALiveSession() {
  const before = listeners()
  const dir = project('held', CONFIGS.start)
  fs.writeFileSync(path.join(dir, '.env'), 'EXTENSION_PUBLIC_HOST_PROBE=1\n')
  const session = start(dir)
  await session.session
  await until('the session ready', () => session.isReady())

  const built = await extensionBuild(dir, {
    browser: 'firefox',
    install: false,
    silent: true,
    exitOnError: false
  }).then(
    () => true,
    (error) => String(error?.message ?? error)
  )
  const probeAfterBuild = process.env.EXTENSION_PUBLIC_HOST_PROBE ?? null

  endSessionAsFailed('E_PARENT_GONE', 'done')
  const released = await until(
    'the host listeners released',
    () => listeners().join() === before.join()
  )

  return {
    built,
    probeAfterBuild,
    released,
    probeAfterSession: process.env.EXTENSION_PUBLIC_HOST_PROBE ?? null
  }
}

// A wait that never comes true, for the deadline itself.
async function waitsForWhatNeverComes() {
  const first = await until('what never comes', () => false)
  const second = await until('a wait after the deadline', () => false)

  return {first, second}
}

const result =
  scenario === 'stuck'
    ? await waitsForWhatNeverComes()
    : scenario === 'build-beside-dev'
      ? await buildBesideALiveSession()
      : scenario === 'usage-refusal'
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

process.stdout.write(`${stuckLine()}\nRESULT ${JSON.stringify(result)}\n`)
process.exit(0)

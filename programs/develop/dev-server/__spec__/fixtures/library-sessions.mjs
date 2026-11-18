import fs from 'node:fs'
import path from 'node:path'
import {extensionDev} from '../../../dist/module.mjs'

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
  // Thrown while the bundle is wired, after the manifest guard is installed.
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

function start(dir) {
  let ready = false
  const session = extensionDev(dir, {
    browser: 'chromium',
    noBrowser: true,
    port: 0,
    install: false,
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
      framed: error?.framed
    })
  )

  return {session, isReady: () => ready}
}

// Left installed, the process-global guard swallows this write.
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
    sessions.push(await start(dir).session)
  }

  // A closing socket leaves the handle list a moment after its close.
  await until(() => listening().length === 0, 5000)

  return {
    before,
    after: listeners(),
    sessions,
    listening: listening(),
    instanceIdLeft: process.env.EXTENSION_INSTANCE_ID ?? null,
    manifestWriteGoesThrough: manifestWriteGoesThrough(dir)
  }
}

// Two sessions live at once. The newer one loses its server at a restart
// and is released, and the older one must go on restarting.
async function restartWhileAnotherSessionLives() {
  const before = listeners()
  const older = project('older', CONFIGS.start)
  const newer = project('newer', CONFIGS.start)
  const a = start(older)
  const b = start(newer)
  const started = [await a.session, await b.session]
  const bothReady = await until(() => a.isReady() && b.isReady())
  const live = listeners()
  const listeningLive = listening().length
  const withContentScript = manifest({
    content_scripts: [{matches: ['https://example.com/*'], js: ['cs.js']}]
  })

  fs.writeFileSync(path.join(newer, 'break-next-start'), 'x')
  fs.writeFileSync(path.join(newer, 'manifest.json'), withContentScript)

  const newerReleased = await until(
    () =>
      listeners().join() !== live.join() && listening().length < listeningLive
  )
  await wait(500)
  const afterNewerEnded = listeners()

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
    live,
    afterNewerEnded,
    started,
    bothReady,
    newerReleased,
    olderRestarted
  }
}

const result =
  scenario === 'restart'
    ? await restartWhileAnotherSessionLives()
    : await failingStarts()

process.stdout.write(`\nRESULT ${JSON.stringify(result)}\n`)
process.exit(0)

import fs from 'node:fs'
import path from 'node:path'
import {extensionDev} from '../../../dist/module.mjs'

// One host process runs two dev sessions with their own public hosts, and
// the older one rebuilds its compiler after the newer one has started.
const [root] = process.argv.slice(2)

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function until(read, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const value = read()

    if (value) return value

    await wait(50)
  }

  return null
}

const manifest = (extra = {}) =>
  JSON.stringify({
    manifest_version: 3,
    name: 'session-hosts',
    version: '0.0.0',
    background: {service_worker: 'bg.js'},
    ...extra
  })

function project(name) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({private: true, name, version: '0.0.0', type: 'module'})
  )

  fs.writeFileSync(path.join(dir, 'manifest.json'), manifest())
  fs.writeFileSync(path.join(dir, 'bg.js'), "console.log('bg')\n")
  fs.writeFileSync(path.join(dir, 'cs.js'), "console.log('cs')\n")

  return dir
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

const worker = (dir) =>
  read(path.join(dir, 'dist', 'chromium', 'background', 'service_worker.js'))

const bakedHost = (source) =>
  /var HOST = "([^"]*)"/.exec(String(source))?.[1] ?? null

function readyHost(dir) {
  const ready = read(
    path.join(dir, 'dist', 'extension-js', 'chromium', 'ready.json')
  )

  try {
    return JSON.parse(String(ready)).host ?? null
  } catch {
    return null
  }
}

function start(dir, publicHost) {
  let ready = false

  extensionDev(dir, {
    browser: 'chromium',
    noBrowser: true,
    host: '127.0.0.1',
    publicHost,
    port: 0,
    install: false,
    onReady: () => {
      ready = true
    }
  }).catch(() => {})

  return () => ready
}

const older = project('older')
const newer = project('newer')

const olderReady = start(older, 'session-a.test')
const olderStarted = Boolean(await until(olderReady))
const olderFirstWorker = await until(
  () => bakedHost(worker(older)) && worker(older)
)

const newerReady = start(newer, 'session-b.test')
const newerStarted = Boolean(await until(newerReady))
const newerWorker = await until(() => bakedHost(worker(newer)) && worker(newer))

// A new entry list makes the older session build a new compiler.
fs.writeFileSync(
  path.join(older, 'manifest.json'),
  manifest({
    content_scripts: [{matches: ['https://example.com/*'], js: ['cs.js']}]
  })
)

// Only a compiler built for the new entry list emits the content script.
const olderRestarted = Boolean(
  await until(() => {
    try {
      return fs
        .readdirSync(path.join(older, 'dist', 'chromium', 'content_scripts'))
        .some((name) => /^content-0\..*\.js$/.test(name))
    } catch {
      return false
    }
  })
)
const olderRebuiltWorker = worker(older)

process.stdout.write(
  `\nRESULT ${JSON.stringify({
    olderStarted,
    newerStarted,
    olderRestarted,
    olderFirst: bakedHost(olderFirstWorker),
    newer: bakedHost(newerWorker),
    olderRebuilt: bakedHost(olderRebuiltWorker),
    olderReadyHost: readyHost(older),
    newerReadyHost: readyHost(newer)
  })}\n`
)

process.exit(0)

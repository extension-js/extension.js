// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// Drive real Chrome via CDP Extensions.loadUnpacked for every fixture and
// record the exact acceptance/refusal per shape. One browser, sequential loads.
import {spawn} from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import {fileURLToPath} from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturesRoot = path.join(here, 'fixtures')
const index = JSON.parse(fs.readFileSync(path.join(fixturesRoot, 'index.json'), 'utf8'))

const CHROME = process.env.CHROME_BIN
if (!CHROME || !fs.existsSync(CHROME)) {
  console.error('CHROME_BIN missing')
  process.exit(1)
}

const profile = path.join(here, 'profile')
fs.rmSync(profile, {recursive: true, force: true})

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  'about:blank'
], {stdio: ['ignore', 'pipe', 'pipe']})

let wsUrl = null
const wsReady = new Promise((resolve, reject) => {
  const onData = (chunk) => {
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(String(chunk))
    if (m) {
      wsUrl = m[1]
      resolve(wsUrl)
    }
  }
  chrome.stderr.on('data', onData)
  chrome.stdout.on('data', onData)
  chrome.on('exit', (code) => reject(new Error(`chrome exited early: ${code}`)))
  setTimeout(() => reject(new Error('timeout waiting for DevTools endpoint')), 30000)
})

try {
  await wsReady
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })

  let nextId = 1
  const pending = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = nextId++
      pending.set(id, resolve)
      ws.send(JSON.stringify({id, method, params}))
    })

  const version = await send('Browser.getVersion')
  console.log(`# ${version.result?.product}`)

  const results = []
  for (const {id, expect} of index) {
    const dir = path.join(fixturesRoot, id)
    const reply = await send('Extensions.loadUnpacked', {path: dir})
    const outcome = reply.error ? 'REFUSED' : 'LOADED'
    const detail = reply.error ? reply.error.message : `id=${reply.result?.id}`
    const verdict =
      (expect === 'refuse') === (outcome === 'REFUSED') ? 'as-expected' : 'SURPRISE'
    results.push({id, expect, outcome, verdict, detail})
    console.log(`${id}\t${outcome}\t${verdict}\t${detail}`)
  }
  fs.writeFileSync(path.join(here, 'results-chrome.json'), JSON.stringify(results, null, 2))
} finally {
  chrome.kill('SIGKILL')
}

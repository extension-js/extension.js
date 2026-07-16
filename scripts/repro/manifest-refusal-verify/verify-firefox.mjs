// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

// Verify match-pattern refusals on real Firefox via RDP installTemporaryAddon,
// which returns the refusal reason in-protocol. Headless, throwaway profile.
import {spawn} from 'child_process'
import * as net from 'net'
import * as fs from 'fs'
import * as path from 'path'
import {fileURLToPath} from 'url'

const here = path.dirname(fileURLToPath(import.meta.url))
const FIREFOX = process.env.FIREFOX_BIN
const PORT = 6112

// ---- fixtures ----
const root = path.join(here, 'fixtures-ff')
fs.rmSync(root, {recursive: true, force: true})
const base = (name) => ({manifest_version: 2, name, version: '1.0'})
const fixtures = [
  // Chrome-legal explicit port in a match pattern (memux's exact shape)
  {id: 'ff-01-port-in-match', expect: 'refuse',
    manifest: {...base('ff01'), content_scripts: [{matches: ['http://localhost:3000/*'], js: ['c.js']}]},
    files: {'c.js': '// noop'}},
  // wildcard port
  {id: 'ff-02-wildcard-port', expect: 'refuse',
    manifest: {...base('ff02'), permissions: ['http://example.com:*/*']}},
  // mid-host wildcard (Chrome also refuses this one)
  {id: 'ff-03-mid-host-wildcard', expect: 'refuse',
    manifest: {...base('ff03'), content_scripts: [{matches: ['*://*carbonwise*/*'], js: ['c.js']}]},
    files: {'c.js': '// noop'}},
  // control: same extension with a legal pattern
  {id: 'ff-90-ctl-valid', expect: 'load',
    manifest: {...base('ff90'), content_scripts: [{matches: ['http://localhost/*', 'https://*.example.com/*'], js: ['c.js']}]},
    files: {'c.js': '// noop'}}
]
for (const f of fixtures) {
  const dir = path.join(root, f.id)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(f.manifest, null, 2))
  for (const [rel, content] of Object.entries(f.files || {})) {
    fs.writeFileSync(path.join(dir, rel), content)
  }
}

// ---- profile ----
const profile = path.join(here, 'profile-ff')
fs.rmSync(profile, {recursive: true, force: true})
fs.mkdirSync(profile, {recursive: true})
fs.writeFileSync(path.join(profile, 'user.js'), [
  'user_pref("devtools.debugger.remote-enabled", true);',
  'user_pref("devtools.debugger.prompt-connection", false);',
  'user_pref("devtools.chrome.enabled", true);',
  'user_pref("xpinstall.signatures.required", false);',
  'user_pref("extensions.experiments.enabled", true);',
  'user_pref("browser.shell.checkDefaultBrowser", false);',
  'user_pref("datareporting.policy.dataSubmissionEnabled", false);'
].join('\n'))

const firefox = spawn(FIREFOX, [
  '-headless',
  '-no-remote',
  '-profile', profile,
  '-start-debugger-server', String(PORT),
  'about:blank'
], {stdio: ['ignore', 'pipe', 'pipe']})
firefox.stderr.on('data', () => {})
firefox.stdout.on('data', () => {})

// ---- minimal RDP client (length:JSON packets over TCP) ----
function connectRDP(port, attempts = 40) {
  return new Promise((resolve, reject) => {
    const tryOnce = (left) => {
      const sock = net.connect(port, '127.0.0.1')
      sock.once('connect', () => resolve(sock))
      sock.once('error', () => {
        if (left <= 0) return reject(new Error('cannot connect to RDP'))
        setTimeout(() => tryOnce(left - 1), 500)
      })
    }
    tryOnce(attempts)
  })
}

try {
  const sock = await connectRDP(PORT)
  let buffer = Buffer.alloc(0)
  const waiters = []
  sock.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const sep = buffer.indexOf(0x3a) // ':'
      if (sep === -1) return
      const length = Number(buffer.slice(0, sep).toString())
      if (buffer.length < sep + 1 + length) return
      const packet = JSON.parse(buffer.slice(sep + 1, sep + 1 + length).toString())
      buffer = buffer.slice(sep + 1 + length)
      const w = waiters.shift()
      if (w) w(packet)
      else console.log('  (unsolicited)', JSON.stringify(packet).slice(0, 120))
    }
  })
  const nextPacket = () => new Promise((resolve) => waiters.push(resolve))
  const send = (msg) => {
    const body = JSON.stringify(msg)
    sock.write(`${Buffer.byteLength(body)}:${body}`)
  }
  // Await a reply addressed from `actor`, letting unsolicited packets pass.
  const request = async (msg, from) => {
    send(msg)
    for (let i = 0; i < 50; i++) {
      const packet = await nextPacket()
      if (packet.from === from && !('type' in packet && packet.type === 'tabListChanged')) {
        return packet
      }
    }
    throw new Error('no reply')
  }

  const greeting = await nextPacket() // root greeting
  console.log(`# firefox RDP: ${greeting.applicationType}`)
  const rootReply = await request({to: 'root', type: 'getRoot'}, 'root')
  const addons = rootReply.addonsActor
  if (!addons) throw new Error('no addonsActor')

  const results = []
  for (const {id, expect} of fixtures) {
    const reply = await request(
      {to: addons, type: 'installTemporaryAddon', addonPath: path.join(root, id), openDevTools: false},
      addons
    )
    const outcome = reply.error ? 'REFUSED' : 'LOADED'
    const detail = reply.error ? `${reply.error}: ${reply.message}` : `id=${reply.addon?.id}`
    const verdict =
      (expect === 'refuse') === (outcome === 'REFUSED') ? 'as-expected' : 'SURPRISE'
    results.push({id, expect, outcome, verdict, detail})
    console.log(`${id}\t${outcome}\t${verdict}\t${detail}`)
  }
  fs.writeFileSync(path.join(here, 'results-firefox.json'), JSON.stringify(results, null, 2))
} finally {
  firefox.kill('SIGKILL')
}

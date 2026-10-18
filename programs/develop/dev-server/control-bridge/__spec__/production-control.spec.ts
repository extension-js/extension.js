import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {buildBridgeProducerSource} from '../producer-runtime'
import {
  controlledBuildDir,
  type ProductionControlSession,
  startProductionControl
} from '../production-control'
import {readControlToken} from '../session-token'

let tmpDir: string | undefined
let session: ProductionControlSession | undefined

afterEach(async () => {
  await session?.close()
  session = undefined

  if (tmpDir) fs.rmSync(tmpDir, {recursive: true, force: true})

  tmpDir = undefined
})

const WORKER = 'console.log("production worker")\n'

function makeProject(): {projectDir: string; distPath: string} {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-production-control-'))
  const distPath = path.join(tmpDir, 'dist', 'chrome')
  fs.mkdirSync(path.join(distPath, 'background'), {recursive: true})
  fs.writeFileSync(
    path.join(distPath, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'x',
      version: '1.0.0',
      background: {service_worker: 'background/service_worker.js'}
    })
  )

  fs.writeFileSync(
    path.join(distPath, 'background', 'service_worker.js'),
    WORKER
  )

  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}')

  return {projectDir: tmpDir, distPath}
}

function canConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.once('error', () => resolve(false))
  })
}

describe('startProductionControl', () => {
  it('loads a copy of the production build that carries the producer and leaves dist/ untouched', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(session.controlledPath).toBe(
      controlledBuildDir(projectDir, 'chrome')
    )

    expect(path.resolve(session.controlledPath)).not.toBe(
      path.resolve(distPath)
    )

    const shipped = fs.readFileSync(
      path.join(distPath, 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(shipped).toBe(WORKER)
    expect(
      fs.existsSync(path.join(distPath, 'extension-js-control.json'))
    ).toBe(false)

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(controlled).toContain('__extjsBridgeProducerInstalled')
    expect(controlled).toContain(String(session.controlPort))
    expect(controlled).toContain(session.instanceId)
    expect(controlled.endsWith(WORKER)).toBe(true)

    const asset = JSON.parse(
      fs.readFileSync(
        path.join(session.controlledPath, 'extension-js-control.json'),
        'utf-8'
      )
    )
    expect(asset).toEqual({
      port: session.controlPort,
      instanceId: session.instanceId
    })

    expect(
      fs.existsSync(path.join(session.controlledPath, 'manifest.json'))
    ).toBe(true)
  })

  it('listens on the control port until closed', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(session.controlPort).toBeGreaterThan(0)
    expect(await canConnect(session.controlPort)).toBe(true)

    const port = session.controlPort
    await session.close()
    session = undefined
    expect(await canConnect(port)).toBe(false)
  })

  it('writes the eval token only with allowEval and clears it on close', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(readControlToken(projectDir, 'chrome')).toBeNull()
    await session.close()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowEval: true
    })

    expect(readControlToken(projectDir, 'chrome')).toEqual(expect.any(String))

    await session.close()
    session = undefined
    expect(readControlToken(projectDir, 'chrome')).toBeNull()
  })

  it('rebuilds the copy on every start so a stale producer never survives', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    const first = session.instanceId
    fs.writeFileSync(path.join(session.controlledPath, 'stale.txt'), 'x')
    await session.close()

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(session.instanceId).not.toBe(first)
    expect(fs.existsSync(path.join(session.controlledPath, 'stale.txt'))).toBe(
      false
    )

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(controlled).not.toContain(first)
    const perProducer = buildBridgeProducerSource({
      controlPort: session.controlPort,
      instanceId: session.instanceId
    }).split('__extjsBridgeProducerInstalled').length
    expect(controlled.split('__extjsBridgeProducerInstalled').length).toBe(
      perProducer
    )
  })
})

function makeFirefoxProject(manifest: Record<string, unknown>): {
  projectDir: string
  distPath: string
  shipped: string
} {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-production-control-'))
  const distPath = path.join(tmpDir, 'dist', 'firefox')
  fs.mkdirSync(path.join(distPath, 'background'), {recursive: true})
  const shipped = JSON.stringify({
    name: 'x',
    version: '1.0.0',
    browser_specific_settings: {gecko: {id: 'x@example.com'}},
    background: {scripts: ['background/scripts.js']},
    ...manifest
  })
  fs.writeFileSync(path.join(distPath, 'manifest.json'), shipped)
  fs.writeFileSync(path.join(distPath, 'background', 'scripts.js'), WORKER)
  fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}')

  return {projectDir: tmpDir, distPath, shipped}
}

function controlledManifest(controlledPath: string) {
  return JSON.parse(
    fs.readFileSync(path.join(controlledPath, 'manifest.json'), 'utf-8')
  )
}

// Firefox's default MV3 policy carries upgrade-insecure-requests, which turns
// the producer's ws:// dial into a TLS handshake the control port never
// answers. Dev writes its own policy; the controlled copy needs one too.
describe("the controlled copy's content security policy", () => {
  it('gives a Firefox MV3 copy with no policy one that leaves ws:// alone', async () => {
    const {projectDir, distPath, shipped} = makeFirefoxProject({
      manifest_version: 3
    })

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'firefox',
      distPath,
      allowControl: true
    })

    const pages = controlledManifest(session.controlledPath)
      .content_security_policy?.extension_pages
    expect(typeof pages).toBe('string')
    expect(pages).toContain("script-src 'self'")
    expect(pages).not.toContain('upgrade-insecure-requests')
    expect(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8')).toBe(
      shipped
    )
  })

  it("drops upgrade-insecure-requests from the author's policy and admits the control port", async () => {
    const {projectDir, distPath, shipped} = makeFirefoxProject({
      manifest_version: 3,
      content_security_policy: {
        extension_pages:
          "script-src 'self'; connect-src 'self' https://api.example.com; upgrade-insecure-requests;",
        sandbox: "sandbox allow-scripts; script-src 'self'"
      }
    })

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'firefox',
      distPath,
      allowControl: true
    })

    const policy = controlledManifest(
      session.controlledPath
    ).content_security_policy
    expect(policy.extension_pages).not.toContain('upgrade-insecure-requests')
    expect(policy.extension_pages).toContain("script-src 'self'")
    expect(policy.extension_pages).toContain('https://api.example.com')
    expect(policy.extension_pages).toContain(
      `ws://127.0.0.1:${session.controlPort}`
    )

    expect(policy.sandbox).toBe("sandbox allow-scripts; script-src 'self'")
    expect(fs.readFileSync(path.join(distPath, 'manifest.json'), 'utf-8')).toBe(
      shipped
    )
  })

  it('drops upgrade-insecure-requests from an MV2 string policy', async () => {
    const {projectDir, distPath} = makeFirefoxProject({
      manifest_version: 2,
      content_security_policy:
        "script-src 'self'; object-src 'self'; upgrade-insecure-requests"
    })

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'firefox',
      distPath,
      allowControl: true
    })

    const policy = controlledManifest(
      session.controlledPath
    ).content_security_policy
    expect(typeof policy).toBe('string')
    expect(policy).toContain("object-src 'self'")
    expect(policy).not.toContain('upgrade-insecure-requests')
  })

  it('wakes a suspended Firefox background once its producer has connected', async () => {
    const {projectDir, distPath} = makeFirefoxProject({manifest_version: 3})
    const wakeExecutor = vi.fn(async () => true)

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'firefox',
      distPath,
      allowControl: true,
      wakeExecutor
    })

    const conn = (id: string) => ({
      id,
      sent: [] as unknown[],
      send(frame: unknown) {
        this.sent.push(frame)

        return true
      },
      close() {}
    })
    const hello = (c: ReturnType<typeof conn>, role: string) =>
      session?.broker.onFrame(c, {
        type: 'hello',
        v: 1,
        role,
        instanceId: session.instanceId
      } as never)
    const page = conn('event-page')
    hello(page, 'producer')
    session.broker.onClose(page)
    const ctl = conn('ctl')
    hello(ctl, 'controller')
    ctl.sent = []

    session.broker.onFrame(ctl, {
      type: 'command',
      cmdId: 'c1',
      op: 'storage.get',
      target: {context: 'background'},
      args: {}
    } as never)

    await new Promise((resolve) => setImmediate(resolve))

    expect(wakeExecutor).toHaveBeenCalledTimes(1)

    const woken = conn('woken-page')
    hello(woken, 'producer')
    await new Promise((resolve) => setImmediate(resolve))

    expect(woken.sent).toContainEqual(
      expect.objectContaining({type: 'command', cmdId: 'c1'})
    )
  })
})

// Dev bundles a relay into every extension page and content script, which is
// how the background reaches a page's DOM. A production build has none, so
// the controlled copy carries it, and dist/ still ships without it.
describe("the controlled copy's page relays", () => {
  it('prepends the relay to each extension page and content script', async () => {
    const {projectDir, distPath} = makeFirefoxProject({
      manifest_version: 3,
      options_ui: {page: 'options/index.html'},
      action: {default_popup: 'action/index.html'},
      content_scripts: [
        {matches: ['<all_urls>'], js: ['content_scripts/content-0.js']}
      ]
    })
    const PAGE = 'document.body.dataset.ready = "1"\n'

    for (const rel of [
      'options/index.js',
      'action/index.js',
      'content_scripts/content-0.js'
    ]) {
      fs.mkdirSync(path.dirname(path.join(distPath, rel)), {recursive: true})
      fs.writeFileSync(path.join(distPath, rel), PAGE)
    }

    session = await startProductionControl({
      packageJsonDir: projectDir,
      browser: 'firefox',
      distPath,
      allowControl: true
    })

    for (const rel of [
      'options/index.js',
      'action/index.js',
      'content_scripts/content-0.js'
    ]) {
      const controlled = fs.readFileSync(
        path.join(session.controlledPath, rel),
        'utf-8'
      )
      expect(controlled, rel).toContain('__extjsBridgeRelayInstalled')
      expect(controlled.endsWith(PAGE), rel).toBe(true)
      expect(fs.readFileSync(path.join(distPath, rel), 'utf-8'), rel).toBe(PAGE)
    }

    const background = fs.readFileSync(
      path.join(session.controlledPath, 'background', 'scripts.js'),
      'utf-8'
    )
    expect(background).not.toContain('__extjsBridgeRelayInstalled')
  })
})

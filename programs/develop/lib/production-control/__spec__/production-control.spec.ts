import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {controlledBuildParts} from '../../../controlled-build-parts'
import {readControlToken} from '../../../dev-server/control-bridge/session-token'
import {buildDevProducerSource} from '../../../plugin-reload/reload-lib/producer-reload'
import {TAKE_BLOCK_OPEN} from '../../extension-base-from-stack'
import {
  controlledBuildDir,
  declaredBackgroundFiles,
  type ProductionControlSession,
  startProductionControl
} from '../index'

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
      parts: controlledBuildParts,
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
      parts: controlledBuildParts,
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
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(readControlToken(projectDir, 'chrome')).toBeNull()
    await session.close()

    session = await startProductionControl({
      parts: controlledBuildParts,
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

  it('keeps the token of a session that started before the last one closed', async () => {
    const {projectDir, distPath} = makeProject()
    const options = {
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowEval: true
    }

    const ended = await startProductionControl(options)
    const endedToken = readControlToken(projectDir, 'chrome')

    session = await startProductionControl(options)
    const restartedToken = readControlToken(projectDir, 'chrome')
    expect(restartedToken).toEqual(expect.any(String))
    expect(restartedToken).not.toBe(endedToken)

    await ended.close()
    expect(readControlToken(projectDir, 'chrome')).toBe(restartedToken)

    await session.close()
    session = undefined
    expect(readControlToken(projectDir, 'chrome')).toBeNull()
  })

  it('rebuilds the copy on every start so a stale producer never survives', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    const first = session.instanceId
    fs.writeFileSync(path.join(session.controlledPath, 'stale.txt'), 'x')
    await session.close()

    session = await startProductionControl({
      parts: controlledBuildParts,
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
    const perProducer = buildDevProducerSource({
      controlPort: session.controlPort,
      instanceId: session.instanceId
    }).split('__extjsBridgeProducerInstalled').length
    expect(controlled.split('__extjsBridgeProducerInstalled').length).toBe(
      perProducer
    )
  })

  // The reload verb restarts the extension through the dev reload executor,
  // so the controlled copy must carry it, not the bare bridge.
  it('ships the restart its reload verb calls', async () => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, 'background', 'service_worker.js'),
      'utf-8'
    )

    expect(controlled).toMatch(/\brestartExtension\(/)
    expect(controlled).toMatch(/function restartExtension\(/)
  })
})

// What an act verb is told when it reaches the session's broker.
function refusal(control: ProductionControlSession): string {
  const sent: unknown[] = []
  const controller = {
    id: 'ctl',
    send: (frame: unknown) => {
      sent.push(frame)

      return true
    },
    close: () => {}
  }

  control.broker.onFrame(controller, {
    type: 'hello',
    v: 1,
    role: 'controller',
    instanceId: control.instanceId
  })

  control.broker.onFrame(controller, {
    type: 'command',
    cmdId: 'c1',
    op: 'reload',
    target: {context: 'background'}
  })

  const result = sent[sent.length - 1] as {error: {message: string}}

  return result.error.message
}

describe('the answers of a start or preview session', () => {
  it.each([
    'start',
    'preview'
  ] as const)('names extension %s, never a dev session', async (command) => {
    const {projectDir, distPath} = makeProject()

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      command,
      distPath,
      allowControl: true
    })

    const message = refusal(session)

    expect(message).toContain(`since this extension ${command} session started`)

    expect(message).not.toMatch(/dev session|extension dev/)
  })

  it('tells a build with no background that nothing in it can connect', async () => {
    const {projectDir, distPath} = makeProject()

    fs.rmSync(path.join(distPath, 'background'), {recursive: true})

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      command: 'start',
      distPath,
      allowControl: true
    })

    expect(session.backgroundAssets).toEqual([])

    const message = refusal(session)

    expect(message).toContain('has no background')
    expect(message).toContain('restart extension start')
    expect(message).not.toContain('may still be launching')
  })
})

// Only the background at the root of the build is the one the browser runs.
describe('a built file in a nested folder named background', () => {
  it('is copied as built while the real background carries the producer', async () => {
    const {projectDir, distPath} = makeProject()
    const vendored = 'export const vendored = true\n'
    const nested = path.join('vendor', 'background', 'index.js')

    fs.mkdirSync(path.dirname(path.join(distPath, nested)), {recursive: true})
    fs.writeFileSync(path.join(distPath, nested), vendored)

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      distPath,
      allowControl: true
    })

    expect(
      fs.readFileSync(path.join(session.controlledPath, nested), 'utf-8')
    ).toBe(vendored)

    expect(session.backgroundAssets).toEqual(['background/service_worker.js'])
    expect(
      fs.readFileSync(
        path.join(session.controlledPath, 'background', 'service_worker.js'),
        'utf-8'
      )
    ).toContain('__extjsBridgeProducerInstalled')
  })
})

// A build made by another tool keeps its own file names, so the producer
// follows what the manifest declares and not only the paths this build emits.
describe('a build whose background sits where its manifest says', () => {
  function makeForeignBuild(manifest: Record<string, unknown>): {
    projectDir: string
    distPath: string
  } {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-foreign-build-'))
    const distPath = path.join(tmpDir, 'dist', 'chrome')
    fs.mkdirSync(distPath, {recursive: true})
    fs.writeFileSync(
      path.join(distPath, 'manifest.json'),
      JSON.stringify({name: 'x', version: '1.0.0', ...manifest})
    )

    fs.writeFileSync(path.join(distPath, 'background.js'), WORKER)
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"x"}')

    return {projectDir: tmpDir, distPath}
  }

  const controlled = (control: ProductionControlSession) =>
    fs.readFileSync(path.join(control.controlledPath, 'background.js'), 'utf-8')

  it.each([
    3, 4
  ])('prepends the producer to the service worker of a manifest_version %i build', async (version) => {
    const {projectDir, distPath} = makeForeignBuild({
      manifest_version: version,
      background: {service_worker: './background.js'}
    })

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      command: 'preview',
      distPath,
      allowControl: true
    })

    expect(session.backgroundAssets).toEqual(['background.js'])
    expect(controlled(session)).toContain('__extjsBridgeProducerInstalled')
    expect(controlled(session).endsWith(WORKER)).toBe(true)
    expect(fs.readFileSync(path.join(distPath, 'background.js'), 'utf-8')).toBe(
      WORKER
    )
  })

  // Measured on Chrome 151: the extension loads and these scripts never run.
  it('counts background.scripts with no service worker as no background on Chromium', async () => {
    const {projectDir, distPath} = makeForeignBuild({
      manifest_version: 3,
      background: {scripts: ['background.js']}
    })

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'chrome',
      command: 'preview',
      distPath,
      allowControl: true
    })

    expect(session.backgroundAssets).toEqual([])
    expect(controlled(session)).toBe(WORKER)

    const message = refusal(session)

    expect(message).toContain('has no background this browser runs')
    expect(message).toContain('background.service_worker')
    expect(message).not.toContain('may still be launching')
  })

  it('carries the producer on the first background script for Firefox', async () => {
    const {projectDir, distPath} = makeForeignBuild({
      manifest_version: 3,
      background: {scripts: ['background.js', 'second.js']}
    })

    fs.writeFileSync(path.join(distPath, 'second.js'), WORKER)

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'firefox',
      command: 'preview',
      distPath,
      allowControl: true
    })

    expect(session.backgroundAssets).toEqual(['background.js'])
    expect(controlled(session)).toContain('__extjsBridgeProducerInstalled')
    expect(
      fs.readFileSync(path.join(session.controlledPath, 'second.js'), 'utf-8')
    ).toBe(WORKER)
  })

  it('reads each shape the way the browser runs it', () => {
    const scriptsOnly = {
      manifest_version: 3,
      background: {scripts: ['/bg/a.js', 'bg/b.js']}
    }

    expect(declaredBackgroundFiles(scriptsOnly, 'chrome')).toEqual({
      files: [],
      runsNone: true
    })

    expect(declaredBackgroundFiles(scriptsOnly, 'firefox')).toEqual({
      files: ['bg/a.js'],
      runsNone: false
    })

    expect(
      declaredBackgroundFiles(
        {
          manifest_version: 3,
          background: {service_worker: 'sw.js', scripts: ['bg.js']}
        },
        'edge'
      )
    ).toEqual({files: ['sw.js'], runsNone: false})

    expect(
      declaredBackgroundFiles(
        {manifest_version: 2, background: {scripts: ['bg.js']}},
        'edge'
      )
    ).toEqual({files: ['bg.js'], runsNone: false})

    expect(declaredBackgroundFiles({manifest_version: 3}, 'chrome')).toEqual({
      files: [],
      runsNone: false
    })
  })
})

// An --output-path folder holding only a manifest and built files, with no
// package.json above it, resolves to its own project root. The copy must
// still land outside the folder it copies, or cpSync refuses to copy a
// directory into itself.
describe('a build folder that is its own project root', () => {
  function makeBareBuild(): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-bare-build-'))
    fs.mkdirSync(path.join(tmpDir, 'background'), {recursive: true})
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        background: {service_worker: 'background/service_worker.js'}
      })
    )

    fs.writeFileSync(
      path.join(tmpDir, 'background', 'service_worker.js'),
      WORKER
    )

    return tmpDir
  }

  function isInside(parent: string, child: string): boolean {
    const rel = path.relative(path.resolve(parent), path.resolve(child))

    return rel === '' || (!path.isAbsolute(rel) && !rel.startsWith('..'))
  }

  it('keeps the in-project location while it sits outside the build folder', () => {
    const {projectDir, distPath} = makeProject()

    expect(controlledBuildDir(projectDir, 'chrome', distPath)).toBe(
      controlledBuildDir(projectDir, 'chrome')
    )
  })

  it('moves the copy out of a build folder that would contain it', () => {
    const root = makeBareBuild()
    const chosen = controlledBuildDir(root, 'chrome', root)

    expect(isInside(root, chosen)).toBe(false)
    expect(chosen.split(path.sep).slice(-2)).toEqual(['chrome', 'controlled'])
    expect(controlledBuildDir(root, 'chrome', root)).toBe(chosen)
    expect(controlledBuildDir(root, 'firefox', root)).not.toBe(chosen)

    // --output-path pointed at dist/ itself still contains dist/extension-js.
    const fromDist = controlledBuildDir(root, 'chrome', path.join(root, 'dist'))
    expect(isInside(root, fromDist)).toBe(false)
    expect(fromDist).not.toBe(chosen)
  })

  it('prepares the controlled copy outside the build folder and leaves it untouched', async () => {
    const root = makeBareBuild()

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: root,
      browser: 'chrome',
      distPath: root,
      allowControl: true
    })

    expect(isInside(root, session.controlledPath)).toBe(false)
    expect(session.backgroundAssets).toEqual(['background/service_worker.js'])

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, 'background', 'service_worker.js'),
      'utf-8'
    )
    expect(controlled).toContain('__extjsBridgeProducerInstalled')
    expect(controlled.endsWith(WORKER)).toBe(true)
    expect(
      fs.existsSync(
        path.join(session.controlledPath, 'extension-js-control.json')
      )
    ).toBe(true)

    expect(
      fs.readFileSync(
        path.join(root, 'background', 'service_worker.js'),
        'utf-8'
      )
    ).toBe(WORKER)

    expect(fs.existsSync(path.join(root, 'extension-js-control.json'))).toBe(
      false
    )

    fs.rmSync(path.dirname(path.dirname(session.controlledPath)), {
      recursive: true,
      force: true
    })
  })

  // A folder written by hand: a manifest and the background it names, with
  // no package.json and no canonical background path.
  it.each([
    {browser: 'chrome', background: {service_worker: 'sw.js'}, file: 'sw.js'},
    {browser: 'firefox', background: {scripts: ['bg.js']}, file: 'bg.js'}
  ])('carries the producer on $file of a hand-written $browser folder', async ({
    browser,
    background,
    file
  }) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-raw-folder-'))
    const root = tmpDir

    fs.writeFileSync(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        background
      })
    )

    fs.writeFileSync(path.join(root, file), WORKER)

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: root,
      browser,
      command: 'preview',
      distPath: root,
      allowControl: true,
      allowEval: true
    })

    expect(session.backgroundAssets).toEqual([file])

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, file),
      'utf-8'
    )

    expect(controlled).toContain('__extjsBridgeProducerInstalled')
    expect(controlled.endsWith(WORKER)).toBe(true)
    expect(refusal(session)).not.toContain('has no background')
    expect(fs.readFileSync(path.join(root, file), 'utf-8')).toBe(WORKER)

    fs.rmSync(path.dirname(path.dirname(session.controlledPath)), {
      recursive: true,
      force: true
    })
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
      parts: controlledBuildParts,
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
      parts: controlledBuildParts,
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

  it("drops 'none' from the connect-src that admits the control port", async () => {
    const {projectDir, distPath} = makeFirefoxProject({
      manifest_version: 3,
      content_security_policy: {
        extension_pages: "default-src 'none'; script-src 'self'"
      }
    })

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'firefox',
      distPath,
      allowControl: true
    })

    const pages = controlledManifest(session.controlledPath)
      .content_security_policy.extension_pages
    expect(pages).toContain(
      `connect-src ws://127.0.0.1:${session.controlPort};`
    )

    expect(pages).toContain("default-src 'none';")
  })

  it('drops upgrade-insecure-requests from an MV2 string policy', async () => {
    const {projectDir, distPath} = makeFirefoxProject({
      manifest_version: 2,
      content_security_policy:
        "script-src 'self'; object-src 'self'; upgrade-insecure-requests"
    })

    session = await startProductionControl({
      parts: controlledBuildParts,
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
      parts: controlledBuildParts,
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
      parts: controlledBuildParts,
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

  it('puts the relay behind the read a MAIN world file opens on', async () => {
    const {projectDir, distPath} = makeFirefoxProject({
      manifest_version: 3,
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content_scripts/content-0.js'],
          world: 'MAIN'
        }
      ]
    })
    const BODY = 'window.ran = __extjsTakenBase\n}'
    const rel = 'content_scripts/content-0.js'

    fs.mkdirSync(path.dirname(path.join(distPath, rel)), {recursive: true})
    fs.writeFileSync(path.join(distPath, rel), `${TAKE_BLOCK_OPEN}${BODY}`)

    session = await startProductionControl({
      parts: controlledBuildParts,
      packageJsonDir: projectDir,
      browser: 'firefox',
      distPath,
      allowControl: true
    })

    const controlled = fs.readFileSync(
      path.join(session.controlledPath, rel),
      'utf-8'
    )

    expect(controlled.startsWith(TAKE_BLOCK_OPEN)).toBe(true)
    expect(controlled.split(TAKE_BLOCK_OPEN)).toHaveLength(2)
    expect(controlled).toContain('__extjsBridgeRelayInstalled')
    expect(controlled.endsWith(BODY)).toBe(true)
    expect(() => new Function(controlled)).not.toThrow()
  })
})

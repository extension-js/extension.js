// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {createHash, randomUUID} from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import parse from 'content-security-policy-parser'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../../lib/constants'
import {prependBehindTakeBlock} from '../../lib/extension-base-from-stack'
import {isSameOrInsidePath} from '../../lib/real-path'
import {
  actionsPath,
  browserArtifactsDir,
  logsPath
} from '../../lib/session-paths'
import {ActionsFileWriter} from '../control-bridge/actions-file'
import {BridgeBroker} from '../control-bridge/broker'
import {readExtensionLoadRefusal} from '../control-bridge/consumer-client'
import type {LogContext} from '../control-bridge/contracts'
import {LogsFileWriter} from '../control-bridge/logs-file'
import {
  buildBridgeRelaySource,
  CONTROL_PORT_ASSET_NAME
} from '../control-bridge/producer-runtime'
import {LogRingBuffer} from '../control-bridge/ring-buffer'
import {
  clearControlToken,
  writeControlToken
} from '../control-bridge/session-token'
import {
  type ControlServer,
  startControlServer
} from '../control-bridge/ws-control-server'

// What a controlled build borrows from a dev session: the producer a dev
// background runs, the files it and its relay ride and the policy merge.
// The command hands them over, so this folder reaches into no plugin.
export interface ControlledBuildParts {
  // The controlled run names its bridge the way a dev session does.
  producerSource: (options: {
    session: {
      controlPort: number
      instanceId: string
      connectableHost: string
    }
    context: 'background'
  }) => string
  relayTargets: ReadonlyArray<{re: RegExp; context: LogContext}>
  // The emitted files a build of ours runs as its background.
  backgroundAsset: RegExp
  addPolicySources: (current: string[], added: string[]) => string[]
}

export interface ProductionControlOptions {
  parts: ControlledBuildParts
  packageJsonDir: string
  browser: string
  // The production build the run would load: copied, never written to.
  distPath: string
  // Which command owns the session, so the broker's answers name it.
  command?: 'start' | 'preview'
  allowControl?: boolean
  allowEval?: boolean
  host?: string
  runId?: string
  onExecutorAttached?: () => void
  onExecutorDetached?: () => void
  // Starts a suspended background again. Bound late, the browser launches
  // after the broker exists.
  wakeExecutor?: () => Promise<boolean>
}

export interface ProductionControlSession {
  controlPort: number
  instanceId: string
  // The directory the browser loads: dist/ with the producer prepended.
  controlledPath: string
  // Project-relative, as the ready contract publishes it.
  logsPath: string
  backgroundAssets: string[]
  broker: BridgeBroker
  close(): Promise<void>
}

function isSameOrInside(parent: string, child: string): boolean {
  return isSameOrInsidePath(parent, child)
}

// Outside dist/ on purpose: dist/<browser> is what gets zipped and shipped,
// so the control producer must never land in it. An --output-path folder
// that is its own project root (a bare manifest, no package.json above) puts
// every per-project root inside the folder being copied, and copying a
// directory into itself fails, so the copy moves to the OS temp directory.
export function controlledBuildDir(
  packageJsonDir: string,
  browser: string,
  distPath?: string
): string {
  const inProject = path.join(
    browserArtifactsDir(packageJsonDir, browser),
    'controlled'
  )

  if (
    !distPath ||
    (!isSameOrInside(distPath, inProject) &&
      !isSameOrInside(inProject, distPath))
  ) {
    return inProject
  }

  const key = createHash('sha1')
    .update(path.resolve(distPath))
    .digest('hex')
    .slice(0, 12)

  return path.join(os.tmpdir(), 'extension-js', key, browser, 'controlled')
}

function listFiles(root: string, dir = ''): string[] {
  const out: string[] = []

  for (const entry of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true
  })) {
    const rel = dir ? `${dir}/${entry.name}` : entry.name

    if (entry.isDirectory()) out.push(...listFiles(root, rel))
    else out.push(rel)
  }

  return out
}

function buildPolicy(csp: Map<string, string[]>): string {
  const directives = [...csp.entries()].map(([directive, values]) =>
    values.length ? `${directive} ${values.join(' ')}` : directive
  )

  return `${directives.join('; ')}; `
}

// The producer dials ws:// on loopback. Firefox's default MV3 policy carries
// upgrade-insecure-requests, which turns that dial into a TLS handshake the
// control port never answers, and an author's connect-src can refuse it.
// Dev writes its own policy for the same reason; this is the copy's.
function controlledPagesPolicy(
  policy: string | undefined,
  controlSource: string,
  addPolicySources: ControlledBuildParts['addPolicySources']
): string {
  const csp = parse(policy || "script-src 'self'; object-src 'self'")

  csp.delete('upgrade-insecure-requests')

  const connectSrc = csp.get('connect-src') || csp.get('default-src')

  if (connectSrc) {
    csp.set('connect-src', addPolicySources(connectSrc, [controlSource]))
  }

  return buildPolicy(csp)
}

function patchControlledManifest(
  manifest: Record<string, unknown>,
  controlSource: string,
  addPolicySources: ControlledBuildParts['addPolicySources']
): Record<string, unknown> {
  const policy = manifest.content_security_policy

  if (Number(manifest.manifest_version) !== 3) {
    if (typeof policy !== 'string') return manifest

    return {
      ...manifest,
      content_security_policy: controlledPagesPolicy(
        policy,
        controlSource,
        addPolicySources
      )
    }
  }

  const slots =
    policy && typeof policy === 'object' && !Array.isArray(policy)
      ? (policy as Record<string, unknown>)
      : {}
  const pages =
    typeof policy === 'string'
      ? policy
      : typeof slots.extension_pages === 'string'
        ? slots.extension_pages
        : undefined

  return {
    ...manifest,
    content_security_policy: {
      ...slots,
      extension_pages: controlledPagesPolicy(
        pages,
        controlSource,
        addPolicySources
      )
    }
  }
}

function manifestFilePath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined

  return path.posix
    .normalize(value.trim().replace(/\\/g, '/'))
    .replace(/^(\.?\/)+/, '')
}

// The background the browser runs, read off the manifest. A build made by
// another tool names its own files, which the canonical paths never match.
export function declaredBackgroundFiles(
  manifest: Record<string, unknown>,
  browser?: string
): {files: string[]; runsNone: boolean} {
  const background = (manifest.background || {}) as {
    service_worker?: unknown
    scripts?: unknown
  }
  const worker = manifestFilePath(background.service_worker)
  const scripts = Array.isArray(background.scripts) ? background.scripts : []
  // Scripts share one page, so the first one carries the producer for all.
  const firstScript = manifestFilePath(scripts[0])
  const version = manifest.manifest_version
  const workerOnly =
    !isGeckoBasedBrowser(String(browser || '')) &&
    typeof version === 'number' &&
    version >= 3

  if (!workerOnly) {
    return {files: firstScript ? [firstScript] : [], runsNone: false}
  }

  // Measured on Chrome 151: from Manifest V3 on it runs a service worker
  // only, and background.scripts load with the extension and never start.
  return {
    files: worker ? [worker] : [],
    runsNone: !worker && Boolean(firstScript)
  }
}

function prepareControlledBuild(input: {
  parts: ControlledBuildParts
  distPath: string
  controlledPath: string
  controlPort: number
  instanceId: string
  host?: string
  browser?: string
}): string[] {
  fs.rmSync(input.controlledPath, {recursive: true, force: true})
  fs.mkdirSync(path.dirname(input.controlledPath), {recursive: true})
  fs.cpSync(input.distPath, input.controlledPath, {recursive: true})

  const source = input.parts.producerSource({
    session: {
      controlPort: input.controlPort,
      instanceId: input.instanceId,
      connectableHost: input.host ?? ''
    },
    context: 'background'
  })

  const manifestPath = path.join(input.controlledPath, 'manifest.json')
  let declared: ReturnType<typeof declaredBackgroundFiles> = {
    files: [],
    runsNone: false
  }

  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const controlSource = `ws://${input.host || '127.0.0.1'}:${input.controlPort}`

    declared = declaredBackgroundFiles(manifest, input.browser)

    fs.writeFileSync(
      manifestPath,
      JSON.stringify(
        patchControlledManifest(
          manifest,
          controlSource,
          input.parts.addPolicySources
        ),
        null,
        2
      )
    )
  }

  fs.writeFileSync(
    path.join(input.controlledPath, CONTROL_PORT_ASSET_NAME),
    JSON.stringify({port: input.controlPort, instanceId: input.instanceId})
  )

  const injected: string[] = []

  for (const rel of listFiles(input.controlledPath)) {
    // The same relay dev bundles into each page and content script: the only
    // route from the background to a production page's DOM and console.
    const relay = input.parts.relayTargets.find((target) => target.re.test(rel))

    if (relay) {
      const file = path.join(input.controlledPath, rel)
      const original = fs.readFileSync(file, 'utf-8')

      if (!original.includes('__extjsBridgeRelayInstalled')) {
        fs.writeFileSync(
          file,
          prependBehindTakeBlock(
            original,
            `${buildBridgeRelaySource({context: relay.context})}\n`
          )
        )
      }

      continue
    }

    // A background the browser never starts would carry a producer nobody
    // runs, and the session would wait for a connection that cannot come.
    if (declared.runsNone) continue

    if (
      !input.parts.backgroundAsset.test(rel) &&
      !declared.files.includes(rel)
    ) {
      continue
    }

    const file = path.join(input.controlledPath, rel)
    const original = fs.readFileSync(file, 'utf-8')

    if (original.includes('__extjsBridgeProducerInstalled')) continue

    fs.writeFileSync(file, `${source}\n${original}`)
    injected.push(rel)
  }

  return injected
}

export async function startProductionControl(
  options: ProductionControlOptions
): Promise<ProductionControlSession> {
  const {packageJsonDir, browser} = options
  const allowEval = Boolean(options.allowEval)
  const allowControl = Boolean(options.allowControl) || allowEval
  const instanceId = randomUUID()
  const runId = options.runId || instanceId
  const logsFilePath = logsPath(packageJsonDir, browser)
  const logFile = new LogsFileWriter({filePath: logsFilePath, runId})
  const actions = allowControl
    ? new ActionsFileWriter({
        filePath: actionsPath(packageJsonDir, browser),
        owner: {runId, logsFilePath}
      })
    : undefined
  const controlToken = allowEval
    ? writeControlToken(packageJsonDir, browser)
    : undefined
  let server: ControlServer | undefined
  let closed = false

  const release = () => {
    try {
      logFile.close()
    } catch {
      // Ignore
    }

    try {
      actions?.close()
    } catch {
      // Ignore
    }

    if (controlToken) clearControlToken(packageJsonDir, browser, controlToken)
  }

  process.once('exit', release)

  try {
    const broker = new BridgeBroker({
      instanceId,
      runId,
      engine: isGeckoBasedBrowser(browser)
        ? 'firefox'
        : isWebkitBasedBrowser(browser)
          ? 'webkit'
          : 'chromium',
      viewerOrigin: null,
      ring: new LogRingBuffer(),
      file: logFile,
      allowControl,
      allowEval,
      controlToken,
      actions,
      sessionCommand: options.command ?? 'preview',
      onExecutorAttached: options.onExecutorAttached,
      onExecutorDetached: options.onExecutorDetached,
      readLoadRefusal: () =>
        readExtensionLoadRefusal(packageJsonDir, browser, options.runId),
      // Only Gecko suspends the background with no way back short of an event.
      ...(isGeckoBasedBrowser(browser) && options.wakeExecutor
        ? {wakeExecutor: options.wakeExecutor}
        : {})
    })

    logFile.start()
    actions?.start()

    const opened = await startControlServer({
      broker,
      host: options.host || '127.0.0.1'
    })

    server = opened

    const controlledPath = controlledBuildDir(
      packageJsonDir,
      browser,
      options.distPath
    )
    const backgroundAssets = prepareControlledBuild({
      parts: options.parts,
      distPath: options.distPath,
      controlledPath,
      controlPort: opened.port,
      instanceId,
      host: options.host,
      browser
    })

    if (backgroundAssets.length === 0) broker.noteNoBackground()

    return {
      controlPort: opened.port,
      instanceId,
      controlledPath,
      logsPath: path.relative(
        packageJsonDir,
        logsPath(packageJsonDir, browser)
      ),
      backgroundAssets,
      broker,
      async close() {
        if (closed) return

        closed = true
        process.removeListener('exit', release)
        release()
        await opened.close()
      }
    }
  } catch (error) {
    // The caller never gets a session to close, so a failed start gives back
    // the token, the writers and the port itself, then fails as it would have.
    process.removeListener('exit', release)
    release()
    await server?.close().catch(() => {})

    throw error
  }
}

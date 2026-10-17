// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {randomUUID} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {isGeckoBasedBrowser, isWebkitBasedBrowser} from '../../lib/constants'
import {
  actionsPath,
  browserArtifactsDir,
  logsPath
} from '../../lib/session-paths'
import {ActionsFileWriter} from './actions-file'
import {BridgeBroker} from './broker'
import {LogsFileWriter} from './logs-file'
import {
  buildBridgeProducerSource,
  CONTROL_PORT_ASSET_NAME
} from './producer-runtime'
import {LogRingBuffer} from './ring-buffer'
import {clearControlToken, writeControlToken} from './session-token'
import {startControlServer} from './ws-control-server'

// Same background entries the dev-build injector prepends to: Chromium emits
// background/service_worker.js, Firefox background/scripts.js, and a declared
// background page compiles to background/index.js.
const BACKGROUND_ASSET =
  /(^|\/)background\/(?:service_worker|scripts?|index)\.js$/i

export interface ProductionControlOptions {
  packageJsonDir: string
  browser: string
  // The production build the run would load: copied, never written to.
  distPath: string
  allowControl?: boolean
  allowEval?: boolean
  host?: string
  runId?: string
  onExecutorAttached?: () => void
  onExecutorDetached?: () => void
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

// Outside dist/ on purpose: dist/<browser> is what gets zipped and shipped,
// so the control producer must never land in it.
export function controlledBuildDir(
  packageJsonDir: string,
  browser: string
): string {
  return path.join(browserArtifactsDir(packageJsonDir, browser), 'controlled')
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

export function prepareControlledBuild(input: {
  distPath: string
  controlledPath: string
  controlPort: number
  instanceId: string
  host?: string
}): string[] {
  fs.rmSync(input.controlledPath, {recursive: true, force: true})
  fs.mkdirSync(path.dirname(input.controlledPath), {recursive: true})
  fs.cpSync(input.distPath, input.controlledPath, {recursive: true})

  const source = buildBridgeProducerSource({
    controlPort: input.controlPort,
    instanceId: input.instanceId,
    context: 'background',
    host: input.host
  })

  fs.writeFileSync(
    path.join(input.controlledPath, CONTROL_PORT_ASSET_NAME),
    JSON.stringify({port: input.controlPort, instanceId: input.instanceId})
  )

  const injected: string[] = []

  for (const rel of listFiles(input.controlledPath)) {
    if (!BACKGROUND_ASSET.test(rel)) continue

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
  const logFile = new LogsFileWriter({
    filePath: logsPath(packageJsonDir, browser),
    runId
  })
  const actions = allowControl
    ? new ActionsFileWriter({filePath: actionsPath(packageJsonDir, browser)})
    : undefined
  const controlToken = allowEval
    ? writeControlToken(packageJsonDir, browser)
    : undefined
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
    onExecutorAttached: options.onExecutorAttached,
    onExecutorDetached: options.onExecutorDetached
  })

  logFile.start()
  actions?.start()

  const server = await startControlServer({
    broker,
    host: options.host || '127.0.0.1'
  })
  const controlledPath = controlledBuildDir(packageJsonDir, browser)
  const backgroundAssets = prepareControlledBuild({
    distPath: options.distPath,
    controlledPath,
    controlPort: server.port,
    instanceId,
    host: options.host
  })

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

    if (controlToken) clearControlToken(packageJsonDir, browser)
  }

  process.once('exit', release)

  return {
    controlPort: server.port,
    instanceId,
    controlledPath,
    logsPath: path.relative(packageJsonDir, logsPath(packageJsonDir, browser)),
    backgroundAssets,
    broker,
    async close() {
      if (closed) return

      closed = true
      process.removeListener('exit', release)
      release()
      await server.close()
    }
  }
}

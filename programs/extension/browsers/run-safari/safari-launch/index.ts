// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {spawn} from 'child_process'
import type {BrowserLogger, CompilationLike} from '../../browsers-types'
import * as messages from '../../browsers-lib/messages'
import type {SafariPluginLike} from '../safari-types'
import {detectSafariToolchain} from './toolchain'
import {logSafariDryRun} from './dry-run'
import {
  builtAppPath,
  composeConverterArgs,
  composeXcodebuildArgs,
  macOsSchemeName,
  resolveSafariBuildConfig,
  xcodeProjectPath
} from './safari-config'

function fallbackLogger(): BrowserLogger {
  return {
    info: (...a: unknown[]) => console.log(...a),
    warn: (...a: unknown[]) => console.warn(...a),
    error: (...a: unknown[]) => console.error(...a),
    debug: (...a: unknown[]) => (console as any)?.debug?.(...a)
  } as BrowserLogger
}

function isTestEnv(): boolean {
  return Boolean(process.env.VITEST || process.env.VITEST_WORKER_ID)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function runTool(bin: string, args: string[]): Promise<boolean> {
  const inheritOutput = process.env.EXTENSION_AUTHOR_MODE === 'true'

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      stdio: inheritOutput ? 'inherit' : 'ignore'
    })

    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

function runToolCapture(
  bin: string,
  args: string[]
): Promise<{ok: boolean; stdout: string}> {
  return new Promise((resolve) => {
    let stdout = ''
    const child = spawn(bin, args, {stdio: ['ignore', 'pipe', 'pipe']})

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.on('error', () => resolve({ok: false, stdout}))
    child.on('close', (code) => resolve({ok: code === 0, stdout}))
  })
}

async function confirmRegisteredWithSafari(
  bundleIdentifier: string
): Promise<boolean> {
  const needle = `${bundleIdentifier}.Extension`

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const {ok, stdout} = await runToolCapture('pluginkit', ['-m'])

    if (ok && stdout.includes(needle)) return true

    // Spread attempts over ~5s without blocking the event loop.
    await delay(800)
  }
  return false
}

export type SafariPipelineMode = 'full' | 'resync'

export function safariPreflightError(): string | null {
  const tc = detectSafariToolchain()
  if (!tc.platformOk) return messages.safariRequiresMacOS(process.platform)

  if (!tc.ok) {
    if (tc.needsFullXcode) return messages.safariXcodeRequired(tc.developerDir)

    return messages.safariToolchainMissing(
      !tc.converter ? 'safari-web-extension-converter' : 'xcodebuild'
    )
  }

  return null
}

async function runSafariPipeline(
  compilation: CompilationLike,
  host: SafariPluginLike,
  logger: BrowserLogger,
  mode: SafariPipelineMode
): Promise<void> {
  const config = resolveSafariBuildConfig(compilation, host)
  const converterArgs = composeConverterArgs(config)
  const xcodebuildArgs = composeXcodebuildArgs(config)

  if (host.dryRun || isTestEnv()) {
    logSafariDryRun(
      `xcrun ${converterArgs.join(' ')}`,
      `xcodebuild ${xcodebuildArgs.join(' ')}`
    )

    return
  }

  const toolchain = detectSafariToolchain()
  if (!toolchain.platformOk) {
    logger.warn?.(messages.safariRequiresMacOS(process.platform))
    return
  }

  if (!toolchain.ok) {
    if (toolchain.needsFullXcode) {
      // macOS present, but only the Command Line Tools (or nothing) are active
      logger.error?.(messages.safariXcodeRequired(toolchain.developerDir))
    } else {
      // Xcode is active but a tool is unexpectedly missing (broken install)
      const missing = !toolchain.converter
        ? 'safari-web-extension-converter'
        : 'xcodebuild'
      logger.error?.(messages.safariToolchainMissing(missing))
    }

    return
  }

  const projectExists = fs.existsSync(xcodeProjectPath(config))

  if (!projectExists || host.forceRegenerate) {
    logger.info?.(messages.safariConverting(config.extensionDir))

    if (!(await runTool('xcrun', converterArgs))) {
      logger.error?.(
        messages.safariFailed(
          new Error('safari-web-extension-converter failed')
        )
      )

      return
    }

    logger.info?.(messages.safariConverted(config.projectLocation))
  }

  if (mode === 'full')
    logger.info?.(messages.safariBuilding(macOsSchemeName(config)))

  if (!(await runTool('xcodebuild', xcodebuildArgs))) {
    logger.error?.(messages.safariFailed(new Error('xcodebuild failed')))
    return
  }

  const appPath = builtAppPath(config)

  // Resync mode (dev rebuilds): just report and stop — no reopen/re-guide.
  if (mode === 'resync') {
    logger.info?.(messages.safariRebuilt(config.appName))
    return
  }

  logger.info?.(messages.safariBuilt(appPath))

  if (config.open) {
    const target = fs.existsSync(appPath) ? appPath : xcodeProjectPath(config)

    logger.info?.(messages.safariOpening(target))

    await runTool('open', [target])

    if (config.safariBinary) {
      await runTool('open', ['-a', config.safariBinary])
    }
  }

  logger.info?.(messages.safariNextSteps(config.appName))

  if (await confirmRegisteredWithSafari(config.bundleIdentifier)) {
    logger.info?.(messages.safariRegistered(config.appName))
  } else {
    logger.warn?.(messages.safariNotYetRegistered(config.appName))
  }
}

export async function packageSafariExtension(
  host: SafariPluginLike,
  outputPath: string,
  logger?: BrowserLogger,
  mode: SafariPipelineMode = 'full'
): Promise<void> {
  const compilation = {
    options: {output: {path: outputPath}},
    outputOptions: {path: outputPath}
  } as unknown as CompilationLike

  await runSafariPipeline(compilation, host, logger || fallbackLogger(), mode)
}

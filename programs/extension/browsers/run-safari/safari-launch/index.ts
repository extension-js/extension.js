// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import {
  humanError,
  humanLine,
  humanWarn,
  isDebug
} from '../../../helpers/messaging'
import {printDevBannerOnce} from '../../browsers-lib/banner'
import * as messages from '../../browsers-lib/messages'
import {ready as devServerReady} from '../../browsers-lib/ready-message'
import type {BrowserLogger, CompilationLike} from '../../browsers-types'
import type {SafariBuildConfig, SafariPluginLike} from '../safari-types'
import {logSafariDryRun} from './dry-run'
import {
  alignBundleIdentifiers,
  backupAndRestoreXcodeSettings,
  builtAppPath,
  composeConverterArgs,
  composeXcodebuildArgs,
  isProjectStale,
  macOsSchemeName,
  PRESERVED_SETTINGS,
  pbxprojPath,
  resolveSafariBuildConfig,
  saveManifestFingerprint,
  xcodeProjectPath
} from './safari-config'
import {detectSafariToolchain} from './toolchain'

function fallbackLogger(): BrowserLogger {
  return {
    info: (...a: unknown[]) => humanLine(...a),
    warn: (...a: unknown[]) => humanWarn(...a),
    error: (...a: unknown[]) => humanError(...a),
    debug: (...a: unknown[]) => console?.debug?.(...a)
  } as BrowserLogger
}

function isTestEnv(): boolean {
  return Boolean(process.env.VITEST || process.env.VITEST_WORKER_ID)
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// xcodebuild output for a full app build easily reaches megabytes; keep only a
// bounded tail so failure diagnostics stay useful without unbounded memory.
const TOOL_TAIL_LINES = 50
const TOOL_TAIL_BYTES = 8 * 1024

export function toolOutputTail(output: string): string {
  const lines = output
    .slice(-TOOL_TAIL_BYTES * 4)
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
  const tail = lines.slice(-TOOL_TAIL_LINES).join('\n')
  return tail.length > TOOL_TAIL_BYTES ? tail.slice(-TOOL_TAIL_BYTES) : tail
}

interface ToolResult {
  ok: boolean
  code: number | null
  output: string
}

function runTool(
  bin: string,
  args: string[],
  opts?: {quiet?: boolean}
): Promise<ToolResult> {
  const streamOutput = isDebug() && !opts?.quiet

  return new Promise((resolve) => {
    let output = ''
    const child = spawn(bin, args, {stdio: ['ignore', 'pipe', 'pipe']})

    const onChunk = (chunk: unknown) => {
      const text = String(chunk)
      output += text
      if (output.length > TOOL_TAIL_BYTES * 8) {
        output = output.slice(-TOOL_TAIL_BYTES * 4)
      }
      if (streamOutput) process.stdout.write(text)
    }

    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)
    child.on('error', (error) =>
      resolve({ok: false, code: null, output: `${output}${String(error)}`})
    )
    child.on('close', (code) => resolve({ok: code === 0, code, output}))
  })
}

function converterWarnings(output: string): string[] {
  // safari-web-extension-converter prints per-key compatibility warnings
  // ("Warning: ...") on success, the closest thing to a Safari manifest lint.
  return output
    .split(/\r?\n/)
    .filter((line) => /warning/i.test(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

async function confirmRegisteredWithSafari(
  bundleIdentifier: string
): Promise<boolean> {
  const needle = `${bundleIdentifier}.Extension`

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const {ok, output} = await runTool('pluginkit', ['-m'], {quiet: true})

    if (ok && output.includes(needle)) return true

    // Spread attempts over ~5s without blocking the event loop.
    await delay(800)
  }
  return false
}

export type SafariPipelineMode = 'full' | 'resync'

/**
 * What the pipeline resolved for this app. `bundleIdDerived` used to exist
 * only as a log line, which left a machine caller unable to learn that its
 * app carries a generated dev.extensionjs.* id shared with every project
 * built from the same source.
 */
export interface SafariPackageResult {
  appName: string
  bundleId: string
  bundleIdDerived: boolean
  appPath: string
  xcodeProjectPath: string
  macOsOnly: boolean
}

function describePackage(config: SafariBuildConfig): SafariPackageResult {
  return {
    appName: config.appName,
    bundleId: config.bundleIdentifier,
    bundleIdDerived: config.bundleIdDerived,
    appPath: builtAppPath(config),
    xcodeProjectPath: xcodeProjectPath(config),
    macOsOnly: config.macOsOnly
  }
}

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

export interface SafariBuildPreflight {
  severity: 'ok' | 'skip' | 'fatal'
  message?: string
}

// Build preflight: a non-macOS host skips packaging with a warning (bundle is
// still produced); a macOS host with broken Xcode stays fatal. dev stays strict.
export function safariBuildPreflight(): SafariBuildPreflight {
  const tc = detectSafariToolchain()

  if (!tc.platformOk) {
    return {
      severity: 'skip',
      message: messages.safariPackagingSkippedNonMac(process.platform)
    }
  }

  if (!tc.ok) {
    return {
      severity: 'fatal',
      message: tc.needsFullXcode
        ? messages.safariXcodeRequired(tc.developerDir)
        : messages.safariToolchainMissing(
            !tc.converter ? 'safari-web-extension-converter' : 'xcodebuild'
          )
    }
  }

  return {severity: 'ok'}
}

// Dev parity with the Chromium and Firefox launchers: the session has an
// identity (the appex the converter produced) and a ready moment (the watch
// loop resyncs per compile), so announce both. The appex id is the same
// needle confirmRegisteredWithSafari polls pluginkit for.
async function announceSafariDevSession(
  host: SafariPluginLike,
  config: SafariBuildConfig,
  appPath?: string
): Promise<void> {
  try {
    await printDevBannerOnce({
      browser: host.browser,
      outPath: config.extensionDir,
      getInfo: async () => ({
        extensionId: `${config.bundleIdentifier}.Extension`,
        name: config.appName
      }),
      binaryPath: appPath
    })
    humanLine(devServerReady('development', String(host.browser)))
  } catch {
    // The announcement must never fail the packaging pipeline.
  }
}

async function runSafariPipeline(
  compilation: CompilationLike,
  host: SafariPluginLike,
  logger: BrowserLogger,
  mode: SafariPipelineMode
): Promise<SafariPackageResult> {
  const config = resolveSafariBuildConfig(compilation, host)
  const converterArgs = composeConverterArgs(config)
  const xcodebuildArgs = composeXcodebuildArgs(config)

  // Warn while --bundle-id is still a free choice, before the converter and
  // xcodebuild bake the identity into the project.
  if (mode === 'full' && config.bundleIdDerived) {
    logger.warn?.(messages.safariDefaultBundleIdNote(config.bundleIdentifier))
  }

  if (host.dryRun || isTestEnv()) {
    logSafariDryRun(
      `xcrun ${converterArgs.join(' ')}`,
      `xcodebuild ${xcodebuildArgs.join(' ')}`
    )

    return describePackage(config)
  }

  const toolchain = detectSafariToolchain()
  if (!toolchain.platformOk) {
    logger.warn?.(messages.safariRequiresMacOS(process.platform))
    return describePackage(config)
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

    return describePackage(config)
  }

  const projectExists = fs.existsSync(xcodeProjectPath(config))
  const needsConversion =
    !projectExists || host.forceRegenerate || isProjectStale(config)

  if (needsConversion) {
    if (projectExists) {
      logger.info?.(
        host.forceRegenerate
          ? messages.safariForcedRegeneration()
          : messages.safariProjectStale()
      )
      // Regeneration replaces the whole project, be loud about what does
      // and does not survive, BEFORE the converter overwrites it.
      logger.warn?.(
        messages.safariRegenerationDiscards([...PRESERVED_SETTINGS])
      )
    }

    // Preserve user-configured Xcode build settings (signing team, etc.)
    // so they survive the regeneration.
    const {saved, restore} = backupAndRestoreXcodeSettings(config)

    logger.info?.(messages.safariConverting(config.extensionDir))

    const converted = await runTool('xcrun', converterArgs)
    if (!converted.ok) {
      const tail = toolOutputTail(converted.output)
      logger.error?.(
        messages.safariToolFailed(
          'safari-web-extension-converter',
          converted.code,
          tail
        )
      )
      throw new Error(
        `safari-web-extension-converter failed (exit ${converted.code})\n${tail}`
      )
    }

    const warnings = converterWarnings(converted.output)
    if (warnings.length > 0) {
      logger.warn?.(messages.safariConverterWarnings(warnings))
    }

    // The converter derives the parent-app id from the app name, not
    // --bundle-identifier; align both targets or ValidateEmbeddedBinary fails.
    const projFile = pbxprojPath(config)
    if (fs.existsSync(projFile)) {
      fs.writeFileSync(
        projFile,
        alignBundleIdentifiers(
          fs.readFileSync(projFile, 'utf8'),
          config.bundleIdentifier
        ),
        'utf8'
      )
    }

    restore()

    const preservedKeys = Object.keys(saved)
    if (preservedKeys.length > 0) {
      logger.info?.(messages.safariSettingsPreserved(preservedKeys))
    }

    saveManifestFingerprint(config)
    logger.info?.(messages.safariConverted(config.projectLocation))
  } else {
    logger.info?.(messages.safariSkippingConversion())
  }

  if (mode === 'full')
    logger.info?.(messages.safariBuilding(macOsSchemeName(config)))

  const built = await runTool('xcodebuild', xcodebuildArgs)
  if (!built.ok) {
    const tail = toolOutputTail(built.output)
    logger.error?.(messages.safariToolFailed('xcodebuild', built.code, tail))
    throw new Error(`xcodebuild failed (exit ${built.code})\n${tail}`)
  }

  const appPath = builtAppPath(config)

  // Resync mode (dev rebuilds): just report and stop, no reopen/re-guide.
  if (mode === 'resync') {
    logger.info?.(messages.safariRebuilt(config.appName))
    return describePackage(config)
  }

  logger.info?.(messages.safariBuilt(appPath))

  if (!config.open) {
    // Registration with macOS only happens once the app has been launched, so
    // polling pluginkit here would just warn spuriously. Point at the app.
    logger.info?.(messages.safariOpenHint(appPath, config.appName))
    if (host.announceDevReady) {
      await announceSafariDevSession(host, config, appPath)
    }
    return describePackage(config)
  }

  const target = fs.existsSync(appPath) ? appPath : xcodeProjectPath(config)

  logger.info?.(messages.safariOpening(target))

  await runTool('open', [target])

  if (config.safariBinary) {
    await runTool('open', ['-a', config.safariBinary])
  }

  logger.info?.(messages.safariNextSteps(config.appName))

  if (await confirmRegisteredWithSafari(config.bundleIdentifier)) {
    logger.info?.(messages.safariRegistered(config.appName))
  } else {
    logger.info?.(messages.safariNotYetRegistered(config.appName))
  }

  if (host.announceDevReady) {
    await announceSafariDevSession(host, config, appPath)
  }

  return describePackage(config)
}

export async function packageSafariExtension(
  host: SafariPluginLike,
  outputPath: string,
  logger?: BrowserLogger,
  mode: SafariPipelineMode = 'full'
): Promise<SafariPackageResult> {
  const compilation = {
    options: {output: {path: outputPath}},
    outputOptions: {path: outputPath}
  } as unknown as CompilationLike

  return await runSafariPipeline(
    compilation,
    host,
    logger || fallbackLogger(),
    mode
  )
}

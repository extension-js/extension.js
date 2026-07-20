// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {spawn} from 'node:child_process'
import * as fs from 'node:fs'
import * as messages from '../../browsers-lib/messages'
import type {BrowserLogger, CompilationLike} from '../../browsers-types'
import type {SafariPluginLike} from '../safari-types'
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
    info: (...a: unknown[]) => console.log(...a),
    warn: (...a: unknown[]) => console.warn(...a),
    error: (...a: unknown[]) => console.error(...a),
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
  const streamOutput =
    process.env.EXTENSION_AUTHOR_MODE === 'true' && !opts?.quiet

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

/**
 * Preflight for `build`: a non-macOS host is not an error, the web-extension
 * bundle is still produced and can be packaged later on a Mac, so packaging
 * is skipped with a warning. A macOS host with a broken/missing Xcode stays
 * fatal because the user can act on it locally. `dev` keeps the stricter
 * safariPreflightError(): a Safari dev loop without packaging is pointless.
 */
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

    // The converter derives the parent-app id from the app name, not from
    // --bundle-identifier, align both targets to the configured identity or
    // ValidateEmbeddedBinary fails when a user-set id doesn't match the name.
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
    return
  }

  logger.info?.(messages.safariBuilt(appPath))

  if (config.bundleIdDerived) {
    logger.info?.(messages.safariDefaultBundleIdNote(config.bundleIdentifier))
  }

  if (!config.open) {
    // Registration with macOS only happens once the app has been launched, so
    // polling pluginkit here would just warn spuriously. Point at the app.
    logger.info?.(messages.safariOpenHint(appPath, config.appName))
    return
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

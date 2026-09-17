// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {humanError, humanLine, humanWarn} from '../../../helpers/messaging'
import {printDevBannerOnce} from '../../browsers-lib/banner'
import * as messages from '../../browsers-lib/messages'
import {ready as devServerReady} from '../../browsers-lib/ready-message'
import {stampReadyBrowserLaunch} from '../../browsers-lib/ready-stamp'
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
import {
  createSafariTools,
  type SafariPipelineTools,
  toolOutputTail
} from './tools'

export {
  type SafariPipelineTools,
  type SafariToolResult,
  toolOutputTail
} from './tools'

function fallbackLogger(): BrowserLogger {
  return {
    info: (...a: unknown[]) => humanLine(...a),
    warn: (...a: unknown[]) => humanWarn(...a),
    error: (...a: unknown[]) => humanError(...a),
    debug: (...a: unknown[]) => console?.debug?.(...a)
  } as BrowserLogger
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function converterWarnings(output: string): string[] {
  // safari-web-extension-converter prints per-key compatibility warnings
  // ("Warning: ...") on success, the closest thing to a Safari manifest lint.
  // The keys themselves arrive on INDENTED continuation lines that never say
  // "warning", so matching that word alone told the user something was
  // unsupported and never which key it was.
  const lines = output.split(/\r?\n/)
  const collected: string[] = []
  let inWarning = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (/warning/i.test(line)) {
      inWarning = true
      if (trimmed.length > 0) collected.push(trimmed)

      continue
    }

    // A continuation keeps its indentation. A blank line or a flush-left line
    // ends the block, so unrelated output never rides along.
    const isContinuation = inWarning && /^\s/.test(line) && trimmed.length > 0

    if (isContinuation) {
      collected.push(trimmed)
      continue
    }

    inWarning = false
  }

  return collected
}

async function confirmRegisteredWithSafari(
  tools: SafariPipelineTools,
  bundleIdentifier: string
): Promise<boolean> {
  const needle = `${bundleIdentifier}.Extension`

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const listing = await tools.pluginkitList()

    if (listing.includes(needle)) return true

    // Spread attempts over ~5s without blocking the event loop.
    await delay(800)
  }

  return false
}

export type SafariPipelineMode = 'full' | 'resync'

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

function completePackage(
  config: SafariBuildConfig,
  logger: BrowserLogger,
  mode: SafariPipelineMode
): SafariPackageResult {
  if (mode === 'full' && config.bundleIdDerived) {
    logger.info?.(messages.safariDefaultBundleIdNote(config.bundleIdentifier))
  }

  return describePackage(config)
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
  const tools = host.tools || createSafariTools()
  const config = resolveSafariBuildConfig(compilation, host)
  const converterArgs = composeConverterArgs(config)
  const xcodebuildArgs = composeXcodebuildArgs(config)

  // Which set of enabling steps the user is about to be told to follow. Read
  // from the resolved config rather than the raw flag so extension.config.js
  // counts the same as --development-team.
  const isSigned = Boolean(config.developmentTeam)

  if (host.dryRun) {
    logSafariDryRun(
      `xcrun ${converterArgs.join(' ')}`,
      `xcodebuild ${xcodebuildArgs.join(' ')}`
    )

    return completePackage(config, logger, mode)
  }

  const toolchain = tools.detectToolchain()

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

    const converted = await tools.runConverter(converterArgs)

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
  } else if (mode === 'full') {
    // Dev resyncs run this on every save. The line says nothing new there, and
    // the first package already reported how the project was reused.
    logger.info?.(messages.safariSkippingConversion())
  }

  if (mode === 'full') {
    logger.info?.(messages.safariBuilding(macOsSchemeName(config)))
  }

  const built = await tools.runXcodebuild(xcodebuildArgs)

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

    return completePackage(config, logger, mode)
  }

  const target = fs.existsSync(appPath) ? appPath : xcodeProjectPath(config)

  logger.info?.(messages.safariOpening(target))

  await tools.openApp(target)

  if (config.safariBinary) {
    await tools.openSafari(config.safariBinary)
  }

  // Which app is actually on screen decides what a tool should attach to:
  // Safari itself when the caller pinned a Safari binary, otherwise the
  // container app the converter built, which is what a plain run raises.
  const raisedBundleId = config.safariBinary
    ? 'com.apple.Safari'
    : config.bundleIdentifier
  const browserPid = await tools.resolvePid(raisedBundleId)

  // The identity and binary are known even when the pid lookup came back
  // empty, so the contract still names the appex a tool has to address.
  stampReadyBrowserLaunch(config.extensionDir, {
    browserPid: browserPid || undefined,
    binary: config.safariBinary || appPath,
    binaryProvenance: config.safariBinary ? 'pinned' : 'system',
    // `build` publishes this and `dev` did not, so the same project reported
    // its identity under one command and stayed silent under the other. It
    // is the only machine-readable name for the appex a tool has to address.
    extensionId: `${config.bundleIdentifier}.Extension`
  })

  if (!browserPid) {
    logger.warn?.(messages.safariPidUnresolved(config.appName))
  }

  logger.info?.(messages.safariNextSteps(config.appName, isSigned))

  if (await confirmRegisteredWithSafari(tools, config.bundleIdentifier)) {
    logger.info?.(messages.safariRegistered(config.appName))
  } else {
    logger.info?.(messages.safariNotYetRegistered(config.appName))
  }

  if (host.announceDevReady) {
    await announceSafariDevSession(host, config, appPath)
  }

  return completePackage(config, logger, mode)
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

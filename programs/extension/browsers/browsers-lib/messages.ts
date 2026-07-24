// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import {createRequire} from 'node:module'
import * as os from 'node:os'
import * as path from 'node:path'
import {getChromeVersion, locateChromeOrExplain} from 'chrome-location2'
import locateChromium, {getChromiumVersion} from 'chromium-location'
import locateEdge, {getEdgeVersion} from 'edge-location'
import locateFirefox, {getFirefoxVersion} from 'firefox-location2'
import colors from 'pintor'
import type {BrowserType} from '../browsers-types'

type Browser = BrowserType
type Mode = 'development' | 'production' | 'none'
type PackageManagerName = 'pnpm' | 'yarn' | 'npm' | 'bun' | 'unknown'
type PackageJson = {
  packageManager?: string
  scripts?: Record<string, string>
}

// Keep CJS `require` for JSON / dynamic loads (avoid import-assertions in toolchains)
const require = createRequire(import.meta.url)

function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success') {
  const isAuthor = process.env.EXTENSION_AUTHOR_MODE === 'true'

  if (isAuthor) {
    const base = type === 'error' ? 'ERROR Author says' : '⏵⏵⏵ Author says'
    return colors.brightMagenta(base)
  }

  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('⏵⏵⏵')
  if (type === 'info') return colors.gray('⏵⏵⏵')
  return colors.green('⏵⏵⏵')
}

function errorDetail(error: unknown) {
  if (process.env.EXTENSION_DEBUG === '1') return String(error)
  const maybe = (error as {message?: string} | undefined)?.message
  return String(maybe || error)
}

function isWsl(): boolean {
  if (process.platform !== 'linux') return false

  // Heuristic env-based detection (fast, testable). Avoid reading /proc.
  const hasEnv = Boolean(
    String(process.env.WSL_DISTRO_NAME || '').trim() ||
      String(process.env.WSL_INTEROP || '').trim() ||
      String(process.env.WSLENV || '').trim()
  )
  // If these env vars are present, treat as WSL even if the host platform
  // running unit tests is not Linux.
  if (hasEnv) return true
  return /microsoft/i.test(os.release())
}

function findNearestPackageJson(startPath: string): string | null {
  let current = path.resolve(startPath)

  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, 'package.json')
    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }

  return null
}

function safeReadPackageJson(filePath: string): PackageJson | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as PackageJson
  } catch {
    return null
  }
}

function detectCurrentPackageManager(
  projectRoot: string,
  pkg?: PackageJson | null
): PackageManagerName {
  const userAgent = String(
    process.env.npm_config_user_agent || ''
  ).toLowerCase()

  if (userAgent.includes('pnpm')) return 'pnpm'
  if (userAgent.includes('yarn')) return 'yarn'
  if (userAgent.includes('bun')) return 'bun'
  if (userAgent.includes('npm')) return 'npm'

  const declared = String(pkg?.packageManager || '')
    .trim()
    .toLowerCase()

  if (declared.startsWith('pnpm@')) return 'pnpm'
  if (declared.startsWith('yarn@')) return 'yarn'
  if (declared.startsWith('bun@')) return 'bun'
  if (declared.startsWith('npm@')) return 'npm'

  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) return 'bun'
  if (fs.existsSync(path.join(projectRoot, 'bun.lock'))) return 'bun'
  if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) return 'npm'

  return 'unknown'
}

function preferredManagedInstallCommand(browser: string): string {
  const packageJsonPath = findNearestPackageJson(process.cwd())
  const pkg = packageJsonPath ? safeReadPackageJson(packageJsonPath) : null
  const projectRoot = packageJsonPath
    ? path.dirname(packageJsonPath)
    : process.cwd()
  const hasExtensionScript = Boolean(pkg?.scripts?.extension)
  const packageManager = detectCurrentPackageManager(projectRoot, pkg)

  if (hasExtensionScript) {
    if (packageManager === 'pnpm') return `pnpm extension install ${browser}`
    if (packageManager === 'npm')
      return `npm run extension -- install ${browser}`
    if (packageManager === 'bun')
      return `bun run extension -- install ${browser}`
    if (packageManager === 'yarn') return `yarn extension install ${browser}`
  }

  if (packageManager === 'pnpm') return `pnpm exec extension install ${browser}`
  if (packageManager === 'bun') return `bunx extension install ${browser}`
  return `npx extension install ${browser}`
}

function managedBrowserDisplayName(browser: string): string {
  if (browser === 'chrome') return 'Chrome for Testing'
  if (browser === 'chromium') return 'Chromium'
  if (browser === 'firefox') return 'Firefox'
  if (browser === 'edge') return 'Edge'
  return browser
}

export function capitalizedBrowserName(browser: Browser) {
  return `${browser.charAt(0).toUpperCase() + browser.slice(1)}`
}

export function creatingUserProfile(profilePath: string) {
  return `${getLoggingPrefix('info')} Creating a fresh user profile at ${colors.underline(profilePath)}...`
}

export function browserInstanceExited(browser: Browser) {
  return `${getLoggingPrefix('info')} ${capitalizedBrowserName(browser)} instance exited.`
}

export function cdpClientAttachedToTarget(
  sessionId: string,
  targetType: string
) {
  return `${getLoggingPrefix('info')} Attached to target: ${targetType} (session ${sessionId})`
}

export function cdpPendingRejectFailed(message: string) {
  return `[CDP] Pending request reject failed: ${message}`
}

export function cdpFailedToHandleMessage(message: string) {
  return `[CDP] Failed to handle message: ${message}`
}

export function cdpAutoAttachSetupFailed(message: string) {
  return `[CDP] Failed to set discover/autoAttach: ${message}`
}

export function cdpProtocolEventHandlerError(message: string) {
  return `[CDP] Protocol event handler error: ${message}`
}

export function bestEffortBannerPrintFailed(message: string) {
  return `[browser] Best-effort banner print failed: ${message}`
}

export function firefoxRdpRuntimeCapabilitySummary(
  state: 'available' | 'unavailable'
) {
  const txt =
    state === 'available'
      ? 'browser.scripting available, content-script edits will preserve background/popup state'
      : 'browser.scripting unavailable, content-script edits will fall back to addon reinstall'
  return `${getLoggingPrefix('info')} Firefox RDP runtime capability: ${txt}`
}

export function skippingBrowserLaunchDueToCompileErrors() {
  return `${getLoggingPrefix('warn')} Skipping browser launch due to compile errors`
}

export function browserNotInstalledError(
  browser: Browser,
  browserBinaryLocation: string
) {
  const isUnreachable =
    browserBinaryLocation === 'null'
      ? `Browser ${capitalizedBrowserName(browser)} is not installed\n`
      : `Can't find the path for browser ${capitalizedBrowserName(browser)}\n`

  const wslHint = (() => {
    if (!isWsl()) return ''
    // WSL commonly has no Linux browser installed, but can launch Windows .exe paths.
    // Also note: shell aliases do not apply to child_process.spawn.
    const example = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    return (
      `\n\n${getLoggingPrefix('info')} WSL detected\n` +
      `- Install a Linux browser in WSL, or\n` +
      `- Provide a Windows binary path via ${colors.blue('--chromium-binary')} ${colors.gray(`"${example}"`)}\n` +
      `  (Tip: a shell alias like ${colors.gray('google-chrome=...')} won't be used by Extension.js; use a real path or wrapper script.)`
    )
  })()

  return (
    `${getLoggingPrefix('error')} ${isUnreachable}` +
    `Either install the missing browser or choose a different one via ` +
    `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}.\n\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(browserBinaryLocation || `${capitalizedBrowserName(browser)}BROWSER`)}` +
    wslHint
  )
}

export function usingManagedChromiumFamilyFallback(
  requestedBrowser: Browser,
  fallbackBrowser: Browser,
  binaryPath: string
) {
  return (
    `${getLoggingPrefix('info')} ${managedBrowserDisplayName(requestedBrowser)} is not installed. ` +
    `Using managed ${managedBrowserDisplayName(fallbackBrowser)} instead.\n` +
    `${colors.gray('PATH')} ${colors.underline(binaryPath)}\n` +
    `Run ${colors.blue(`npx extension install ${requestedBrowser}`)} to use ` +
    `${managedBrowserDisplayName(requestedBrowser)} itself.`
  )
}

// One always-on line naming the exact binary a dev session runs. A silently
// selected cached snapshot must never be invisible in dev output.
export function resolvedBrowserBinary(
  browser: Browser,
  binaryPath: string,
  versionLine?: string
) {
  const version =
    versionLine && versionLine.trim().length > 0
      ? versionLine.trim()
      : capitalizedBrowserName(browser)
  return `${getLoggingPrefix('info')} Browser: ${version} ${colors.gray('at')} ${colors.underline(binaryPath)}`
}

export function preferringSystemBrowserOverSnapshot(
  systemBinary: string,
  snapshotBinary: string
) {
  return (
    `${getLoggingPrefix('info')} Using the installed browser instead of the cached Chromium snapshot (a dev-channel build).\n` +
    `${colors.gray('USING')} ${colors.underline(systemBinary)}\n` +
    `${colors.gray('CACHED')} ${colors.underline(snapshotBinary)}\n` +
    `Set ${colors.blue('EXTENSION_PREFER_CHROMIUM_SNAPSHOT=true')} to use the cached snapshot.`
  )
}

export function mv2NotSupportedByChromium(extensionPath: string) {
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow('This extension declares Manifest V2, which modern Chromium refuses to load.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    `The browser will reject it at launch (a native dialog, not a console error), so the dev session cannot attach.\n` +
    `Run it on an MV2-capable browser (${colors.blue('--browser firefox')}) or migrate the manifest to MV3.`
  )
}

export function mv3BackgroundScriptsNotSupportedByChromium(
  extensionPath: string
) {
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow('This MV3 extension declares Firefox-style background.scripts with no service_worker, Chromium refuses to load it.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    `The browser rejects it at launch with no console error, so the dev session cannot attach.\n` +
    `Run it on the browser it targets (${colors.blue('--browser firefox')}) or declare ${colors.blue('background.service_worker')} for Chromium.`
  )
}

export function unsupportedManifestVersionOnChromium(
  extensionPath: string,
  declared: unknown
) {
  const value =
    declared === undefined
      ? 'no manifest_version'
      : `manifest_version ${JSON.stringify(declared)}`
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow(`This extension declares ${value}, which Chromium refuses as an unsupported manifest version.`)}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    `The browser rejects it at launch (a native dialog, not a console error), so the dev session cannot attach.\n` +
    `Declare ${colors.blue('"manifest_version": 3')} in the source manifest.`
  )
}

export function chromiumInvalidMatchPatterns(
  extensionPath: string,
  patterns: string[]
) {
  const shown = patterns.slice(0, 6)
  const more = patterns.length - shown.length
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow('This extension declares match patterns Chrome refuses, the whole extension will not load.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    shown
      .map((pattern) => `${colors.gray('PATTERN')} ${colors.red(pattern)}\n`)
      .join('') +
    (more > 0 ? `${colors.gray(`…and ${more} more`)}\n` : '') +
    `A match pattern's host wildcard must be ${colors.blue('*')} or ${colors.blue('*.domain.tld')}, ` +
    `a wildcard anywhere else in the host is invalid. ` +
    `Replace the host with ${colors.blue('*')} or ${colors.blue('*.domain.tld')} in the source manifest.`
  )
}

export function chromiumManifestLoadBlockers(
  extensionPath: string,
  blockers: string[]
) {
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow('This manifest declares shapes Chrome refuses, the whole extension will not load.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    blockers
      .map((blocker) => `${colors.gray('REASON')} ${colors.red(blocker)}\n`)
      .join('') +
    `Chrome rejects the extension at load, so no service worker or content script ever runs. ` +
    `Fix these in the source manifest.`
  )
}

// The browser accepted the launch but rejected the guest. Reported from the
// browser's own answer, so it reads the same headed (modal) and headless (silent).
export function chromiumExtensionLoadRefused(
  extensionPath: string,
  reason: string
) {
  return (
    `${getLoggingPrefix('error')} ${colors.red('The browser refused to load this extension, so it is NOT running.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    (reason ? `${colors.gray('REASON')} ${colors.red(reason)}\n` : '') +
    `No service worker, content script, or page from this extension will run, and no Extension ID was assigned. ` +
    `The browser will not retry on its own: fix the reason above, then restart the dev session.`
  )
}

export function devChannelSnapshotInUse(binaryPath: string) {
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow('Running a Chromium tip-of-tree snapshot (dev channel, not a stable release).')}\n` +
    `${colors.gray('PATH')} ${colors.underline(binaryPath)}\n` +
    `Behavior may differ from stable Chrome. Install a stable browser or remove the snapshot to stop using it.`
  )
}

export function browserLaunchError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Error launching ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementCleanup(browser: Browser) {
  return `${getLoggingPrefix('info')} Process Management cleanup for ${capitalizedBrowserName(browser)}`
}

export function enhancedProcessManagementTerminating(browser: Browser) {
  return `${getLoggingPrefix('info')} Terminating ${capitalizedBrowserName(browser)} process gracefully`
}

export function enhancedProcessManagementForceKill(browser: Browser) {
  return (
    `${getLoggingPrefix('warn')} ${capitalizedBrowserName(browser)} did not exit gracefully, forcing the process to close.\n` +
    `This is a normal cleanup step and does not affect your build output.`
  )
}

export function enhancedProcessManagementCleanupError(
  browser: Browser,
  error: unknown
) {
  return (
    `${getLoggingPrefix('error')} Error during ${capitalizedBrowserName(browser)} cleanup:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementUncaughtException(
  browser: Browser,
  error: unknown
) {
  return (
    `${getLoggingPrefix('error')} Uncaught exception in ${capitalizedBrowserName(browser)} process:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementUnhandledRejection(
  browser: Browser,
  reason: unknown
) {
  return (
    `${getLoggingPrefix('error')} Unhandled rejection in ${capitalizedBrowserName(browser)} process:\n` +
    `${colors.red(errorDetail(reason))}`
  )
}

export function generalBrowserError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} General error in ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function errorConnectingToBrowser(browser: Browser, port?: number) {
  const where = typeof port === 'number' ? ` on port ${port}` : ''
  return (
    `${getLoggingPrefix('error')} Unable to connect to ${capitalizedBrowserName(browser)}${where} after several retries.\n` +
    `Another browser instance is usually still holding that debugging port, often one left over from an earlier dev session.\n` +
    `Close ${capitalizedBrowserName(browser)} windows opened by Extension.js and run the command again, or pass ${colors.blue('--profile')} ${colors.gray('<path>')} to launch against a separate profile.`
  )
}

export function waitingForBrowserDebugger(
  browser: Browser,
  port: number,
  attempt: number,
  maxRetries: number
) {
  return `${getLoggingPrefix('info')} Waiting for the ${capitalizedBrowserName(browser)} debugger server on port ${port} (attempt ${attempt}/${maxRetries})...`
}

export function addonInstallError(browser: Browser, message: string) {
  return (
    `${getLoggingPrefix('error')} Can't install add-on into ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(message)}`
  )
}

export function messagingClientClosedError(browser: Browser) {
  return (
    `${getLoggingPrefix('error')} The ${capitalizedBrowserName(browser)} messaging channel closed unexpectedly.\n` +
    `The browser exited, or its debugging connection was dropped while the dev session was still running.\n` +
    `Check whether the browser window was closed by hand, then run the command again.`
  )
}

export function connectionClosedError(browser: Browser) {
  return (
    `${getLoggingPrefix('error')} The debugging connection to ${capitalizedBrowserName(browser)} closed unexpectedly.\n` +
    `Reload and HMR need that connection, so the dev session cannot keep the extension up to date.\n` +
    `Restart the dev session. If it keeps happening, launch with ${colors.blue('--profile')} ${colors.gray('<path>')} to rule out a corrupted browser profile.`
  )
}

export function targetActorHasActiveRequestError(
  browser: Browser,
  targetActor: string
) {
  return `${getLoggingPrefix('error')} Target actor ${colors.gray(targetActor)} has active request for ${capitalizedBrowserName(browser)}`
}

export function parsingPacketError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Failed to parse packet from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function messageWithoutSenderError(
  browser: Browser,
  message: {
    from?: string
    type?: string
    error?: unknown
  }
) {
  return (
    `${getLoggingPrefix('error')} Message without sender from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(JSON.stringify(message))}`
  )
}

export function chromeProcessExited(code: number) {
  return `${getLoggingPrefix('info')} Chrome process exited with code: ${colors.gray(code.toString())}`
}

export function chromeProcessError(error: unknown) {
  return `${getLoggingPrefix('error')} Chrome process error:\n${colors.red(errorDetail(error))}`
}

export function chromeFailedToSpawn(error: unknown) {
  return `${getLoggingPrefix('error')} Failed to spawn Chrome:\n${colors.red(errorDetail(error))}`
}

export function chromeInitializingEnhancedReload() {
  return `${getLoggingPrefix('info')} Initializing enhanced reload service with direct spawn for Chrome`
}

export function locatingBrowser(browser: Browser) {
  return `${getLoggingPrefix('info')} Locating ${capitalizedBrowserName(browser)} browser binary...`
}

export function devChromeProfilePath(path: string) {
  return `${getLoggingPrefix('info')} Chrome profile: ${colors.underline(path)}`
}

export function chromiumDryRunNotLaunching() {
  return `${getLoggingPrefix('info')} [browser] Dry run: not launching browser`
}

export function chromiumDryRunBinary(path: string) {
  return `${getLoggingPrefix('info')} [browser] Binary: ${colors.underline(path)}`
}

export function chromiumDryRunFlags(flags: string) {
  return `${getLoggingPrefix('info')} [browser] Flags: ${colors.gray(flags)}`
}

export function prettyPuppeteerInstallGuidance(
  browser: Browser,
  rawGuidance: string,
  cacheDir: string
): string {
  const dim = colors.gray
  const body: string[] = []

  let browserNorm = 'chromium'
  if (browser === 'chromium-based') {
    browserNorm = 'chromium'
  } else if (browser === 'gecko-based') {
    browserNorm = 'firefox'
  } else if (
    browser === 'chrome' ||
    browser === 'chromium' ||
    browser === 'firefox' ||
    browser === 'edge'
  ) {
    browserNorm = browser
  }

  const finalCachePath =
    browserNorm && cacheDir ? path.join(cacheDir, browserNorm) : cacheDir
  const installCommand = preferredManagedInstallCommand(browserNorm)
  const browserDisplay = managedBrowserDisplayName(browserNorm)

  body.push(`${getLoggingPrefix('warn')} Browser setup required`)
  body.push('')
  body.push(`${browserDisplay} is not available in the managed browser cache.`)
  body.push('')
  body.push(
    colors.gray(`Install ${browserDisplay} into the managed browser cache:`)
  )
  body.push('')
  body.push(`  ${colors.bold(colors.blue(installCommand))}`)
  // Chromium managed installs are unbranded tip-of-tree snapshots; Chrome for
  // Testing tracks stable and satisfies chromium targets, recommend it.
  if (browserNorm === 'chromium') {
    body.push('')
    body.push(
      colors.gray(
        'Or install Chrome for Testing (stable channel), chromium targets use it automatically:'
      )
    )
    body.push('')
    body.push(
      `  ${colors.bold(colors.blue(preferredManagedInstallCommand('chrome')))}`
    )
  }
  if (finalCachePath) {
    body.push('')
    body.push(`${dim('INSTALL PATH')} ${colors.underline(finalCachePath)}`)
  }
  body.push(`${dim('NEXT')} Re-run your command after the install finishes.`)
  return `${body.join('\n')}\n`
}

export function firefoxLaunchCalled() {
  return `${getLoggingPrefix('info')} Firefox launch requested.`
}

export function firefoxBinaryArgsExtracted(args: string) {
  return `${getLoggingPrefix('info')} Firefox binary args extracted: ${colors.gray(args)}`
}

export function firefoxNoBinaryArgsFound() {
  return `${getLoggingPrefix('info')} No Firefox binary args found`
}

export function firefoxFailedToStart(error: unknown) {
  return `${getLoggingPrefix('error')} Firefox failed to start:\n${colors.red(errorDetail(error))}`
}

export function firefoxDryRunNotLaunching() {
  return `${getLoggingPrefix('info')} [browser] Dry run: not launching browser`
}

export function firefoxDryRunBinary(path: string) {
  return `${getLoggingPrefix('info')} [browser] Binary (detected): ${colors.underline(path)}`
}

export function firefoxDryRunConfig(cfg: string) {
  return `${getLoggingPrefix('info')} [browser] Config: ${colors.gray(cfg)}`
}

export function safariBuildCalled() {
  return `${getLoggingPrefix('info')} Safari build requested.`
}

function prettyPlatform(platform: string) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}

export function safariRequiresMacOS(platform: string) {
  return (
    `${getLoggingPrefix('warn')} Safari extensions can only be built on macOS.\n` +
    `Detected ${colors.gray(prettyPlatform(platform))}. Target another browser via ` +
    `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}, or run this ` +
    `command on a Mac with Xcode.`
  )
}

export function safariPackagingSkippedNonMac(platform: string) {
  return (
    `${getLoggingPrefix('warn')} Safari packaging needs macOS with Xcode, detected ` +
    `${colors.gray(prettyPlatform(platform))}, so the Xcode packaging step is skipped.\n` +
    `The web-extension build in ${colors.yellow('dist/safari')} is still complete and can be ` +
    `packaged later on a Mac with ${colors.blue('extension build --browser=safari')}.`
  )
}

export function safariXcodeRequired(developerDir: string | null) {
  const current = developerDir
    ? `${colors.gray('Active toolchain:')} ${colors.underline(developerDir)}`
    : `${colors.gray('No active developer directory was found.')}`

  return (
    `${getLoggingPrefix('error')} Safari packaging needs the full Xcode app (not just the Command Line Tools).\n` +
    `${colors.red('NOT FOUND')} ${colors.underline('safari-web-extension-converter')}\n` +
    `${current}\n\n` +
    `To enable Safari builds:\n` +
    `- Install ${colors.yellow('Xcode')} from the Mac App Store, then\n` +
    `- Point the toolchain at it: ${colors.blue('sudo xcode-select --switch')} ${colors.gray('/Applications/Xcode.app')}\n` +
    `- Finish setup once: ${colors.blue('xcodebuild -runFirstLaunch')}\n\n` +
    `Prefer to keep building now? Target another browser via ` +
    `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}.`
  )
}

export function safariToolchainMissing(tool: string) {
  return (
    `${getLoggingPrefix('error')} Safari packaging tool not found: ${colors.underline(tool)}\n` +
    `Your Xcode install looks incomplete. Try ${colors.blue('xcodebuild -runFirstLaunch')}, ` +
    `or reinstall Xcode from the Mac App Store.`
  )
}

export function safariConverting(extensionDir: string) {
  return `${getLoggingPrefix('info')} Converting web extension into a Safari app project from ${colors.underline(extensionDir)}`
}

export function safariConverted(projectDir: string) {
  return `${getLoggingPrefix('success')} Generated Safari Xcode project at ${colors.underline(projectDir)}`
}

export function safariBuilding(scheme: string) {
  return `${getLoggingPrefix('info')} Building Safari app with xcodebuild (scheme: ${colors.gray(scheme)})`
}

export function safariBuilt(appPath: string) {
  return `${getLoggingPrefix('success')} Built Safari app at ${colors.underline(appPath)}`
}

export function safariOpening(target: string) {
  return `${getLoggingPrefix('info')} Opening ${colors.underline(target)}`
}

export function safariToolFailed(
  tool: string,
  exitCode: number | null,
  outputTail: string
) {
  const code = exitCode === null ? 'no exit code' : `exit ${exitCode}`
  const tail = outputTail.trim().length
    ? `\n${colors.gray('── last output ──')}\n${outputTail}`
    : `\n${colors.gray('(no output captured)')}`
  return (
    `${getLoggingPrefix('error')} Safari packaging tool ${colors.underline(tool)} ` +
    `failed (${colors.red(code)}).${tail}`
  )
}

export function safariConverterWarnings(warnings: string[]) {
  return (
    `${getLoggingPrefix('warn')} safari-web-extension-converter reported ` +
    `${colors.yellow(String(warnings.length))} warning(s), some manifest keys/APIs ` +
    `may not be supported by Safari:\n` +
    warnings.map((line) => `  ${colors.gray('•')} ${line}`).join('\n')
  )
}

export function safariDefaultBundleIdNote(bundleId: string) {
  return (
    `${getLoggingPrefix('info')} Using the generated bundle id ${colors.gray(bundleId)}. ` +
    `For an app you plan to distribute, set your own with ${colors.blue('--bundle-id')} ` +
    `now, changing it later makes Safari treat the extension as a new identity.`
  )
}

export function safariOpenHint(appPath: string, appName: string) {
  return (
    `${getLoggingPrefix('info')} Launch it once to register with Safari: ` +
    `${colors.blue('open')} ${colors.underline(`"${appPath}"`)}\n` +
    `Then enable ${colors.brightBlue(appName)} via Safari ▸ Develop ▸ ` +
    `${colors.yellow('Allow Unsigned Extensions')} and Safari ▸ Settings ▸ Extensions.`
  )
}

export function safariDryRunNotBuilding() {
  return `${getLoggingPrefix('info')} [browser] Dry run: not building Safari app`
}

export function safariDryRunConverter(cmd: string) {
  return `${getLoggingPrefix('info')} [browser] Converter: ${colors.gray(cmd)}`
}

export function safariDryRunXcodebuild(cmd: string) {
  return `${getLoggingPrefix('info')} [browser] xcodebuild: ${colors.gray(cmd)}`
}

export function safariNextSteps(appName: string) {
  return (
    `${getLoggingPrefix('info')} One-time setup to load ${colors.brightBlue(appName)} in Safari:\n` +
    `  ${colors.gray('1.')} Safari ▸ Settings ▸ Advanced ▸ check ${colors.yellow('“Show features for web developers”')}\n` +
    `  ${colors.gray('2.')} Safari ▸ Develop ▸ ${colors.yellow('Allow Unsigned Extensions')} ${colors.gray('(resets each launch)')}\n` +
    `  ${colors.gray('3.')} Safari ▸ Settings ▸ Extensions ▸ turn on ${colors.yellow(appName)}\n` +
    `  ${colors.gray('→')} The app window that just opened can also take you there.`
  )
}

export function safariRegistered(appName: string) {
  return `${getLoggingPrefix('success')} Safari recognizes ${colors.brightBlue(appName)}, finish enabling it with the steps above.`
}

export function safariNotYetRegistered(appName: string) {
  return `${getLoggingPrefix('warn')} Safari hasn't picked up ${colors.brightBlue(appName)} yet. Open the app once, then check Safari ▸ Settings ▸ Extensions.`
}

export function safariRebuilt(appName: string) {
  return `${getLoggingPrefix('success')} Rebuilt ${colors.brightBlue(appName)}, reload the page (or toggle the extension) in Safari to see changes.`
}

export function safariProjectStale() {
  return `${getLoggingPrefix('info')} manifest.json or identity options changed since the Xcode project was generated, regenerating project.`
}

export function safariForcedRegeneration() {
  return `${getLoggingPrefix('info')} --force-regenerate set, regenerating the Xcode project.`
}

export function safariRegenerationDiscards(preservedKeys: string[]) {
  return (
    `${getLoggingPrefix('warn')} Regenerating replaces the Xcode project: customizations ` +
    `made in Xcode (entitlements, capabilities, added files/targets) are ${colors.red('discarded')}.\n` +
    `Preserved automatically: ${colors.yellow(preservedKeys.join(', '))}. ` +
    `If you customized the project, back it up before continuing.`
  )
}

export function safariSettingsPreserved(keys: string[]) {
  return (
    `${getLoggingPrefix('info')} Preserved Xcode build settings across regeneration: ${colors.yellow(keys.join(', '))}.\n` +
    `If any other project-level tweaks were lost, reconfigure them in Xcode.`
  )
}

export function safariSkippingConversion() {
  return `${getLoggingPrefix('info')} Xcode project is up to date with manifest.json, skipping conversion.`
}

export function cdpClientFoundTargets(count: number) {
  return `${getLoggingPrefix('info')} Chrome found ${colors.gray(count.toString())} targets`
}

export function cdpClientTargetWebSocketUrlStored() {
  return `${getLoggingPrefix('info')} Chrome target WebSocket URL stored for future connections`
}

export function cdpClientConnected(host: string, port: number) {
  return `${getLoggingPrefix('success')} Chrome CDP Client connected to ${colors.gray(host)}:${colors.gray(port.toString())}`
}

export function cdpClientConnectionError(error: string) {
  return `${getLoggingPrefix('error')} Chrome CDP Client connection error: ${colors.red(error)}`
}

export function cdpClientBrowserConnectionEstablished() {
  return `${getLoggingPrefix('success')} Chrome CDP Client browser connection established`
}

export function cdpClientConnectionClosed() {
  return `${getLoggingPrefix('warn')} Chrome CDP connection is closed`
}

export function cdpClientLoadEventTimeout() {
  return `${getLoggingPrefix('warn')} Chrome load event timed out; proceeding anyway...`
}

export function cdpClientExtensionUnloadFailed(
  extensionId: string,
  error: string
) {
  return `${getLoggingPrefix('error')} Chrome CDP Client: Failed to unload extension ${colors.gray(extensionId)}: ${colors.red(error)}`
}

export function cdpClientExtensionInfoFailed(
  extensionId: string,
  error: string
) {
  return `${getLoggingPrefix('error')} Chrome CDP Client: Failed to get extension info for ${colors.gray(extensionId)}: ${colors.red(error)}`
}

export function cdpClientExtensionLoadFailed(path: string, error: string) {
  return `${getLoggingPrefix('error')} Chrome CDP Client: Failed to load extension from ${colors.underline(path)}: ${colors.red(error)}`
}

export function firefoxRdpClientConnected(host: string, port: number) {
  return `${getLoggingPrefix('success')} Connected to Firefox Remote Debugging Protocol on ${colors.gray(host)}:${colors.gray(port.toString())}`
}

export function firefoxRdpClientTestingEvaluation() {
  return `${getLoggingPrefix('info')} Testing basic Firefox RDP evaluation...`
}

export function firefoxRdpClientFailedToGetMainHTML() {
  return (
    `${getLoggingPrefix('error')} Could not read the page document over the Firefox remote debugging protocol.\n` +
    `The tab usually navigated or closed before the request finished.\n` +
    `Reload the page and try again. If it persists, restart the dev session.`
  )
}

export function firefoxRdpReinjectListAddonsFailed(error: string) {
  return `${getLoggingPrefix('warn')} Firefox runtime reinjection could not list addons: ${colors.red(error)}`
}

export function firefoxRdpReinjectNoDescriptor(
  addonId: string,
  addons: string
) {
  return `${getLoggingPrefix('warn')} Firefox runtime reinjection found no descriptor for addon ${colors.gray(addonId)}; addons=${colors.gray(addons)}`
}

export function firefoxRdpReinjectWatcherUnavailable(
  descriptorActor: string,
  detail: string
) {
  return `${getLoggingPrefix('warn')} Firefox runtime reinjection could not resolve a watcher for ${colors.gray(descriptorActor)}: ${colors.red(detail)}`
}

export function firefoxRdpReinjectWatchTargetsFailed(
  watcherActor: string,
  error: string
) {
  return `${getLoggingPrefix('warn')} Firefox runtime reinjection could not watch targets on ${colors.gray(watcherActor)}: ${colors.red(error)}`
}

export interface DevManifestInfo {
  name?: string
  version?: string
  hostPermissions?: string[]
  permissions?: string[]
}

export interface DevClientManagementInfo {
  name?: string
  version?: string
}

export interface DevClientMessage {
  data?: {id?: string; management?: DevClientManagementInfo}
}

export function runningInDevelopment(
  manifest: DevManifestInfo,
  browser: BrowserType,
  message: DevClientMessage,
  browserVersionLine?: string,
  updateSuffix?: string,
  opts?: {includeExtensionId?: boolean; runLabel?: string}
) {
  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
  const manifestName = manifest.name || 'Extension.js'
  const {hostPermissions, permissions} = manifest
  let browserDevToolsUrl: string

  switch (browser) {
    case 'chrome':
      browserDevToolsUrl = 'chrome://extensions'
      break
    case 'edge':
      browserDevToolsUrl = 'edge://extensions'
      break
    case 'firefox':
      browserDevToolsUrl = 'about:debugging#/runtime/this-firefox'
      break
    default:
      browserDevToolsUrl = ''
  }

  if (!message.data) {
    return (
      `${getLoggingPrefix('error')} No Client Data Received for ${manifestName}\n\n` +
      `${colors.red("This error happens when the program can't get the data from your extension.")}\n` +
      `${colors.red('There are many reasons this might happen. To fix, ensure that:')}\n\n` +
      `- Your extension is set as enabled in ${colors.underline(browserDevToolsUrl)}\n` +
      `- No previous ${capitalize(browser)} browser instance is open\n\n` +
      `If that is not the case, restart both the ${colors.yellow(manifest.name || '')} and the\n` +
      `${colors.yellow('Manager Extension')} in ${colors.underline(browserDevToolsUrl)} and try again.\n` +
      `If the issue still persists, please report a bug:\n` +
      colors.underline(`https://github.com/extension-js/extension.js/issues`)
    )
  }

  const {id = '', management} = message.data as {
    id?: string
    management?: {name?: string; version?: string}
  }

  if (!management) {
    if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
      return (
        `${getLoggingPrefix('error')} No management API info received from the client for ${manifestName}.\n` +
        `The extension may not have finished loading, or the in-browser companion did not attach.`
      )
    }
  }

  const {version = ''} = management as {
    name?: string
    version?: string
  }
  // Note: keep dynamic import here to avoid ESM JSON import issues at compile time in some bundlers
  const extensionVersion =
    process.env.EXTENSION_DEVELOP_VERSION ||
    process.env.EXTENSION_CLI_VERSION ||
    (() => {
      try {
        return require('../../../package.json').version
      } catch {
        return 'unknown'
      }
    })()

  let effectiveBrowserLine =
    browserVersionLine && browserVersionLine.trim().length > 0
      ? browserVersionLine.trim()
      : ''

  if (!effectiveBrowserLine) {
    try {
      if (browser === 'chromium' || browser === 'chromium-based') {
        const p = locateChromium()
        if (p && typeof p === 'string' && fs.existsSync(p)) {
          effectiveBrowserLine = getChromiumVersion(p) || 'Chromium'
        }
      } else if (browser === 'chrome') {
        const p: string = locateChromeOrExplain({allowFallback: true})
        if (p && fs.existsSync(p)) {
          effectiveBrowserLine = getChromeVersion(p) || 'Chrome'
        }
      } else if (browser === 'edge') {
        const p = locateEdge()
        if (p && fs.existsSync(p)) {
          effectiveBrowserLine = getEdgeVersion(p) || 'Microsoft Edge'
        }
      } else if (browser === 'firefox') {
        const p = locateFirefox(true)
        if (p && typeof p === 'string' && fs.existsSync(p)) {
          effectiveBrowserLine = getFirefoxVersion(p) || 'Firefox'
        }
      }
    } catch {
      // best-effort only; fall back to generic browser label below
    }
  }

  let browserLabel =
    effectiveBrowserLine && effectiveBrowserLine.trim().length > 0
      ? effectiveBrowserLine.trim()
      : capitalize(String(browser || 'unknown'))

  if (browserLabel && !/[a-zA-Z]/.test(browserLabel)) {
    browserLabel = `${capitalize(String(browser || 'unknown'))} ${browserLabel}`
  }

  const cleanId = String(id || '').trim()

  const lines: string[] = []
  const includeExtensionId = opts?.includeExtensionId !== false

  const updateNotice = updateSuffix ? ` ${updateSuffix}` : ''

  const displayName = String(manifestName)
  const displayVersion = String(version || manifest.version || '')

  lines.push(
    ` 🧩 ${colors.brightBlue('Extension.js')} ${colors.gray(
      `${extensionVersion}`
    )}${updateNotice}`,
    `    Browser        ${colors.gray(browserLabel)}`,
    `    Extension      ${colors.gray(
      displayVersion ? `${displayName} ${displayVersion}` : displayName
    )}`
  )

  if (includeExtensionId && cleanId) {
    lines.push(`    Extension ID   ${colors.gray(cleanId)}`)
  }

  if (opts?.runLabel) {
    lines.push(`    Run ID         ${colors.gray(opts.runLabel)}`)
  }

  return lines.join('\n')
}

export function emptyLine() {
  // Turbo-prefixed logs can collapse truly empty lines; keep one space.
  return ' '
}

export function separatorLine() {
  return ''.padEnd(80, '=')
}

export function devChromiumDebugPort(finalPort: number, requestedPort: number) {
  return `${getLoggingPrefix('info')} Chromium debug port: ${colors.gray(finalPort.toString())} (requested ${colors.gray(requestedPort.toString())})`
}

export function devFirefoxDebugPort(finalPort: number, requestedPort: number) {
  return `${getLoggingPrefix('info')} Firefox debug port: ${colors.gray(finalPort.toString())} (requested ${colors.gray(requestedPort.toString())})`
}

export function devFirefoxProfilePath(profilePath: string) {
  return `${getLoggingPrefix('info')} Firefox profile: ${colors.underline(profilePath)}`
}

export function cdpUnifiedExtensionLog(ts: string, payload: unknown) {
  const data = (() => {
    try {
      return JSON.stringify(payload)
    } catch {
      return String(payload)
    }
  })()
  return `[extension-log ${ts}] ${data}`
}

export function firefoxInspectSourceNonFatal(message: string) {
  return `${getLoggingPrefix('warn')} Firefox Inspect non-fatal error: ${colors.yellow(message)}`
}

export function browserRunnerError(body: string) {
  return `${colors.red('ERROR')} ${colors.brightBlue('error in browser runner')}\n${body}`
}

export function requireChromiumBinaryForChromiumBased() {
  const body =
    `Configuration required\n` +
    `Provide ${colors.blue('--chromium-binary')} ${colors.gray('<abs-path>')} when using ${colors.yellow('chromium-based')}.\n`
  return browserRunnerError(body)
}

export function requireGeckoBinaryForGeckoBased() {
  const body =
    `Configuration required\n` +
    `Provide ${colors.blue('--gecko-binary')} ${colors.gray('<abs-path>')} when using ${colors.yellow('gecko-based')} or ${colors.yellow('firefox-based')}.\n`
  return browserRunnerError(body)
}

export function invalidChromiumBinaryPath(p: string) {
  const body =
    `Invalid binary path\n` +
    `Chromium binary not found at ${colors.underline(p)}.\n` +
    `Provide a working path via ${colors.blue('--chromium-binary')} ${colors.gray('<abs-path>')}.`
  return browserRunnerError(body)
}

export function invalidGeckoBinaryPath(p: string) {
  const body =
    `Invalid binary path\n` +
    `Firefox/Gecko binary not found at ${colors.underline(p)}.\n` +
    `Provide a working path via ${colors.blue('--gecko-binary')} ${colors.gray('<abs-path>')}.`
  return browserRunnerError(body)
}

export function rdpInvalidRequestPayload() {
  return (
    `${getLoggingPrefix('error')} Received an unreadable Firefox remote debugging message.\n` +
    `The debugging connection is out of sync with the browser, usually after a crash or an abrupt reload.\n` +
    `Restart the dev session. If it repeats, report it with your Firefox version.`
  )
}

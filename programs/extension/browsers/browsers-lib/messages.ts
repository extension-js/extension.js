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
import {
  browserRowValue,
  type Channel,
  card,
  isDebug,
  prefix
} from '../../helpers/messaging'
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

function getLoggingPrefix(type: Channel): string {
  return prefix(type)
}

function errorDetail(error: unknown) {
  if (isDebug()) return String(error)
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

// Reads the version off the binary the command will actually launch, so the
// card names it even when the caller pinned no binary of its own.
export function resolveBrowserVersionLine(
  browser: string,
  pinnedLine?: string,
  opts?: {pinned?: boolean}
): string {
  const pinned = String(pinnedLine || '').trim()
  if (pinned) return pinned

  // A pinned binary that answers no parseable version stays unnamed:
  // locating a browser here would print ANOTHER binary's version.
  if (opts?.pinned) return ''

  try {
    if (browser === 'chromium' || browser === 'chromium-based') {
      const p = locateChromium()
      if (p && typeof p === 'string' && fs.existsSync(p)) {
        return getChromiumVersion(p) || 'Chromium'
      }
    } else if (browser === 'chrome') {
      const p: string = locateChromeOrExplain({allowFallback: true})
      if (p && fs.existsSync(p)) {
        return getChromeVersion(p) || 'Chrome'
      }
    } else if (browser === 'edge') {
      const p = locateEdge()
      if (p && fs.existsSync(p)) {
        return getEdgeVersion(p) || 'Microsoft Edge'
      }
    } else if (browser === 'firefox') {
      const p = locateFirefox(true)
      if (p && typeof p === 'string' && fs.existsSync(p)) {
        return getFirefoxVersion(p) || 'Firefox'
      }
    }
  } catch {
    // Ignore
  }
  return ''
}

export function creatingUserProfile(profilePath: string) {
  return `${getLoggingPrefix('debug')} browser  profile=fresh path=${profilePath}`
}

export function browserInstanceExited(browser: Browser) {
  return `${getLoggingPrefix('info')} ${capitalizedBrowserName(browser)} instance exited.`
}

export function cdpClientAttachedToTarget(
  sessionId: string,
  targetType: string
) {
  return `${getLoggingPrefix('debug')} cdp      attached type=${targetType} session=${sessionId}`
}

export function bestEffortBannerPrintFailed(message: string) {
  return `${getLoggingPrefix('debug')} browser  banner=failed reason="${message}"`
}

export function firefoxRdpRuntimeCapabilitySummary(
  state: 'available' | 'unavailable'
) {
  const reload = state === 'available' ? 'preserve-state' : 'reinstall'
  return `${getLoggingPrefix('debug')} rdp      capability scripting=${state} reload=${reload}`
}

export function skippingBrowserLaunchDueToCompileErrors() {
  return `${getLoggingPrefix('warn')} Skipping the browser launch, the build has compile errors.`
}

export function browserNotInstalledError(
  browser: Browser,
  browserBinaryLocation: string
) {
  const isUnreachable =
    browserBinaryLocation === 'null'
      ? `${capitalizedBrowserName(browser)} isn't installed.\n`
      : `Can't find the ${capitalizedBrowserName(browser)} binary.\n`

  const wslHint = (() => {
    if (!isWsl()) return ''
    // WSL commonly has no Linux browser installed, but can launch Windows .exe paths.
    // Also note: shell aliases do not apply to child_process.spawn.
    const example = '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
    return (
      `\n\nWSL detected:\n` +
      `- Install a Linux browser in WSL, or\n` +
      `- Provide a Windows binary path via ${colors.blue('--chromium-binary')} ${colors.gray(`"${example}"`)}\n` +
      `  (Tip: a shell alias like ${colors.gray('google-chrome=...')} won't be used by Extension.js, use a real path or wrapper script.)`
    )
  })()

  return (
    `${getLoggingPrefix('error')} ${isUnreachable}` +
    `${colors.gray('NOT FOUND')} ${colors.underline(browserBinaryLocation || `${capitalizedBrowserName(browser)}BROWSER`)}\n` +
    `Install the missing browser, or choose another one with ` +
    `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}.` +
    wslHint
  )
}

// The card's Browser row already names what runs and why, so this warn keeps
// only the cause and the remedy.
export function usingManagedChromiumFamilyFallback(
  requestedBrowser: Browser,
  _fallbackBrowser: Browser,
  _binaryPath: string
) {
  return (
    `${getLoggingPrefix('warn')} ${managedBrowserDisplayName(requestedBrowser)} isn't installed.\n` +
    `Run ${colors.blue(`npx extension install ${requestedBrowser}`)} to use ` +
    `${managedBrowserDisplayName(requestedBrowser)} itself.`
  )
}

// The card's Browser and Binary rows already name the chosen binary, so this
// warn keeps only the remedy for choosing the snapshot instead.
export function preferringSystemBrowserOverSnapshot(
  _systemBinary: string,
  _snapshotBinary: string
) {
  return `${getLoggingPrefix('warn')} Set ${colors.blue('EXTENSION_PREFER_CHROMIUM_SNAPSHOT=true')} to use the cached Chromium snapshot instead.`
}

export function mv2NotSupportedByChromium(extensionPath: string) {
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow('This extension declares Manifest V2, which modern Chromium refuses to load.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    `The browser will reject it at launch (a native dialog, not a console error), so the dev session can't attach.\n` +
    `Run it on an MV2-capable browser (${colors.blue('--browser firefox')}) or migrate the manifest to MV3.`
  )
}

export function mv3BackgroundScriptsNotSupportedByChromium(
  extensionPath: string
) {
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow('This MV3 extension declares Firefox-style background.scripts with no service_worker, Chromium refuses to load it.')}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    `The browser rejects it at launch with no console error, so the dev session can't attach.\n` +
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
    `The browser rejects it at launch (a native dialog, not a console error), so the dev session can't attach.\n` +
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
    `${getLoggingPrefix('warn')} ${colors.brightYellow("This extension declares match patterns Chrome refuses, the whole extension won't load.")}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    shown
      .map((pattern) => `${colors.gray('PATTERN')} ${colors.red(pattern)}\n`)
      .join('') +
    (more > 0 ? `${colors.gray(`…and ${more} more`)}\n` : '') +
    `A match pattern's host wildcard must be ${colors.blue('*')} or ${colors.blue('*.domain.tld')}, ` +
    `Chrome refuses a wildcard anywhere else in the host.\n` +
    `Replace the host with ${colors.blue('*')} or ${colors.blue('*.domain.tld')} in the source manifest.`
  )
}

export function chromiumManifestLoadBlockers(
  extensionPath: string,
  blockers: string[]
) {
  return (
    `${getLoggingPrefix('warn')} ${colors.brightYellow("This manifest declares shapes Chrome refuses, the whole extension won't load.")}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    blockers
      .map((blocker) => `${colors.gray('REASON')} ${colors.red(blocker)}\n`)
      .join('') +
    `Chrome rejects the extension at load, so no service worker or content script ever runs.\n` +
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
    `${getLoggingPrefix('error')} ${colors.red("The browser refused to load this extension, so it isn't running.")}\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    (reason ? `${colors.gray('REASON')} ${colors.red(reason)}\n` : '') +
    `No service worker, content script, or page from this extension will run, and no Extension ID was assigned.\n` +
    `Fix the reason above and save.\n` +
    `If the browser doesn't pick it up, restart the dev session.`
  )
}

// Chrome 150 drops --load-extension unless the switch policy is disabled, and
// a dropped switch looks exactly like a healthy launch. Say so rather than
// claiming a session the browser may be running without the extension.
export function chromiumExtensionLoadUnconfirmed(extensionPath: string) {
  return (
    `${getLoggingPrefix('warn')} Extension.js couldn't confirm that the browser loaded this extension.\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionPath)}\n` +
    `This browser rejected the debugging call that loads and verifies it, so the extension may be missing.\n` +
    `Chrome ignores the --load-extension switch unless the DisableLoadExtensionCommandLineSwitch policy is disabled.\n` +
    `Open chrome://extensions to check whether the extension is there, and report this if it isn't.`
  )
}

// The Gecko twin of chromiumExtensionLoadRefused. Firefox volunteers its
// reason at install time, so the shape is the same and only the nouns differ.
export function geckoAddonLoadRefused(addonPath: string, reason: string) {
  return (
    `${getLoggingPrefix('error')} ${colors.red("The browser refused to load this add-on, so it isn't running.")}\n` +
    `${colors.gray('PATH')} ${colors.underline(addonPath)}\n` +
    (reason ? `${colors.gray('REASON')} ${colors.red(reason)}\n` : '') +
    `No background script, content script, or page from this add-on will run, and no Extension ID was assigned.\n` +
    `Fix the reason above and save.\n` +
    `If the browser doesn't pick it up, restart the dev session.`
  )
}

// The card's Browser row already carries the cached-snapshot provenance, so
// this warn keeps only the consequence and the remedy.
export function devChannelSnapshotInUse(_binaryPath: string) {
  return (
    `${getLoggingPrefix('warn')} Chromium snapshot behavior may differ from stable Chrome.\n` +
    `Install a stable browser or remove the snapshot to stop using it.`
  )
}

export function browserLaunchError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Can't launch ${capitalizedBrowserName(browser)}.\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementCleanup(browser: Browser) {
  return `${getLoggingPrefix('debug')} proc     cleanup browser=${browser}`
}

export function enhancedProcessManagementTerminating(browser: Browser) {
  return `${getLoggingPrefix('debug')} proc     terminate browser=${browser} mode=graceful`
}

export function enhancedProcessManagementForceKill(browser: Browser) {
  return (
    `${getLoggingPrefix('warn')} ${capitalizedBrowserName(browser)} didn't exit gracefully, forcing the process to close.\n` +
    `This is a normal cleanup step and doesn't affect your build output.`
  )
}

export function enhancedProcessManagementCleanupError(
  browser: Browser,
  error: unknown
) {
  return (
    `${getLoggingPrefix('error')} ${capitalizedBrowserName(browser)} cleanup failed.\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementUncaughtException(
  browser: Browser,
  error: unknown
) {
  return (
    `${getLoggingPrefix('error')} Uncaught exception in the ${capitalizedBrowserName(browser)} process.\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementUnhandledRejection(
  browser: Browser,
  reason: unknown
) {
  return (
    `${getLoggingPrefix('error')} Unhandled rejection in the ${capitalizedBrowserName(browser)} process.\n` +
    `${colors.red(errorDetail(reason))}`
  )
}

export function generalBrowserError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} ${capitalizedBrowserName(browser)} hit an unexpected error.\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function errorConnectingToBrowser(browser: Browser, port?: number) {
  const where = typeof port === 'number' ? ` on port ${port}` : ''
  return (
    `${getLoggingPrefix('error')} Can't connect to ${capitalizedBrowserName(browser)}${where} after several retries.\n` +
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
  return `${getLoggingPrefix('debug')} browser  debugger=wait target=${browser} port=${port} attempt=${attempt}/${maxRetries}`
}

export function addonInstallError(browser: Browser, message: string) {
  return (
    `${getLoggingPrefix('error')} Can't install the add-on into ${capitalizedBrowserName(browser)}.\n` +
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
    `Reload and HMR need that connection, so the dev session can't keep the extension up to date.\n` +
    `Restart the dev session.\n` +
    `If it keeps happening, launch with ${colors.blue('--profile')} ${colors.gray('<path>')} to rule out a corrupted browser profile.`
  )
}

export function targetActorHasActiveRequestError(
  browser: Browser,
  targetActor: string
) {
  return `${getLoggingPrefix('error')} Target actor ${colors.gray(targetActor)} has an active request for ${capitalizedBrowserName(browser)}.`
}

export function parsingPacketError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Can't parse a message from ${capitalizedBrowserName(browser)}.\n` +
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
    `${getLoggingPrefix('error')} Received a message without a sender from ${capitalizedBrowserName(browser)}.\n` +
    `${colors.red(JSON.stringify(message))}`
  )
}

export function chromeProcessExited(code: number) {
  return `${getLoggingPrefix('debug')} proc     exit browser=chrome code=${code}`
}

export function chromeProcessError(error: unknown) {
  return `${getLoggingPrefix('error')} The Chrome process reported an error.\n${colors.red(errorDetail(error))}`
}

export function chromeFailedToSpawn(error: unknown) {
  return `${getLoggingPrefix('error')} Can't start the Chrome process.\n${colors.red(errorDetail(error))}`
}

export function chromeInitializingEnhancedReload() {
  return `${getLoggingPrefix('debug')} proc     enhancedReload=init spawn=direct browser=chrome`
}

export function locatingBrowser(browser: Browser) {
  return `${getLoggingPrefix('debug')} browser  locate browser=${browser}`
}

export function devChromeProfilePath(path: string) {
  return `${getLoggingPrefix('debug')} browser  profile=chrome path=${path}`
}

export function chromiumDryRunNotLaunching() {
  return `${getLoggingPrefix('info')} Dry run: skipping the browser launch.`
}

export function chromiumDryRunBinary(path: string) {
  return `${getLoggingPrefix('info')} ${colors.gray('PATH')} ${colors.underline(path)}`
}

export function chromiumDryRunFlags(flags: string) {
  return `${getLoggingPrefix('info')} ${colors.gray('FLAGS')} ${colors.gray(flags)}`
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

  body.push(
    `${getLoggingPrefix('warn')} ${browserDisplay} isn't available in the managed browser cache.`
  )
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
    body.push(`${dim('PATH')} ${colors.underline(finalCachePath)}`)
  }
  body.push(`Run your command again after the install finishes.`)
  return `${body.join('\n')}\n`
}

export function firefoxLaunchCalled() {
  return `${getLoggingPrefix('debug')} browser  launch browser=firefox`
}

export function firefoxBinaryArgsExtracted(args: string) {
  return `${getLoggingPrefix('debug')} browser  args="${args}"`
}

export function firefoxNoBinaryArgsFound() {
  return `${getLoggingPrefix('debug')} browser  args=none`
}

export function firefoxFailedToStart(error: unknown) {
  return `${getLoggingPrefix('error')} Firefox failed to start.\n${colors.red(errorDetail(error))}`
}

export function firefoxDryRunNotLaunching() {
  return `${getLoggingPrefix('info')} Dry run: skipping the browser launch.`
}

export function firefoxDryRunBinary(path: string) {
  return `${getLoggingPrefix('info')} ${colors.gray('PATH')} ${colors.underline(path)}`
}

export function firefoxDryRunConfig(cfg: string) {
  return `${getLoggingPrefix('info')} ${colors.gray('CONFIG')} ${colors.gray(cfg)}`
}

export function safariBuildCalled() {
  return `${getLoggingPrefix('debug')} browser  build browser=safari`
}

function prettyPlatform(platform: string) {
  if (platform === 'win32') return 'Windows'
  if (platform === 'linux') return 'Linux'
  return platform
}

export function safariRequiresMacOS(platform: string) {
  return (
    `${getLoggingPrefix('warn')} Safari extensions can only be built on macOS.\n` +
    `Detected ${colors.gray(prettyPlatform(platform))}.\n` +
    `Target another browser via ${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}, ` +
    `or run this command on a Mac with Xcode.`
  )
}

export function safariPackagingSkippedNonMac(platform: string) {
  return (
    `${getLoggingPrefix('warn')} Safari packaging needs macOS with Xcode, detected ` +
    `${colors.gray(prettyPlatform(platform))}, so the Xcode packaging step is skipped.\n` +
    `The web-extension build in ${colors.underline('dist/safari')} is still complete and can be ` +
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
    `Prefer to keep building now?\n` +
    `Target another browser via ${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}.`
  )
}

export function safariToolchainMissing(tool: string) {
  return (
    `${getLoggingPrefix('error')} Can't find the Safari packaging tool.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(tool)}\n` +
    `Your Xcode install looks incomplete.\n` +
    `Run ${colors.blue('xcodebuild -runFirstLaunch')}, or reinstall Xcode from the Mac App Store.`
  )
}

export function safariConverting(extensionDir: string) {
  return (
    `${getLoggingPrefix('info')} Converting the web extension into a Safari app project…\n` +
    `${colors.gray('PATH')} ${colors.underline(extensionDir)}`
  )
}

export function safariConverted(projectDir: string) {
  return (
    `${getLoggingPrefix('success')} Generated the Safari Xcode project.\n` +
    `${colors.gray('PATH')} ${colors.underline(projectDir)}`
  )
}

export function safariBuilding(scheme: string) {
  return `${getLoggingPrefix('info')} Building the Safari app with xcodebuild (scheme ${colors.gray(scheme)})…`
}

export function safariBuilt(appPath: string) {
  return (
    `${getLoggingPrefix('success')} Built the Safari app.\n` +
    `${colors.gray('PATH')} ${colors.underline(appPath)}`
  )
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
    `${colors.yellow(String(warnings.length))} ${warnings.length === 1 ? 'warning' : 'warnings'}, some manifest keys/APIs ` +
    `may not be supported by Safari:\n` +
    warnings.map((line) => `  ${colors.gray('•')} ${line}`).join('\n')
  )
}

export function safariDefaultBundleIdNote(bundleId: string) {
  return (
    `${getLoggingPrefix('warn')} The bundle id ${colors.gray(bundleId)} is generated from the app name.\n` +
    `Every project built from the same source shares this id, and the first team to register it takes it.\n` +
    `Set your own with ${colors.blue('--bundle-id')} before your first submission.\n` +
    `After a submission, a new id is a new extension with none of your users.`
  )
}

export function safariOpenHint(appPath: string, appName: string) {
  return (
    `${getLoggingPrefix('info')} Launch it once to register with Safari: ` +
    `${colors.blue('open')} ${colors.underline(`"${appPath}"`)}\n` +
    `Then enable ${colors.yellow(appName)} via Safari ▸ Develop ▸ ` +
    `${colors.yellow('Allow Unsigned Extensions')} and Safari ▸ Settings ▸ Extensions.`
  )
}

export function safariDryRunNotBuilding() {
  return `${getLoggingPrefix('info')} Dry run: skip the Safari app build.`
}

export function safariDryRunConverter(cmd: string) {
  return `${getLoggingPrefix('info')} Converter: ${colors.gray(cmd)}.`
}

export function safariDryRunXcodebuild(cmd: string) {
  return `${getLoggingPrefix('info')} xcodebuild: ${colors.gray(cmd)}.`
}

export function safariNextSteps(appName: string) {
  return (
    `${getLoggingPrefix('info')} One-time setup to load ${colors.yellow(appName)} in Safari:\n` +
    `  ${colors.gray('1.')} Safari ▸ Settings ▸ Advanced ▸ check ${colors.yellow('“Show features for web developers”')}\n` +
    `  ${colors.gray('2.')} Safari ▸ Develop ▸ ${colors.yellow('Allow Unsigned Extensions')} ${colors.gray('(resets each launch)')}\n` +
    `  ${colors.gray('3.')} Safari ▸ Settings ▸ Extensions ▸ turn on ${colors.yellow(appName)}\n` +
    `  ${colors.gray('→')} The app window that just opened can also take you there.`
  )
}

export function safariRegistered(appName: string) {
  return `${getLoggingPrefix('success')} Safari recognizes ${colors.yellow(appName)}, finish enabling it with the steps above.`
}

export function safariNotYetRegistered(appName: string) {
  return (
    `${getLoggingPrefix('info')} Safari hasn't picked up ${colors.yellow(appName)} yet.\n` +
    `Open the app once, then check Safari ▸ Settings ▸ Extensions.`
  )
}

export function safariRebuilt(appName: string) {
  return `${getLoggingPrefix('success')} Rebuilt ${colors.yellow(appName)}, reload the page (or toggle the extension) in Safari to see changes.`
}

export function safariProjectStale() {
  return `${getLoggingPrefix('info')} Regenerating the Xcode project, manifest.json or identity options changed since it was generated.`
}

export function safariForcedRegeneration() {
  return `${getLoggingPrefix('info')} Regenerating the Xcode project, ${colors.blue('--force-regenerate')} is set.`
}

export function safariRegenerationDiscards(preservedKeys: string[]) {
  return (
    `${getLoggingPrefix('warn')} Regenerating replaces the Xcode project: customizations ` +
    `made in Xcode (entitlements, capabilities, added files/targets) are ${colors.red('discarded')}.\n` +
    `Preserved automatically: ${colors.yellow(preservedKeys.join(', '))}.\n` +
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
  return `${getLoggingPrefix('info')} Skipping the conversion, the Xcode project is up to date with manifest.json.`
}

export function cdpClientFoundTargets(count: number) {
  return `${getLoggingPrefix('debug')} cdp      targets=${count}`
}

export function cdpClientTargetWebSocketUrlStored() {
  return `${getLoggingPrefix('debug')} cdp      targetWsUrl=stored`
}

export function cdpClientConnected(host: string, port: number) {
  return `${getLoggingPrefix('debug')} cdp      connected host=${host} port=${port}`
}

export function cdpClientConnectionError(error: string) {
  return `${getLoggingPrefix('error')} The Chrome debugging connection failed.\n${colors.red(error)}`
}

export function cdpClientBrowserConnectionEstablished() {
  return `${getLoggingPrefix('debug')} cdp      browserConnection=established`
}

export function cdpClientConnectionClosed() {
  return `${getLoggingPrefix('debug')} cdp      connection=closed`
}

export function cdpClientLoadEventTimeout() {
  return `${getLoggingPrefix('debug')} cdp      loadEvent=timeout proceed=true`
}

export function cdpClientExtensionUnloadFailed(
  extensionId: string,
  error: string
) {
  return `${getLoggingPrefix('error')} Chrome couldn't unload extension ${colors.gray(extensionId)}.\n${colors.red(error)}`
}

export function cdpClientExtensionInfoFailed(
  extensionId: string,
  error: string
) {
  return `${getLoggingPrefix('error')} Chrome couldn't read extension info for ${colors.gray(extensionId)}.\n${colors.red(error)}`
}

export function cdpClientExtensionLoadFailed(path: string, error: string) {
  return (
    `${getLoggingPrefix('error')} Chrome couldn't load the extension.\n` +
    `${colors.gray('PATH')} ${colors.underline(path)}\n` +
    `${colors.red(error)}`
  )
}

export function firefoxRdpClientConnected(host: string, port: number) {
  return `${getLoggingPrefix('debug')} rdp      connected host=${host} port=${port}`
}

export function firefoxRdpClientTestingEvaluation() {
  return `${getLoggingPrefix('debug')} rdp      evaluation=test`
}

export function firefoxRdpClientFailedToGetMainHTML() {
  return (
    `${getLoggingPrefix('error')} Couldn't read the page document over the Firefox remote debugging protocol.\n` +
    `The tab usually navigated or closed before the request finished.\n` +
    `Reload the page and try again.\n` +
    `If it persists, restart the dev session.`
  )
}

export function firefoxRdpReinjectListAddonsFailed(error: string) {
  return `${getLoggingPrefix('debug')} rdp      reinject listAddons=failed error="${error}"`
}

export function firefoxRdpReinjectNoDescriptor(
  addonId: string,
  addons: string
) {
  return `${getLoggingPrefix('debug')} rdp      reinject descriptor=none addon=${addonId} addons=${addons}`
}

export function firefoxRdpReinjectWatcherUnavailable(
  descriptorActor: string,
  detail: string
) {
  return `${getLoggingPrefix('debug')} rdp      reinject watcher=unavailable actor=${descriptorActor} detail="${detail}"`
}

export function firefoxRdpReinjectWatchTargetsFailed(
  watcherActor: string,
  error: string
) {
  return `${getLoggingPrefix('debug')} rdp      reinject watchTargets=failed actor=${watcherActor} error="${error}"`
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

// Card values collapse the home dir for scanability. Evidence and debug lines
// never do, so a pasted path stays valid.
export function collapseHomeDirInCardValue(value: string): string {
  const raw = String(value || '')
  const home = os.homedir()
  if (!home || !raw.startsWith(home)) return raw
  const rest = raw.slice(home.length)
  if (rest === '') return '~'
  if (rest.startsWith(path.sep) || rest.startsWith('/')) return `~${rest}`
  return raw
}

// The card names every non-default binary this session runs, so a silently
// selected snapshot or system fallback is never invisible in dev output.
export function binaryProvenanceNote(
  provenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
): string {
  if (provenance === 'pinned') return '(pinned with --chromium-binary)'
  if (provenance === 'system') return '(system, not the managed default)'
  if (provenance === 'snapshot') return '(cached snapshot)'
  return ''
}

export function runningInDevelopment(
  manifest: DevManifestInfo,
  browser: BrowserType,
  message: DevClientMessage,
  browserVersionLine?: string,
  updateSuffix?: string,
  opts?: {
    includeExtensionId?: boolean
    runLabel?: string
    profilePath?: string
    binaryPath?: string
    binaryProvenance?: 'managed' | 'pinned' | 'system' | 'snapshot'
  }
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
      `${getLoggingPrefix('error')} No client data received for ${manifestName}.\n\n` +
      `${colors.red("Extension.js can't read data from your extension.")}\n` +
      `${colors.red('To fix, ensure that:')}\n\n` +
      `- Your extension is enabled in ${colors.underline(browserDevToolsUrl)}\n` +
      `- No previous ${capitalize(browser)} browser instance is open\n\n` +
      `If both hold, restart the ${colors.yellow(manifest.name || '')} and the\n` +
      `${colors.yellow('Manager Extension')} in ${colors.underline(browserDevToolsUrl)} and try again.\n` +
      `If the issue persists, report a bug:\n` +
      colors.underline(`https://github.com/extension-js/extension.js/issues`)
    )
  }

  const {id = '', management} = message.data as {
    id?: string
    management?: {name?: string; version?: string}
  }

  if (!management) {
    if (isDebug()) {
      return (
        `${getLoggingPrefix('error')} No management API info received from the client for ${manifestName}.\n` +
        `The extension may not have finished loading, or the in-browser companion didn't attach.`
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

  const baseBrowserLabel = browserRowValue(
    String(browser || 'unknown'),
    resolveBrowserVersionLine(browser, browserVersionLine, {
      pinned: opts?.binaryProvenance === 'pinned'
    })
  )
  const provenanceNote = binaryProvenanceNote(opts?.binaryProvenance)
  const browserLabel = provenanceNote
    ? `${baseBrowserLabel} ${provenanceNote}`
    : baseBrowserLabel

  // A Binary row only when the user pinned a path with --chromium-binary.
  // Under the three-row cap a Binary row costs the Profile row, and for a
  // system or snapshot browser that is a bad trade: the Browser row's own
  // note already says the binary is not the managed default, so the path
  // repeats what the line above it said and evicts the one value nothing
  // else on screen carries. Edge is the case that proves it: on macOS there
  // is no managed Edge to install, so an Edge run is ALWAYS 'system', and
  // keeping Binary there made the same command render different rows than a
  // Chromium run for reasons the reader cannot see. A pinned path is
  // different: the user typed it and the card is the receipt. The exact path
  // stays in ready.json (binary/profilePath) either way.
  const binaryRowValue =
    opts?.binaryProvenance === 'pinned'
      ? collapseHomeDirInCardValue(String(opts?.binaryPath || '').trim())
      : ''

  const cleanId = String(id || '').trim()

  const lines: string[] = []
  const includeExtensionId = opts?.includeExtensionId !== false

  const updateNotice = updateSuffix ? ` ${updateSuffix}` : ''

  const displayName = String(manifestName)
  const displayVersion = String(version || manifest.version || '')

  return card({
    version: extensionVersion,
    suffix: updateNotice.trim(),
    rows: [
      {label: 'Browser', value: browserLabel},
      {label: 'Binary', value: binaryRowValue},
      {
        label: 'Extension',
        value: displayVersion ? `${displayName} ${displayVersion}` : displayName
      },
      // Priority order, because MAX_CARD_ROWS keeps the first three that have
      // a value. Profile outranks Extension ID deliberately: the browser this
      // command just opened shows the id on chrome://extensions, while nothing
      // in the browser tells you which profile directory the session is using.
      // Both stay in ready.json (profilePath, extensionId) for machines, and
      // the id still appears here whenever a run has no profile to report.
      {
        label: 'Profile',
        value: collapseHomeDirInCardValue(
          String(opts?.profilePath || '').trim()
        )
      },
      // Run ID before Extension ID: a run label is only ever populated when a
      // caller explicitly asked for it (printProdBannerOnce's includeRunId),
      // so it is a request, while the extension id is derivable from the dist
      // path and visible on chrome://extensions. Both are in ready.json.
      {label: 'Run ID', value: opts?.runLabel || ''},
      {
        label: 'Extension ID',
        value: includeExtensionId ? cleanId : ''
      }
    ]
  })
}

export function emptyLine() {
  // Turbo-prefixed logs can collapse truly empty lines; keep one space.
  return ' '
}

export function separatorLine() {
  return ''.padEnd(80, '=')
}

export function devChromiumDebugPort(finalPort: number, requestedPort: number) {
  return `${getLoggingPrefix('debug')} browser  cdpPort=${finalPort} requested=${requestedPort}`
}

export function devFirefoxDebugPort(finalPort: number, requestedPort: number) {
  return `${getLoggingPrefix('debug')} browser  rdpPort=${finalPort} requested=${requestedPort}`
}

export function devFirefoxProfilePath(profilePath: string) {
  return `${getLoggingPrefix('debug')} browser  profile=firefox path=${profilePath}`
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
  return `${getLoggingPrefix('warn')} Firefox inspect hit a non-fatal error.\n${colors.yellow(message)}`
}

export function browserRunnerError(body: string) {
  return `${getLoggingPrefix('error')} ${body}`
}

export function requireChromiumBinaryForChromiumBased() {
  const body =
    `The ${colors.yellow('chromium-based')} target needs a Chromium binary.\n` +
    `Pass ${colors.blue('--chromium-binary')} ${colors.gray('<abs-path>')} to choose one.\n`
  return browserRunnerError(body)
}

export function requireGeckoBinaryForGeckoBased() {
  const body =
    `The ${colors.yellow('gecko-based')} and ${colors.yellow('firefox-based')} targets need a Firefox or Gecko binary.\n` +
    `Pass ${colors.blue('--gecko-binary')} ${colors.gray('<abs-path>')} to choose one.\n`
  return browserRunnerError(body)
}

export function invalidChromiumBinaryPath(p: string) {
  const body =
    `Can't find a Chromium binary at the given path.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(p)}\n` +
    `Pass ${colors.blue('--chromium-binary')} ${colors.gray('<abs-path>')} with a working path.`
  return browserRunnerError(body)
}

export function invalidGeckoBinaryPath(p: string) {
  const body =
    `Can't find a Firefox or Gecko binary at the given path.\n` +
    `${colors.gray('NOT FOUND')} ${colors.underline(p)}\n` +
    `Pass ${colors.blue('--gecko-binary')} ${colors.gray('<abs-path>')} with a working path.`
  return browserRunnerError(body)
}

export function rdpInvalidRequestPayload() {
  return (
    `${getLoggingPrefix('error')} Received an unreadable Firefox remote debugging message.\n` +
    `The debugging connection is out of sync with the browser, usually after a crash or an abrupt reload.\n` +
    `Restart the dev session.\n` +
    `If it repeats, report it with your Firefox version.`
  )
}

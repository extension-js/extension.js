// ██████╗ ██╗   ██╗███╗   ██╗       ██████╗██╗  ██╗██████╗  ██████╗ ███╗   ███╗██╗██╗   ██╗███╗   ███╗
// ██╔══██╗██║   ██║████╗  ██║      ██╔════╝██║  ██║██╔══██╗██╔═══██╗████╗ ████║██║██║   ██║████╗ ████║
// ██████╔╝██║   ██║██╔██╗ ██║█████╗██║     ███████║██████╔╝██║   ██║██╔████╔██║██║██║   ██║██╔████╔██║
// ██╔══██╗██║   ██║██║╚██╗██║╚════╝██║     ██╔══██║██╔══██╗██║   ██║██║╚██╔╝██║██║██║   ██║██║╚██╔╝██║
// ██║  ██║╚██████╔╝██║ ╚████║      ╚██████╗██║  ██║██║  ██║╚██████╔╝██║ ╚═╝ ██║██║╚██████╔╝██║ ╚═╝ ██║
// ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝       ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝     ╚═╝╚═╝ ╚═════╝ ╚═╝     ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import type {Readable, Writable} from 'node:stream'
import {
  CODES,
  humanError,
  humanLine,
  humanWarn,
  isCardKeyClaimed,
  isDebug
} from '../../../helpers/messaging'
import {
  printDevBannerOnce,
  printProdBannerOnce
} from '../../browsers-lib/banner'
import {loadsExtensionsOverCdpOnly} from '../../browsers-lib/browser-family'
import {
  companionPathsForCdpLoad,
  isDevtoolsCompanionPath
} from '../../browsers-lib/companion-session'
import * as messages from '../../browsers-lib/messages'
import {manifestDeclaresNewtabOverride} from '../../browsers-lib/newtab-override'
import {
  describeLaunchFailure,
  stampReadyCdpFault,
  stampReadyCdpPort,
  stampReadyExtensionLoadRefused
} from '../../browsers-lib/ready-stamp'
import {
  deriveDebugPortWithInstance,
  launchIsHeadless
} from '../../browsers-lib/shared-utils'
import type {CompilationLike} from '../../browsers-types'
import {
  CDPExtensionController,
  devtoolsCompanionWelcomeUrl
} from '../cdp/cdp-extension-controller'
import {codedError, declaredCode} from '../cdp/coded-error'
import {
  developerModeFlipIsSafe,
  developerModeFromProfile
} from '../cdp/ensure-developer-mode'
import type {ChromiumPluginRuntime} from '../chromium-types'
import {getExtensionOutputPath} from './extension-output-path'

// What the launch flags say about the session: which dist is the guest, which
// port the browser debugs on, and which profile it runs.
function readLaunchTargets(
  compilation: CompilationLike | undefined,
  plugin: ChromiumPluginRuntime,
  chromiumArgs: string[]
) {
  const loadExtensionFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--load-extension=')
  )
  const extensionOutputPath = getExtensionOutputPath(
    compilation,
    loadExtensionFlag
  )
  const extensionPaths = loadExtensionFlag
    ? loadExtensionFlag
        .replace('--load-extension=', '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : []

  const selectedExtensionPaths =
    extensionOutputPath && extensionOutputPath.length > 0
      ? [extensionOutputPath]
      : extensionPaths
  const companionPath = extensionPaths.find(isDevtoolsCompanionPath)

  const remoteDebugPortFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--remote-debugging-port=')
  )

  const chromeRemoteDebugPort = remoteDebugPortFlag
    ? parseInt(remoteDebugPortFlag.split('=')[1], 10)
    : deriveDebugPortWithInstance(
        plugin.port as number | string,
        plugin.instanceId
      )

  const userDataDirFlag = chromiumArgs.find((flag: string) =>
    flag.startsWith('--user-data-dir=')
  )
  const userDataDir = userDataDirFlag
    ? userDataDirFlag.replace('--user-data-dir=', '').replace(/^"|"$/g, '')
    : ''

  return {
    extensionOutputPath,
    extensionPaths,
    selectedExtensionPaths,
    companionPath,
    chromeRemoteDebugPort,
    userDataDir
  }
}

// Report a guest the browser threw away on every surface: stdout, logs and a
// non-ready contract. The session stays up, the browser is still running.
function reportGuestLoadRefused(
  plugin: ChromiumPluginRuntime,
  extensionOutputPath: string,
  refusedPath: string,
  reason: string,
  runOnly = false
) {
  humanError(
    messages.chromiumExtensionLoadRefused(refusedPath, reason, {runOnly})
  )

  plugin.logSink?.({
    level: 'error',
    text: `extension_load_refused: ${refusedPath}${
      reason ? ` - ${reason}` : ''
    }`,
    source: 'browser'
  })

  stampReadyExtensionLoadRefused(
    extensionOutputPath,
    reason,
    plugin.launchRunId
  )

  plugin.extensionLoadRefused = reason
}

// A run-only session gets the one answer a dev session gets before anything
// else: did the browser take the guest. No reload wiring, banners or tabs.
export async function verifyGuestLoadAfterLaunch(
  compilation: CompilationLike | undefined,
  plugin: ChromiumPluginRuntime,
  chromiumArgs: string[],
  pipeStreams?: {input: Readable; output: Writable}
): Promise<void> {
  const {
    extensionOutputPath,
    selectedExtensionPaths,
    companionPath,
    chromeRemoteDebugPort,
    userDataDir
  } = readLaunchTargets(compilation, plugin, chromiumArgs)

  const cdpExtensionController = new CDPExtensionController({
    outPath: extensionOutputPath,
    browser: plugin.browser,
    cdpPort: chromeRemoteDebugPort,
    profilePath: userDataDir || undefined,
    extensionPaths: selectedExtensionPaths,
    companionPath,
    pipeIn: pipeStreams?.input,
    pipeOut: pipeStreams?.output,
    logSink: plugin.logSink
  })

  await cdpExtensionController.connect()

  // Held for the life of the session: closing the pipe tells Chromium to quit.
  plugin.cdpController = cdpExtensionController

  stampReadyCdpPort(
    extensionOutputPath,
    chromeRemoteDebugPort,
    plugin.launchRunId
  )

  const loadOutcome =
    (await cdpExtensionController.verifyGuestLoaded?.()) ??
    ({status: 'unknown'} as const)
  const guestPath = extensionOutputPath || selectedExtensionPaths[0] || ''

  if (loadOutcome.status === 'unknown' && loadOutcome.unsupported) {
    humanWarn(messages.chromiumExtensionLoadUnconfirmed(guestPath))
  }

  if (loadOutcome.status === 'refused') {
    reportGuestLoadRefused(
      plugin,
      extensionOutputPath,
      guestPath,
      loadOutcome.reason,
      true
    )
  }
}

export async function setupCdpAfterLaunch(
  compilation: CompilationLike | undefined,
  plugin: ChromiumPluginRuntime,
  chromiumArgs: string[],
  pipeStreams?: {input: Readable; output: Writable}
): Promise<void> {
  const {
    extensionOutputPath,
    extensionPaths,
    selectedExtensionPaths,
    companionPath,
    chromeRemoteDebugPort,
    userDataDir
  } = readLaunchTargets(compilation, plugin, chromiumArgs)

  // The identity card carries the profile row now. The standalone line only
  // survives where this launch cannot show the card: the pair's key is already
  // claimed (start prints build's card first) or no output path exists to
  // resolve a card against.
  const profileOnCard =
    Boolean(extensionOutputPath) &&
    !isCardKeyClaimed(`${plugin.browser}::${path.resolve(extensionOutputPath)}`)

  if (isDebug()) {
    if (userDataDir && !profileOnCard) {
      humanLine(messages.devChromeProfilePath(userDataDir))
    }

    humanLine(
      messages.devChromiumDebugPort(
        chromeRemoteDebugPort,
        chromeRemoteDebugPort
      )
    )
  }

  const cdpExtensionController = new CDPExtensionController({
    outPath: extensionOutputPath,
    browser: plugin.browser,
    cdpPort: chromeRemoteDebugPort,
    profilePath: userDataDir || undefined,
    extensionPaths: selectedExtensionPaths,
    companionPath,
    pipeIn: pipeStreams?.input,
    pipeOut: pipeStreams?.output,
    logSink: plugin.logSink
  })

  // connectToChromeCdp already performs bounded startup retries internally.
  // Avoid layering another retry loop here, which can make startup feel hung.
  await cdpExtensionController.connect()

  if (isDebug()) {
    humanLine(messages.cdpClientConnected('127.0.0.1', chromeRemoteDebugPort))
  }

  // Without it the extensions page hides the unpacked controls a developer
  // came for, and Chromium treats this session's own work as off-store.
  if (
    userDataDir &&
    developerModeFlipIsSafe(chromiumArgs) &&
    !developerModeFromProfile(userDataDir)
  ) {
    const developerMode = await cdpExtensionController.ensureDeveloperMode()

    if (isDebug()) {
      humanLine(`[CDP] developer mode: ${developerMode}`)
    }
  }

  stampReadyCdpPort(
    extensionOutputPath,
    chromeRemoteDebugPort,
    plugin.launchRunId
  )

  // Ask the browser whether the guest actually loaded BEFORE any banner: the
  // banner's id falls back to a path hash, so it prints happily for an
  // extension the browser threw away.
  const loadOutcome =
    (await cdpExtensionController.verifyGuestLoaded?.()) ??
    ({status: 'unknown'} as const)

  if (loadOutcome.status === 'unknown' && loadOutcome.unsupported) {
    const unconfirmedPath =
      extensionOutputPath || selectedExtensionPaths[0] || ''
    humanWarn(messages.chromiumExtensionLoadUnconfirmed(unconfirmedPath))
    plugin.logSink?.({
      level: 'warn',
      text: `extension_load_unconfirmed: ${unconfirmedPath}`,
      source: 'browser'
    })
  }

  if (loadOutcome.status === 'refused') {
    const refusedPath = extensionOutputPath || selectedExtensionPaths[0] || ''
    reportGuestLoadRefused(
      plugin,
      extensionOutputPath,
      refusedPath,
      loadOutcome.reason
    )

    // The refusal withholds the card, so the profile line keeps the
    // information until the recovery banner can carry it.
    if (isDebug() && userDataDir && profileOnCard) {
      humanLine(messages.devChromeProfilePath(userDataDir))
    }

    // No banner and no Extension ID: there is nothing in the browser to name.
    // The refusal flag withholds the launch path's "ready for development" claim.
    plugin.cdpController = cdpExtensionController

    // Bind the banner the refusal just withheld, so a later compile that gets
    // the dist accepted can finally name the guest the browser is running.
    plugin.printBannerOnRecovery = async () => {
      await printDevBannerOnce({
        outPath: extensionOutputPath,
        browser: plugin.browser,
        hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
        getInfo: async () => cdpExtensionController.getInfoBestEffort(),
        browserVersionLine: plugin.browserVersionLine,
        profilePath: userDataDir || undefined,
        binaryPath: plugin.binaryPath,
        binaryProvenance: plugin.binaryProvenance
      })
    }

    return
  }

  const mode = (compilation?.options?.mode || 'development') as string
  let earlyBannerPrinted = false

  // Fast path: print banner from manifest/fallback data before CDP handshake.
  // If no extension ID can be derived yet, later passes still print it.
  if (mode === 'development') {
    try {
      earlyBannerPrinted = await printDevBannerOnce({
        outPath: extensionOutputPath,
        browser: plugin.browser,
        hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
        getInfo: async () => null,
        browserVersionLine: plugin.browserVersionLine,
        profilePath: userDataDir || undefined,
        binaryPath: plugin.binaryPath,
        binaryProvenance: plugin.binaryProvenance
      })
    } catch {
      // best-effort only
    }
  }

  if (mode === 'development') {
    try {
      earlyBannerPrinted = await printDevBannerOnce({
        outPath: extensionOutputPath,
        browser: plugin.browser,
        hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
        getInfo: async () => cdpExtensionController.getInfoBestEffort(),
        browserVersionLine: plugin.browserVersionLine,
        profilePath: userDataDir || undefined,
        binaryPath: plugin.binaryPath,
        binaryProvenance: plugin.binaryProvenance
      })
    } catch {
      // best-effort only
    }
  }

  let extensionControllerInfo: {
    extensionId: string
    name?: string
    version?: string
  } | null = null

  try {
    const ensureLoadedTimeoutMs = 10000
    extensionControllerInfo = await Promise.race([
      cdpExtensionController.ensureLoaded(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () =>
            reject(
              codedError(
                CODES.E_CDP_TIMEOUT,
                `ensureLoaded timeout (${ensureLoadedTimeoutMs}ms)`
              )
            ),
          ensureLoadedTimeoutMs
        )
      })
    ])
  } catch (error) {
    const code = declaredCode(error)

    if (code) {
      stampReadyCdpFault(
        extensionOutputPath,
        code,
        describeLaunchFailure(error),
        plugin.launchRunId
      )
    }

    if (isDebug()) {
      humanWarn(
        `[CDP] ensureLoaded failed: ${String(
          (error as Error)?.message || error
        )}`
      )
    }
  }

  try {
    if (mode === 'development') {
      if (!earlyBannerPrinted) {
        const bannerPrinted = await printDevBannerOnce({
          outPath: extensionOutputPath,
          browser: plugin.browser,
          hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
          getInfo: async () => extensionControllerInfo,
          browserVersionLine: plugin.browserVersionLine,
          profilePath: userDataDir || undefined,
          binaryPath: plugin.binaryPath,
          binaryProvenance: plugin.binaryProvenance
        })

        if (!bannerPrinted) {
          await printDevBannerOnce({
            outPath: extensionOutputPath,
            browser: plugin.browser,
            hostPort: {host: '127.0.0.1', port: chromeRemoteDebugPort},
            getInfo: async () => cdpExtensionController.getInfoBestEffort(),
            browserVersionLine: plugin.browserVersionLine,
            profilePath: userDataDir || undefined,
            binaryPath: plugin.binaryPath,
            binaryProvenance: plugin.binaryProvenance
          })
        }
      }
    } else if (mode === 'production') {
      const runtime = extensionControllerInfo
        ? {
            extensionId: extensionControllerInfo.extensionId,
            name: extensionControllerInfo.name,
            version: extensionControllerInfo.version
          }
        : undefined
      await printProdBannerOnce({
        browser: plugin.browser,
        outPath: extensionOutputPath,
        browserVersionLine: plugin.browserVersionLine,
        runtime,
        profilePath: userDataDir || undefined,
        binaryPath: plugin.binaryPath,
        binaryProvenance: plugin.binaryProvenance
      })
    }
  } catch (bannerErr) {
    if (isDebug()) {
      humanWarn(messages.bestEffortBannerPrintFailed(String(bannerErr)))
    }

    // Fallback: even if CDP/rich info fails, try to print a manifest-based
    // production summary so users still see a banner.
    try {
      const mode = (compilation?.options?.mode || 'development') as string

      if (mode === 'production') {
        await printProdBannerOnce({
          browser: plugin.browser,
          outPath: extensionOutputPath,
          browserVersionLine: plugin.browserVersionLine,
          profilePath: userDataDir || undefined,
          binaryPath: plugin.binaryPath,
          binaryProvenance: plugin.binaryProvenance
        })
      }
    } catch {
      // best-effort only
    }
  }

  // The companions only reach a browser that ignores --load-extension over
  // CDP, after the guest so the welcome page finds the extension it names.
  try {
    if (loadsExtensionsOverCdpOnly(plugin.browser)) {
      const results = await cdpExtensionController.loadCompanions(
        companionPathsForCdpLoad(extensionPaths, extensionOutputPath)
      )

      if (isDebug()) {
        for (const {path: loadedPath, outcome} of results) {
          humanLine(
            `[CDP] companion ${loadedPath}: ${outcome.status}${
              outcome.status === 'refused' ? ` (${outcome.reason})` : ''
            }`
          )
        }
      }
    }
  } catch {
    // best-effort only, the guest is loaded and the session still works
  }

  // The launch tab predates extension registration, so it shows the default new
  // tab; open a fresh tab onto the newtab override. Skipped for startingUrl/--no-open.
  try {
    if (
      extensionControllerInfo &&
      !plugin.startingUrl &&
      !plugin.noOpen &&
      manifestDeclaresNewtabOverride(extensionOutputPath)
    ) {
      await cdpExtensionController.openTab('chrome://newtab/')
    }
  } catch {
    // best-effort only, never block launch on the courtesy tab
  }

  // Only a headless launch reaches this, and only one whose own target list
  // says it has no page, so a session that kept its page is untouched.
  if (
    extensionControllerInfo &&
    !plugin.noOpen &&
    launchIsHeadless(chromiumArgs)
  ) {
    const pageUrl =
      plugin.startingUrl ||
      (companionPath
        ? devtoolsCompanionWelcomeUrl(companionPath)
        : 'about:blank')

    // A broken wire is not a teardown verdict, so it answers unavailable and
    // the refusal below keeps naming only what the target list actually said.
    const outcome = await cdpExtensionController
      .ensurePageTarget(pageUrl)
      .catch(() => 'unavailable' as const)

    if (outcome === 'created' && isDebug()) {
      humanLine(messages.chromiumHeadlessPageTargetRecreated(plugin.browser))
    }

    if (outcome === 'refused') {
      humanWarn(messages.chromiumHeadlessNoPageTarget(plugin.browser))
    }
  }

  // A fork's own onboarding tab (Vivaldi's signup wizard) is repointed at the
  // companion welcome page, or at a blank page when the user asked for no
  // tab or no companion is loaded, before the --no-open sweep below runs.
  try {
    if (extensionControllerInfo) {
      await cdpExtensionController.replaceForkFirstRunTabs(
        plugin.browser,
        plugin.noOpen || !companionPath
          ? 'about:blank'
          : devtoolsCompanionWelcomeUrl(companionPath)
      )
    }
  } catch {
    // best-effort only
  }

  // The companion opens its welcome page on a first run and the launch tab
  // lands on chrome://extensions, neither of which honors --no-open.
  try {
    if (plugin.noOpen) {
      await cdpExtensionController.closeSelfOpenedTabs()
    }
  } catch {
    // Ignore
  }

  plugin.cdpController = cdpExtensionController
}

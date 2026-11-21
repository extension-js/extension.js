// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  loadProjectAndCommandConfig,
  logOptionsOf,
  refuseManagedDependencyConflicts,
  resolveCommandBrowser
} from './command-steps/project-setup'
import {controlledBuildParts} from './controlled-build-parts'
import {CONTROL_WS_PATH} from './dev-server/control-bridge/contracts'
import * as devServerMessages from './dev-server/messages'
import {startProductionControl} from './dev-server/production-control'
import {announceLeftoverOutputFolder} from './lib/build-output-guard'
import {codedError} from './lib/coded-error'
import {
  refuseCompanionLinksNoStoreReads,
  resolveCompanionExtensionsConfig
} from './lib/companion-extensions/resolve-config'
import {resolveCompanionExtensionDirs} from './lib/companion-extensions/resolve-dirs'
import type {CompanionExtensionsConfig} from './lib/companion-extensions/types'
import {
  holdPreloadedEnvOf,
  loadBrowserConfig,
  loadCommandConfig
} from './lib/config-loader'
import {STOCK_COMPANION_EXTENSIONS} from './lib/constants'
import {withDarkMode} from './lib/dark-mode'
import {
  companionScanDirInsideProject,
  companionsDeclaredIn,
  computeExtensionsToLoad,
  namedCompanionFoldersInsideProject,
  scannedCompanionsOutsideProject,
  unresolvedNamedCompanions
} from './lib/extensions-to-load'
import {
  falseProfileSource,
  mergeOptionLayers,
  SERVE_COMMAND_DEFAULTS
} from './lib/merge-options'
import * as messages from './lib/messages'
import {
  CODES,
  humanLine,
  humanWarn,
  isDebug,
  releaseCardKeysOf,
  stripChannelPrefix
} from './lib/messaging'
import {
  type BrowserInput,
  computePreviewOutputPath,
  getDirs,
  getDistPath
} from './lib/paths'
import {getProjectStructure, type RemoteArchiveTarget} from './lib/project'
import {readReadyRecord} from './lib/ready-contract-writer'
import {linkFreePath} from './lib/real-path'
import {
  recordedBuildBrowser,
  sharesBrowserEngine
} from './lib/recorded-build-browser'
import {remoteArchiveCacheRoot} from './lib/remote-archive'
import {sanitize} from './lib/sanitize'
import {
  ensureSessionArtifactsIgnoreFile,
  sessionArtifactsRootDir
} from './lib/session-paths'
import {takeStartLaunchHoldings} from './lib/start-launch-handoff'
import {
  createReadyContractWriter,
  getSessionRunId
} from './plugin-ready-contract'
import type {
  BrowserConfig,
  BrowserDefaulted,
  BrowserType,
  PreviewOptions,
  SpecialFoldersConfig
} from './types'

/**
 * Resolved browser launch options returned by extensionPreview.
 * The caller is responsible for actually launching the browser.
 */
export interface ResolvedPreviewOptions {
  browser: BrowserType
  outPath: string
  // Set when outPath is a copy that carries the control channel: the folder
  // the copy was made from, which holds the author's code alone.
  shippedPath?: string
  contextDir: string
  readyPath: string
  extensionsToLoad: string[]
  noOpen?: boolean
  profile?: string | false
  profileSource?: 'flag' | 'config'
  persistProfile?: boolean
  keepProfileChanges?: boolean
  copyFromProfile?: string
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  startingUrl?: string
  chromiumBinary?: string
  geckoBinary?: string
  instanceId?: string
  port?: number | string
  dryRun?: boolean
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

/**
 * What a launcher may hand back about the browser it started.
 */
export interface PreviewBrowserSession {
  /** Start a suspended background again. Firefox only. */
  wakeBackground?(): Promise<boolean>
  /** Settles once the browser this session opened is gone. */
  ended?: Promise<void>
}

// The browser launcher the CLI injects. extensionPreview refuses to run
// without one, since develop never launches a browser by itself.
export type PreviewLauncherFn = (
  opts: ResolvedPreviewOptions
) => Promise<PreviewBrowserSession | undefined | void>

function readReadyField(
  readyPath: string,
  field: 'runId' | 'status'
): string | undefined {
  const value = readReadyRecord(readyPath)?.[field]

  return typeof value === 'string' ? value : undefined
}

// One exit listener for every session this process opened, keyed by ready
// file, so a repeated call replaces its entry instead of adding a listener.
const shutdownStampByReadyPath = new Map<string, () => void>()

function stampShutdownOnExit(readyPath: string, stamp: () => void): void {
  const listening = shutdownStampByReadyPath.size > 0

  shutdownStampByReadyPath.set(readyPath, stamp)

  if (listening) return

  process.once('exit', () => {
    for (const stampSession of shutdownStampByReadyPath.values()) {
      try {
        stampSession()
      } catch {
        // One unwritable record must not keep the others from being stamped.
      }
    }
  })
}

// A remote URL or a local archive: the project resolver already extracted
// it, and a build archive holds a manifest with no package.json next to it.
function isArchiveSource(pathOrRemoteUrl: string): boolean {
  if (/^https?:/i.test(pathOrRemoteUrl)) return true

  return path.extname(pathOrRemoteUrl.split('?')[0]).toLowerCase() === '.zip'
}

export function explicitUnpackedDir(
  pathOrRemoteUrl: string | undefined,
  packageJsonDir: string,
  manifestDir?: string
): string | undefined {
  if (!pathOrRemoteUrl) return undefined

  if (isArchiveSource(pathOrRemoteUrl)) {
    // A downloaded build is previewed where it landed: no dist lookup under
    // it and no advice to build what someone else already built. A source
    // archive (package.json beside the manifest) keeps the project path.
    if (!manifestDir) return undefined

    if (!fs.existsSync(path.join(manifestDir, 'manifest.json'))) {
      return undefined
    }

    if (fs.existsSync(path.join(manifestDir, 'package.json'))) return undefined
    if (fs.existsSync(path.join(manifestDir, 'deno.json'))) return undefined

    return manifestDir
  }

  const typed = linkFreePath(path.resolve(process.cwd(), pathOrRemoteUrl))

  if (!fs.existsSync(path.join(typed, 'manifest.json'))) return undefined
  if (fs.existsSync(path.join(typed, 'package.json'))) return undefined
  if (path.resolve(packageJsonDir) === typed) return undefined
  // The src/ folder of a project is its source, not an unpacked build.
  if (path.basename(typed) === 'src') return undefined

  return typed
}

// A folder named on the command line that no project manifest claims and
// that is itself what loads: a build folder, not a source waiting for one.
function isNamedLoadFolder(
  pathOrRemoteUrl: string | undefined,
  loadedDir: string
): boolean {
  if (!pathOrRemoteUrl || isArchiveSource(pathOrRemoteUrl)) return false

  const typed = linkFreePath(path.resolve(process.cwd(), pathOrRemoteUrl))

  if (path.basename(typed) === 'src') return false

  return typed === linkFreePath(path.resolve(loadedDir))
}

// A previewed archive is read, never edited, so it lands in the user's cache
// and the folder the command ran from stays as it was. --output-path names
// the one folder it may land in instead. `start` builds its archive where
// it unpacked it, so that path keeps the current directory.
export function previewArchiveTarget(
  metadataCommand: 'start' | 'preview',
  outputPath?: string
): RemoteArchiveTarget | undefined {
  if (metadataCommand !== 'preview') return undefined
  if (outputPath) return {destination: path.resolve(process.cwd(), outputPath)}

  return {cacheRoot: remoteArchiveCacheRoot()}
}

// How long a control session holds ready for the extension's first hello. A
// build that never connects still gets its ready, with no attach stamp on it.
export const EXECUTOR_ATTACH_WAIT_MS = 10000

function firstOf(settled: Promise<void>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)

    void settled.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

// What the leg holds in its host until it ends: the env file values its
// config loaded and the card of the folder it ran, `start`'s build card too.
interface PreviewLeg {
  outputPath: string
  // Set once a browser is up, with what the launcher says about its end.
  openSession?: PreviewBrowserSession
  holdProject(projectDir: string): void
  end(): void
}

function createPreviewLeg(
  pathOrRemoteUrl: string | undefined,
  startLeg: boolean
): PreviewLeg {
  const releases: Array<() => void> = []
  let ended = false

  const leg: PreviewLeg = {
    outputPath: '',
    holdProject(projectDir) {
      releases.push(holdPreloadedEnvOf(projectDir))

      if (startLeg) {
        releases.push(...takeStartLaunchHoldings(pathOrRemoteUrl, projectDir))
      }
    },
    end() {
      if (ended) return

      ended = true

      // A start leg that failed before it found its project still owes the
      // host what the build parked for the path both were given.
      if (startLeg) releases.push(...takeStartLaunchHoldings(pathOrRemoteUrl))
      if (leg.outputPath) releaseCardKeysOf(path.resolve(leg.outputPath))

      for (const release of releases.splice(0)) release()
    }
  }

  return leg
}

export async function extensionPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: BrowserDefaulted<PreviewOptions>,
  browserLauncher?: PreviewLauncherFn
) {
  const leg = createPreviewLeg(
    pathOrRemoteUrl,
    previewOptions.metadataCommand === 'start'
  )
  let result: Awaited<ReturnType<typeof runPreview>>

  try {
    result = await runPreview(
      pathOrRemoteUrl,
      previewOptions,
      leg,
      browserLauncher
    )
  } catch (error) {
    leg.end()

    throw error
  }

  // An open browser is a live session, and it keeps both until it is gone.
  // A launcher that cannot say when leaves them to the end of the process.
  if (leg.openSession) {
    void leg.openSession.ended?.then(leg.end, leg.end)
  } else {
    leg.end()
  }

  return result
}

async function runPreview(
  pathOrRemoteUrl: string | undefined,
  previewOptions: BrowserDefaulted<PreviewOptions>,
  leg: PreviewLeg,
  browserLauncher?: PreviewLauncherFn
) {
  const metadataCommand =
    previewOptions.metadataCommand === 'start' ? 'start' : 'preview'

  // Both refusals come before anything is resolved, downloaded or written.
  if (
    previewOptions.noBrowser &&
    (previewOptions.allowControl || previewOptions.allowEval)
  ) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.controlNeedsBrowser(metadataCommand)
    )
  }

  if (!previewOptions.noBrowser && !browserLauncher) {
    throw codedError(CODES.E_INVALID_OPTION, messages.previewLauncherRequired())
  }

  const projectStructure = await getProjectStructure(pathOrRemoteUrl, {
    remoteArchive: previewArchiveTarget(
      metadataCommand,
      previewOptions.outputPath
    ),
    previewing: metadataCommand === 'preview'
  })
  const debug = isDebug()
  const {manifestDir, packageJsonDir} = getDirs(projectStructure)

  leg.holdProject(packageJsonDir)
  announceLeftoverOutputFolder(projectStructure)

  refuseManagedDependencyConflicts(projectStructure, packageJsonDir)

  // The same stock default as build, so a build made with no browser named
  // is the one previewed. A browser passed in wins. With none,
  // commands.<cmd>.browser from the project config decides which build is
  // previewed.
  const browser = await resolveCommandBrowser({
    asked: previewOptions.browser as BrowserInput | undefined,
    command: metadataCommand,
    chromiumBinary: previewOptions.chromiumBinary,
    geckoBinary: previewOptions.geckoBinary || previewOptions.firefoxBinary,
    configBrowser: async (stockBrowser) =>
      (
        await loadCommandConfig(packageJsonDir, metadataCommand, {
          mode: 'production',
          browser: stockBrowser
        })
      ).browser
  })
  // A directory that holds a manifest but no package.json is an unpacked
  // extension (a build folder, a downloaded release): preview exactly that,
  // instead of walking up to an ancestor project and looking for its dist.
  const unpackedDir = explicitUnpackedDir(
    pathOrRemoteUrl,
    packageJsonDir,
    manifestDir
  )
  const outputPath =
    unpackedDir && !previewOptions.outputPath
      ? unpackedDir
      : computePreviewOutputPath(
          projectStructure,
          browser,
          previewOptions.outputPath
        )
  leg.outputPath = outputPath
  // With no project around it, the folder that was named and is loaded is
  // the build, so no dist/<browser> is looked for beneath it.
  const namedFolderIsTheBuild =
    !(projectStructure.packageJsonPath || projectStructure.denoJsonPath) &&
    !previewOptions.outputPath &&
    isNamedLoadFolder(pathOrRemoteUrl, outputPath)
  const distPath =
    unpackedDir ||
    (namedFolderIsTheBuild ? outputPath : getDistPath(packageJsonDir, browser))

  // A build names its browser in the summary kept beside it. A folder with
  // no summary (a download, a hand-made folder) is loaded as asked.
  const builtFor = recordedBuildBrowser(outputPath, [
    sessionArtifactsRootDir(packageJsonDir),
    path.join(path.dirname(outputPath), 'extension-js')
  ])

  if (builtFor && !sharesBrowserEngine(builtFor, String(browser))) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.previewBuildBrowserMismatch(
        outputPath,
        builtFor,
        String(browser)
      )
    )
  }

  const runningMessage =
    metadataCommand === 'start' ? messages.starting : messages.previewing
  // The run record describes the directory the browser loads, so its path
  // and the extension id derived from it name the actual load, not the
  // stock build folder the flag may have replaced.
  let metadata = createReadyContractWriter({
    packageJsonDir,
    browser: String(browser),
    command: metadataCommand,
    distPath: outputPath,
    manifestPath: projectStructure.manifestPath,
    // Run-only serves nothing, so there is no port to report. Echoing the
    // requested one described a listener that never existed.
    port: null
  })

  // `extension start` already opened this run in the build phase (timeline
  // rows + compile stamp). A second writeStarting would wipe the rows and
  // restamp compiledAt as "browser came up". Continue only when the ready
  // file carries THIS process's runId: a stale file from an earlier run
  // must not poison the new run's timeline or refusal status.
  const continuingStartRun =
    metadataCommand === 'start' &&
    readReadyField(metadata.readyPath, 'runId') ===
      getSessionRunId(packageJsonDir, String(browser))

  if (!continuingStartRun) {
    metadata.writeStarting()
  }

  let control: Awaited<ReturnType<typeof startProductionControl>> | undefined
  let launching = false
  let recorded = false

  try {
    if (debug) {
      humanLine(messages.debugDirs(manifestDir, packageJsonDir))
      humanLine(
        messages.debugBrowser(
          browser,
          previewOptions.chromiumBinary,
          previewOptions.geckoBinary || previewOptions.firefoxBinary
        )
      )

      humanLine(messages.debugPreviewOutput(outputPath, distPath))
    }

    ensureSessionArtifactsIgnoreFile(packageJsonDir)

    // Run-only preview requires an existing unpacked extension root at outputPath.
    // If dist/<browser> doesn't exist, computePreviewOutputPath falls back to manifestDir.
    const manifestAtOutput = path.join(outputPath, 'manifest.json')

    if (!fs.existsSync(manifestAtOutput)) {
      recorded = true
      metadata.writeError(
        'preview_manifest_missing',
        `Expected manifest at ${manifestAtOutput}`
      )

      throw codedError(
        CODES.E_PREVIEW_NO_DIST,
        messages.previewHasNothingToRun(manifestAtOutput)
      )
    }

    // Load command + browser defaults from the project root; when start.ts
    // delegates here, honor commands.start.* rather than commands.preview.*.
    // Preview loads a production build, so the config reads the env files
    // that build read: production ones, and those named for this browser.
    const envTarget = {mode: 'production', browser: String(browser)}
    const {projectConfig, commandConfig} = await loadProjectAndCommandConfig(
      packageJsonDir,
      metadataCommand,
      envTarget
    )
    const browserConfig = await loadBrowserConfig(
      packageJsonDir,
      browser,
      envTarget
    )

    // Which directory is being previewed is the one thing every path has to say,
    // so it is resolved before the no-browser branch returns and is carried to
    // the envelope rather than living only in a terminal line.
    const warnings: string[] = []

    if (path.resolve(outputPath) !== path.resolve(distPath)) {
      const frame = previewOptions.outputPath
        ? messages.previewingCustomOutput(browser, outputPath, distPath)
        : messages.previewingSourceFallback(browser, distPath)

      warnings.push(stripChannelPrefix(frame))
    }

    const safeProjectConfig = sanitize(projectConfig) as {
      extensions?: CompanionExtensionsConfig
      folders?: SpecialFoldersConfig
    }
    const safeBrowserConfig = sanitize(browserConfig) as BrowserConfig
    const safeCommandConfig = sanitize(
      commandConfig
    ) as Partial<PreviewOptions> & {
      extensions?: CompanionExtensionsConfig
      folders?: SpecialFoldersConfig
    }
    const safePreviewOptions = sanitize(previewOptions) as PreviewOptions
    // An unpacked folder handed in has no project around it to hold companions.
    const stockExtensions = unpackedDir ? undefined : STOCK_COMPANION_EXTENSIONS

    const mergedExtensionsConfig =
      safePreviewOptions.extensions ??
      safeCommandConfig.extensions ??
      safeBrowserConfig.extensions ??
      safeProjectConfig.extensions ??
      stockExtensions
    // With no browser nothing loads a companion, so none is fetched from a
    // store. A named folder outside the project is refused either way.
    const resolvedExtensionsConfig = previewOptions.noBrowser
      ? undefined
      : await resolveCompanionExtensionsConfig({
          projectRoot: packageJsonDir,
          browser,
          config: mergedExtensionsConfig
        })

    if (previewOptions.noBrowser) {
      refuseCompanionLinksNoStoreReads(mergedExtensionsConfig)
    }

    // The session goes on without a named companion that is not an extension,
    // browser or not, and the caller reads which one beside the other warnings.
    const checkedWithoutBrowser = previewOptions.noBrowser
      ? {
          paths: namedCompanionFoldersInsideProject(
            mergedExtensionsConfig,
            packageJsonDir
          ),
          dir: companionScanDirInsideProject(
            mergedExtensionsConfig,
            packageJsonDir
          )
        }
      : undefined
    const missingCompanions = unresolvedNamedCompanions({
      projectRoot: packageJsonDir,
      resolved: checkedWithoutBrowser ?? resolvedExtensionsConfig,
      declared: mergedExtensionsConfig,
      declaredIn: companionsDeclaredIn(metadataCommand, {
        flag: safePreviewOptions.extensions,
        command: safeCommandConfig.extensions,
        browser: safeBrowserConfig.extensions,
        project: safeProjectConfig.extensions
      })
    })

    // With a browser the launch path scans the folder and speaks for itself.
    if (checkedWithoutBrowser) {
      missingCompanions.push(
        ...scannedCompanionsOutsideProject({
          projectRoot: packageJsonDir,
          dir: checkedWithoutBrowser.dir
        })
      )
    }

    const warnAboutMissingCompanions = () => {
      for (const companion of missingCompanions) {
        warnings.push(companion.coded)
        humanWarn(companion.frame)
      }
    }

    if (previewOptions.noBrowser) {
      const browserLabel = String(browser || 'unknown')
      // Identity first, then the state lines: the card is the header for the
      // session, not a summary trailing the result it describes.
      humanLine(devServerMessages.spacerLine())
      humanLine(
        devServerMessages.browserRunnerDisabled({
          browser: browserLabel,
          manifestPath: projectStructure.manifestPath,
          readyPath: metadata.readyPath,
          distPath: outputPath
        })
      )

      humanLine(devServerMessages.spacerLine())
      humanLine(runningMessage(browser, true))

      if (warnings.length) {
        humanWarn(
          previewOptions.outputPath
            ? messages.previewingCustomOutput(browser, outputPath, distPath)
            : messages.previewingSourceFallback(browser, distPath)
        )
      }

      warnAboutMissingCompanions()
      metadata.writeReady()

      return {warnings}
    }

    let launchPath = outputPath
    let launched: PreviewBrowserSession | undefined
    let executorAttached: Promise<void> | undefined

    if (previewOptions.allowControl || previewOptions.allowEval) {
      let noteAttached: () => void = () => undefined

      executorAttached = new Promise<void>((resolve) => {
        noteAttached = resolve
      })

      let stampAttached: (() => void) | undefined
      let stampDetached: (() => void) | undefined
      control = await startProductionControl({
        parts: controlledBuildParts,
        packageJsonDir,
        browser: String(browser),
        command: metadataCommand,
        distPath: outputPath,
        allowControl: previewOptions.allowControl,
        allowEval: previewOptions.allowEval,
        host: previewOptions.host,
        runId: getSessionRunId(packageJsonDir, String(browser)),
        onExecutorAttached: () => {
          stampAttached?.()
          noteAttached()
        },
        onExecutorDetached: () => stampDetached?.(),
        wakeExecutor: async () => {
          try {
            return (await launched?.wakeBackground?.()) === true
          } catch {
            return false
          }
        }
      })

      // A build with no background carries no producer, so nothing dials in.
      const session = control

      if (session.backgroundAssets.length === 0) executorAttached = undefined

      launchPath = session.controlledPath
      // Same ready.json, now naming the folder loaded and the control port the
      // act verbs dial; writeStarting already ran, so nothing is reset.
      metadata = createReadyContractWriter({
        packageJsonDir,
        browser: String(browser),
        command: metadataCommand,
        distPath: launchPath,
        manifestPath: projectStructure.manifestPath,
        port: null,
        instanceId: session.instanceId,
        controlPort: session.controlPort,
        controlPath: CONTROL_WS_PATH,
        logsPath: session.logsPath
      })

      stampAttached = () => metadata.stampExecutorAttached()
      stampDetached = () => metadata.stampExecutorDetached()

      humanLine(
        messages.productionControlOpen(
          browser,
          launchPath,
          outputPath,
          Boolean(previewOptions.allowEval),
          session.backgroundAssets.length > 0
        )
      )
    }

    humanLine(runningMessage(browser))

    if (warnings.length) {
      humanLine(
        previewOptions.outputPath
          ? messages.previewingCustomOutput(browser, outputPath, distPath)
          : messages.previewingSourceFallback(browser, distPath)
      )
    }

    warnAboutMissingCompanions()

    const mergedGeckoBinary =
      safePreviewOptions.geckoBinary ||
      safePreviewOptions.firefoxBinary ||
      safeCommandConfig.geckoBinary ||
      safeCommandConfig.firefoxBinary ||
      safeBrowserConfig.geckoBinary ||
      safeBrowserConfig.firefoxBinary

    const mergedChromiumBinary =
      safePreviewOptions.chromiumBinary ||
      safeCommandConfig.chromiumBinary ||
      safeBrowserConfig.chromiumBinary

    // stock defaults, then top-level config, then browser.*, then
    // commands.start|preview, then CLI. Unset CLI keys fall through so shared
    // extension.config.js values apply.
    const merged: PreviewOptions &
      BrowserConfig & {
        extensions?: CompanionExtensionsConfig
        instanceId?: string
        dryRun?: boolean
      } = {
      ...mergeOptionLayers<PreviewOptions & BrowserConfig>(
        SERVE_COMMAND_DEFAULTS,
        safeProjectConfig,
        safeBrowserConfig,
        safeCommandConfig,
        safePreviewOptions
      ),
      extensions: resolvedExtensionsConfig,
      chromiumBinary: mergedChromiumBinary,
      geckoBinary: mergedGeckoBinary
    }

    const darkDefaults = withDarkMode({
      browser,
      browserFlags: merged.browserFlags,
      preferences: merged.preferences,
      excludeBrowserFlags: merged.excludeBrowserFlags
    })

    const companionUnpackedExtensionDirs = resolveCompanionExtensionDirs({
      projectRoot: packageJsonDir,
      config: merged.extensions,
      browser,
      // The no-browser run returned above, and a dry run opens nothing.
      launchesBrowser: !merged.dryRun
    })

    const unpackedExtensionDirsToLoad = computeExtensionsToLoad(
      // __dirname changes after publishing; anchor relative paths at the package
      // root so companion extensions stay stable across monorepo + published builds.
      path.resolve(__dirname, '..'),
      'production',
      browser,
      launchPath,
      companionUnpackedExtensionDirs,
      projectStructure.manifestPath
    )

    if (debug) {
      humanLine(messages.debugExtensionsToLoad(unpackedExtensionDirsToLoad))
    }

    metadata.setManagedExtensionDirs(
      unpackedExtensionDirsToLoad.filter(
        (dir) => path.resolve(dir) !== path.resolve(launchPath)
      )
    )

    const resolvedOpts: ResolvedPreviewOptions = {
      browser,
      outPath: launchPath,
      ...(launchPath === outputPath ? {} : {shippedPath: outputPath}),
      contextDir: packageJsonDir,
      readyPath: metadata.readyPath,
      extensionsToLoad: unpackedExtensionDirsToLoad,
      noOpen: merged.noOpen,
      profile: merged.profile,
      profileSource: falseProfileSource(
        merged.profile,
        safePreviewOptions.profile
      ),
      persistProfile: merged.persistProfile,
      keepProfileChanges: merged.keepProfileChanges,
      copyFromProfile: merged.copyFromProfile,
      preferences: darkDefaults.preferences,
      browserFlags: darkDefaults.browserFlags,
      excludeBrowserFlags: merged.excludeBrowserFlags,
      startingUrl: merged.startingUrl,
      chromiumBinary: merged.chromiumBinary,
      geckoBinary: merged.geckoBinary,
      instanceId: merged.instanceId,
      port: merged.port,
      dryRun: merged.dryRun,
      ...logOptionsOf(merged)
    }

    launching = true
    launched =
      (await (browserLauncher as PreviewLauncherFn)(resolvedOpts)) || undefined

    launching = false

    // The browser is up before the extension's background has dialed in, and
    // a caller that reads ready on a control session acts on the next line.
    if (executorAttached && !merged.dryRun) {
      await firstOf(executorAttached, EXECUTOR_ATTACH_WAIT_MS)
    }

    metadata.writeReady()

    // The launcher returns while the browser stays open, and the process later
    // ends on a signal or a browser close. Stamp that end so ready.json never
    // reports ready for a session that is gone. The --no-browser path above
    // returns first on purpose, its ready.json is read after this process exits.
    const openSession = metadata

    stampShutdownOnExit(openSession.readyPath, () => {
      openSession.writeShutdown(`the ${metadataCommand} session ended`)
    })

    // A dry run prints the launch and opens nothing, so nothing stays held.
    if (!merged.dryRun) leg.openSession = launched || {}

    return {warnings}
  } catch (error) {
    // A launcher that recorded its own failure named more than this can.
    if (!recorded && readReadyField(metadata.readyPath, 'status') !== 'error') {
      metadata.writeError(
        launching ? 'browser_launch_failed' : 'preview_failed',
        stripChannelPrefix(
          error instanceof Error ? error.message : String(error)
        )
      )
    }

    try {
      await control?.close()
    } catch {
      // The failure being reported is the one that matters.
    }

    throw error
  }
}

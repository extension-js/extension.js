// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {AsyncResource} from 'node:async_hooks'
import * as fs from 'node:fs'
import * as nodePath from 'node:path'
import {printBuildCard} from './command-steps/build-card'
import {resolveBuildCompanions} from './command-steps/build-companions'
import {createBuildCompilerConfig} from './command-steps/build-compiler-config'
import {reportFailedCompile} from './command-steps/build-failed-compile'
import {
  closeCompiler,
  fatalFailure,
  outputNotWritable,
  printedBuildFailures,
  readableFailure,
  reportedBuildFailures,
  writeFailedReceipt
} from './command-steps/build-failure'
import {finishGreenBuild} from './command-steps/build-green'
import {
  refuseBuildOverLiveSession,
  refuseForeignOutputFolder,
  resolveOutDir,
  resolveZipDir
} from './command-steps/build-output-folders'
import {createBuildReceipt} from './command-steps/build-receipt'
import {packageSafariApp} from './command-steps/build-safari-app'
import {
  loadProjectAndCommandConfig,
  prepareProjectTypes,
  refuseManagedDependencyConflicts,
  resolveCommandBrowser
} from './command-steps/project-setup'
import {
  removeStagingDir,
  removeStaleStagingDirs,
  stagingDistPathFor
} from './lib/atomic-dist'
import {announceLeftoverOutputFolder} from './lib/build-output-guard'
import type {BuildSummary} from './lib/build-summary'
import {codedError} from './lib/coded-error'
import {
  keepCodedWarningsOf,
  outsideCodedWarnings,
  takeCodedWarnings,
  withCodedWarnings
} from './lib/coded-warnings'
import {
  holdPreloadedEnvOf,
  loadBrowserConfig,
  loadCommandConfig
} from './lib/config-loader'
import {findDuplicateOutputFiles} from './lib/duplicate-output-files'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {findLiveDevSession} from './lib/live-dev-session'
import {
  BUILD_COMMAND_DEFAULTS,
  mergeOptionLayers,
  START_BUILD_DEFAULTS
} from './lib/merge-options'
import * as messages from './lib/messages'
import {
  CODES,
  debugLine,
  holdCardKey,
  holdHumanLines,
  humanLine,
  isDebug,
  isMachineOutput
} from './lib/messaging'
import {listOutputFiles} from './lib/output-files'
import {
  asAskedPath,
  browserOptionOrThrow,
  displayPath,
  getBuildDistPath,
  getDirs
} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {resolveSafariIdentity} from './lib/safari-identity'
import {readyContractPath} from './lib/session-paths'
import {parkForStartLaunch} from './lib/start-launch-handoff'
import {createReadyContractWriter} from './plugin-ready-contract'
import {rememberExcludedFiles} from './plugin-special-folders/folders-config'
import {rememberSpecialFoldersConfig} from './plugin-special-folders/get-data'
import type {
  BrowserDefaulted,
  BuildOptions,
  CommonWebpackOptions
} from './types'

export {resetBuildToolchainLine} from './command-steps/build-green'

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BrowserDefaulted<BuildOptions>
): Promise<BuildSummary> {
  // `start` prints its build leg as part of its own session, tree aside.
  const mayBeSilent = buildOptions?.metadataCommand !== 'start'
  let releaseHumanLines: (() => void) | undefined

  const goSilent = () => {
    if (mayBeSilent) releaseHumanLines ??= holdHumanLines()
  }

  if (buildOptions?.silent === true) goSilent()

  try {
    return await withCodedWarnings(() =>
      runBuild(pathOrRemoteUrl, buildOptions, goSilent)
    )
  } finally {
    releaseHumanLines?.()
  }
}

async function runBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions: BrowserDefaulted<BuildOptions> | undefined,
  goSilent: () => void
): Promise<BuildSummary> {
  // `extension start` builds with commands.start values and a silent build.
  // Plain `extension build` uses commands.build.
  const commandKey =
    buildOptions?.metadataCommand === 'start' ? 'start' : 'build'

  // The out dir comes from the command config, which loads inside the try so
  // a throwing config reports like every other build failure.
  let distPath = ''
  let stagingDistPath = ''

  // A run ended by a signal reaches no catch below, and its staging folder
  // would wait for the next build to sweep it. A published one is gone by then.
  const dropStagingOnExit = () => {
    if (stagingDistPath) removeStagingDir(stagingDistPath)
  }

  process.once('exit', dropStagingOnExit)
  let failureCount = 1
  let compilerToClose: {close?: (done: () => void) => void} | undefined
  let recordBuildFailure: ((error: unknown) => void) | undefined
  const isAuthor = isDebug()
  // Whoever imports the build keeps the NODE_ENV they started it with.
  const nodeEnvBefore = process.env.NODE_ENV
  let nodeEnvChanged = false
  // Finding the project and its browser comes before any build work, and a
  // refusal there is the whole answer: under machine output the frame has it.
  let findingProject = true
  let projectRoot = ''
  // What a green build would list, kept for the failure that carries it.
  let failureWarnings: string[] = []
  // The card this build claimed and its hold on the project's env file
  // values, both given back when it ends.
  let releaseCard: (() => void) | undefined
  let releaseEnv: (() => void) | undefined
  let succeeded = false
  const resolvedMode: 'development' | 'production' | 'none' =
    buildOptions?.mode === 'development' ||
    buildOptions?.mode === 'none' ||
    buildOptions?.mode === 'production'
      ? buildOptions.mode
      : 'production'

  try {
    const projectStructure = await getProjectStructure(pathOrRemoteUrl)
    const {manifestDir, packageJsonDir} = getDirs(projectStructure)

    projectRoot = packageJsonDir
    releaseEnv = holdPreloadedEnvOf(packageJsonDir)
    announceLeftoverOutputFolder(projectStructure)

    // A browser passed in wins; with none, commands.<cmd>.browser from the
    // project config decides the target before the stock default does.
    const askedBrowser = browserOptionOrThrow(buildOptions?.browser)
    // The config reads the env files the bundle will, so its first load is
    // told the mode and the browser that builds when the config names none.
    const browser = await resolveCommandBrowser({
      asked: askedBrowser,
      command: commandKey,
      chromiumBinary: buildOptions?.chromiumBinary,
      geckoBinary: buildOptions?.geckoBinary || buildOptions?.firefoxBinary,
      safariBinary: buildOptions?.safariBinary,
      configBrowser: async (stockBrowser) =>
        (
          await loadCommandConfig(packageJsonDir, commandKey, {
            mode: resolvedMode,
            browser: stockBrowser
          })
        ).browser
    })
    const envTarget = {mode: resolvedMode, browser: String(browser)}

    // A refusal before the compiler writes its receipt must not leave the last
    // run's ready.json standing. A live dev session's own file is left alone.
    recordBuildFailure = (error) => {
      if (!fs.existsSync(readyContractPath(packageJsonDir, browser))) return
      if (findLiveDevSession(packageJsonDir, browser)) return

      writeFailedReceipt(
        createReadyContractWriter({
          packageJsonDir,
          browser: String(browser),
          command: buildOptions?.metadataCommand || 'build',
          distPath: distPath || getBuildDistPath(packageJsonDir, browser),
          manifestPath: projectStructure.manifestPath
        }),
        error
      )
    }

    findingProject = false

    await ensureDevelopArtifacts()

    if (buildOptions?.install !== false) {
      await ensureUserProjectDependencies(packageJsonDir)
    }

    // Heavy deps are intentionally imported lazily so `preview` can run with a minimal install.
    const [
      {rspack},
      {handleStatsErrors, isEmitTimeWarning},
      {default: webpackConfig}
    ] = await Promise.all([
      import('@rspack/core'),
      import('./lib/stats-handler'),
      import('./rspack-config')
    ])

    const debug = isAuthor

    refuseManagedDependencyConflicts(projectStructure, packageJsonDir)

    const {projectConfig, commandConfig} = await loadProjectAndCommandConfig(
      packageJsonDir,
      commandKey,
      envTarget
    )
    const outDir = resolveOutDir(
      buildOptions?.outDir ?? commandConfig.outDir,
      packageJsonDir,
      browser
    )
    distPath = getBuildDistPath(packageJsonDir, browser, outDir)

    refuseForeignOutputFolder(outDir, distPath)

    // Assets are emitted into this staging sibling and a rename publishes it,
    // so an interrupted build can never leave a manifest without its pages.
    stagingDistPath = stagingDistPathFor(distPath)

    // A build over the folder a live dev session runs from is refused.
    const liveDevSession = refuseBuildOverLiveSession(
      packageJsonDir,
      browser,
      distPath
    )

    const browserConfig = await loadBrowserConfig(
      packageJsonDir,
      browser,
      envTarget
    )
    const foldersConfig =
      commandConfig.folders ?? browserConfig.folders ?? projectConfig.folders
    rememberSpecialFoldersConfig(packageJsonDir, foldersConfig)

    // stock defaults, then top-level config, then browser.*, then command
    // config, then CLI. Unset CLI keys are stripped so config wins. An
    // explicit flag beats it. The browser layer matches dev:
    // browser.<x>.transpilePackages and friends must not vanish between dev and build.
    const mergedBuildOptions = mergeOptionLayers<BuildOptions>(
      commandKey === 'start' ? START_BUILD_DEFAULTS : BUILD_COMMAND_DEFAULTS,
      projectConfig,
      browserConfig,
      commandConfig,
      buildOptions
    )
    // The plugins that read the special folders hold only a compiler, and
    // the first of them runs before the special-folders plugin itself.
    rememberExcludedFiles(
      packageJsonDir,
      (mergedBuildOptions as Partial<CommonWebpackOptions>).exclude
    )

    await prepareProjectTypes({
      manifestDir,
      packageJsonDir,
      manifestPath: projectStructure.manifestPath,
      browser,
      envTarget
    })

    const silent = Boolean(mergedBuildOptions.silent)
    // The start leg is silent by default and still speaks for its session.
    const quiet = silent && commandKey !== 'start'

    // A config layer can ask for it too, known only once the layers merge.
    if (silent) goSilent()

    // The Safari identity is settled from the same layers before any compile,
    // so a bad bundle id from any layer is refused without spending a build.
    const safariPackager =
      browser === 'safari' || browser === 'webkit-based'
        ? buildOptions?.safariPackager
        : undefined
    const safariIdentity = safariPackager
      ? resolveSafariIdentity(mergedBuildOptions, packageJsonDir)
      : undefined

    // Vite-style `emptyOutDir` determinism now comes from the staging swap:
    // the fresh staging dir replaces dist/<browser> wholesale on success, so
    // stale hashed bundles vanish while last-good survives a failed build.
    removeStaleStagingDirs(distPath)

    if (debug) {
      debugLine(messages.debugDirs(manifestDir, packageJsonDir))
      debugLine(
        messages.debugBrowser(
          browser,
          buildOptions?.chromiumBinary,
          buildOptions?.geckoBinary || buildOptions?.firefoxBinary
        )
      )

      debugLine(messages.debugOutputPath(distPath))
    }

    // Nothing a build writes loads a companion. Only the start leg, whose
    // launch follows, resolves them, which is where a store download happens.
    const resolvedExtensionsConfig = await resolveBuildCompanions({
      buildOptions,
      commandConfig,
      browserConfig,
      projectConfig,
      commandKey,
      packageJsonDir,
      browser,
      quiet
    })

    // `none` leaves NODE_ENV as the caller set it.
    if (resolvedMode === 'development' || resolvedMode === 'production') {
      nodeEnvChanged = true
      process.env.NODE_ENV = resolvedMode
    }

    const buildType: BuildSummary['buildType'] =
      resolvedMode === 'development' ? 'development' : 'production'

    const zipDir = resolveZipDir(
      mergedBuildOptions.zipDir,
      packageJsonDir,
      distPath
    )

    const {
      metadataCommand,
      configOptions,
      compilerConfig,
      useStagingSwap,
      displayDistPath
    } = await createBuildCompilerConfig({
      buildOptions,
      mergedBuildOptions,
      zipDir,
      resolvedExtensionsConfig,
      browser,
      resolvedMode,
      stagingDistPath,
      distPath,
      projectStructure,
      packageJsonDir,
      envTarget,
      liveDevSession,
      rspack,
      webpackConfig
    })

    // The bundler applies every plugin as it is made, before any compile, so
    // a throw here is a plugin's or the bundler's own and never the project's.
    const compiler = (() => {
      try {
        return rspack(compilerConfig)
      } catch (thrown) {
        throw fatalFailure(thrown, packageJsonDir)
      }
    })()
    compilerToClose = compiler
    keepCodedWarningsOf(compiler)

    const receipt = createBuildReceipt({
      packageJsonDir,
      browser,
      metadataCommand,
      distPath,
      manifestPath: projectStructure.manifestPath,
      configOptions,
      liveDevSession,
      launchFollows: mergedBuildOptions.launchFollows
    })
    const {heldReceipt, openReceipt, writeReadyWhenHeld} = receipt

    recordBuildFailure = (error) => {
      if (!heldReceipt()) return

      writeFailedReceipt(openReceipt(), error)
    }

    // The Safari app is part of what a Safari build answers for, so ready
    // waits for the packager and a failure there is the receipt's too.
    const packagingFollows = Boolean(safariPackager && safariIdentity)

    let summary: BuildSummary = {
      browser,
      buildType,
      output_path: asAskedPath(distPath),
      total_assets: 0,
      total_bytes: 0,
      largest_asset_bytes: 0,
      warnings_count: 0,
      errors_count: 0
    }

    await new Promise<void>((resolve, reject) => {
      // Every throw below settles the build as a rejection, never a callback
      // the bundler swallows while the promise stays pending.
      const settle = async (
        err: Error | null,
        stats: Parameters<Parameters<typeof compiler.run>[0]>[1]
      ) => {
        if (err) {
          return reject(
            outputNotWritable(err, nodePath.dirname(distPath)) ??
              fatalFailure(err, packageJsonDir)
          )
        }

        // Guard against silent-success scenarios where the bundler callback
        // does not provide stats, which means we cannot trust emission output.
        if (!stats || typeof stats.hasErrors !== 'function') {
          return reject(
            codedError(
              CODES.E_COMPILE_FATAL,
              'Build failed: bundler returned invalid stats output (no reliable compilation result).'
            )
          )
        }

        // One walk feeds the tree's folded line and the summary totals, so
        // both describe the folder the build wrote and not the stats list.
        const outputFiles = listOutputFiles(
          useStagingSwap ? stagingDistPath : displayDistPath
        )

        // The same bytes under two names ship twice, and nothing else in
        // the build says so: the tree lists both, the total adds both.
        const duplicateGroups = findDuplicateOutputFiles(
          useStagingSwap ? stagingDistPath : displayDistPath,
          outputFiles
        )

        // The identity card and asset tree are informational; a throw here
        // would leave this promise pending and the process would exit 0.
        releaseCard = holdCardKey(
          `${browser}::${nodePath.resolve(displayDistPath)}`
        )

        try {
          if (releaseCard) {
            printBuildCard(
              projectStructure.manifestPath,
              browser,
              displayDistPath,
              packageJsonDir,
              useStagingSwap ? stagingDistPath : displayDistPath,
              buildOptions?.metadataCommand === 'start' &&
                buildOptions?.launchFollows !== true
            )
          }

          if (!silent) {
            const assetsTree = messages.buildAssetsTree(stats, outputFiles)
            if (assetsTree) humanLine(assetsTree)
          }
        } catch {
          // Ignore
        }

        if (!stats.hasErrors()) {
          const finished = await finishGreenBuild({
            stats,
            summary,
            browser,
            buildType,
            resolvedMode,
            packageJsonDir,
            distPath,
            stagingDistPath,
            displayDistPath,
            useStagingSwap,
            liveDevSession,
            quiet,
            outputFiles,
            duplicateGroups,
            mergedBuildOptions,
            packagingFollows,
            receipt,
            isEmitTimeWarning
          })

          summary = finished.summary

          if (finished.zipFailure) {
            failureCount = finished.zipFailure.count
            failureWarnings = summary.warnings || []

            return reject(finished.zipFailure.error)
          }

          resolve()
        } else {
          const failed = reportFailedCompile({
            stats,
            stagingDistPath,
            packageJsonDir,
            browser,
            handleStatsErrors
          })

          if (failed.failureWarnings) failureWarnings = failed.failureWarnings

          return reject(failed.failure)
        }
      }

      // The bundler starts outside this build's scope and calls back from its
      // own thread hop, so the callback is bound to read this build's warnings.
      const settled = AsyncResource.bind(
        (err: Error | null, stats: Parameters<typeof settle>[1]) => {
          settle(err, stats).catch(reject)
        }
      )

      outsideCodedWarnings(() => compiler.run(settled))
    })

    // The packager reads the folder the bundler actually emitted into, which
    // under a re-pointed output.path is not dist/<browser>.
    if (safariPackager && safariIdentity) {
      summary = await packageSafariApp({
        safariPackager,
        safariIdentity,
        displayDistPath,
        summary,
        packageJsonDir,
        browser,
        liveDevSession
      })
    }

    if (packagingFollows) writeReadyWhenHeld()

    succeeded = true

    return summary
  } catch (thrown) {
    if (stagingDistPath) removeStagingDir(stagingDistPath)

    // The line below and every caller read the message of the failure, so a
    // thrown value with none is wrapped before it is printed and passed on.
    const error = readableFailure(thrown, projectRoot)

    // A compile that passed and a build that then failed must not be left
    // reading as still starting, or as ready, for whoever waits on it.
    try {
      recordBuildFailure?.(error)
    } catch {
      // The failure being thrown is the one that matters.
    }

    const frameCarriesIt = findingProject && isMachineOutput()

    if (!frameCarriesIt && !reportedBuildFailures.has(error)) {
      if (!printedBuildFailures.has(error)) {
        console.error(isDebug() ? error : messages.buildCommandFailed(error))
      }

      console.error(
        messages.buildFailed(
          failureCount,
          (error as {code?: unknown}).code === CODES.E_ZIP_SKIPPED
            ? displayPath(distPath)
            : undefined
        )
      )
    }

    // A failed build carried on past the same warnings a green one lists,
    // and the caller reads them off the rejection as it does off a summary.
    const warnings = [...new Set([...failureWarnings, ...takeCodedWarnings()])]

    if (warnings.length > 0) {
      try {
        Object.assign(error, {warnings})
      } catch {
        // Ignore
      }
    }

    // The caller owns the exit: a CLI maps this to its code, a host keeps
    // running.
    throw error
  } finally {
    process.removeListener('exit', dropStagingOnExit)

    if (nodeEnvChanged) {
      if (nodeEnvBefore === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnvBefore
    }

    // A host keeps neither once the build is over. A green `start` build
    // with a launch ahead hands both to its preview leg, which releases them.
    const previewFollows =
      succeeded &&
      buildOptions?.metadataCommand === 'start' &&
      buildOptions?.launchFollows === true

    const releaseBoth = () => {
      releaseCard?.()
      releaseEnv?.()
    }

    if (previewFollows) {
      parkForStartLaunch(pathOrRemoteUrl, projectRoot, releaseBoth)
    } else {
      releaseBoth()
    }

    await closeCompiler(compilerToClose)
  }
}

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
import type {Configuration} from '@rspack/core'
import {humanLine, stripAnsi} from './dev-server/lifecycle-stream'
import {
  buildNamesOversizeFiles,
  failedAddonLint,
  oversizeSingleFileLines,
  runAddonLint,
  summarizeAddonLint
} from './lib/addon-lint'
import {
  promoteStagingDist,
  removeStagingDir,
  removeStaleStagingDirs,
  stagingDistPathFor
} from './lib/atomic-dist'
import {holdsForeignFiles, protectedFolderAt} from './lib/build-output-guard'
import {type BuildSummary, getBuildSummary} from './lib/build-summary'
import {getBuildToolchain} from './lib/build-toolchain'
import {collectChunkDependencyProvenance} from './lib/chunk-dependency-provenance'
import {codedError} from './lib/coded-error'
import {
  keepCodedWarningsOf,
  outsideCodedWarnings,
  recordCodedWarning,
  takeCodedWarnings,
  withCodedWarnings
} from './lib/coded-warnings'
import {
  compilationDiagnostics,
  warningCodes
} from './lib/compilation-diagnostics'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadConfigResolvedHook,
  loadCustomConfig,
  loadProjectConfigDefaults
} from './lib/config-loader'
import {ConfigResolvedPlugin} from './lib/config-resolved-plugin'
import {removeDevelopmentArtifacts} from './lib/development-artifacts'
import {
  findDuplicateOutputFiles,
  importedAssetSources
} from './lib/duplicate-output-files'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {generateExtensionTypes} from './lib/generate-extension-types'
import {findLiveDevSession} from './lib/live-dev-session'
import {resolveLocalizedManifestName} from './lib/localized-manifest-name'
import {findLoopbackOrigins} from './lib/loopback-origins'
import {
  BUILD_COMMAND_DEFAULTS,
  mergeOptionLayers,
  START_BUILD_DEFAULTS
} from './lib/merge-options'
import * as messages from './lib/messages'
import {
  browserRowValue,
  CODES,
  card,
  claimCardKey,
  debugLine,
  holdHumanLines,
  isDebug,
  isMachineOutput
} from './lib/messaging'
import {applySplitChunksGuard} from './lib/normalize-split-chunks'
import {listOutputFiles} from './lib/output-files'
import {parseJsonSafe} from './lib/parse-json-safe'
import {
  asAskedPath,
  browserOptionOrThrow,
  collapseHomeDir,
  configBrowserOrThrow,
  displayPath,
  getBuildDistPath,
  getDirs,
  normalizeBrowser
} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {isSameOrInsidePath, isSamePath} from './lib/real-path'
import {resolveSafariIdentity} from './lib/safari-identity'
import {
  browserDistDir,
  buildSummaryPath,
  ensureSessionArtifactsIgnoreFile,
  ensureSessionStateInProjectGitignore
} from './lib/session-paths'
import {thrownFrom} from './lib/thrown-location'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {
  getZipArtifacts,
  getZipFailures
} from './plugin-compilation/zip-artifacts'
import {
  ensureTypeScriptConfig,
  isUsingTypeScript
} from './plugin-js-frameworks/js-tools/typescript'
import {
  stampReadyDistExtensionId,
  stampReadyKnownExtensionId
} from './plugin-playwright'
import {resolveCompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/resolve-config'
import type {CompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/types'
import {rememberExcludedFiles} from './plugin-special-folders/folders-config'
import {
  getSpecialFoldersDataForProjectRoot,
  rememberSpecialFoldersConfig
} from './plugin-special-folders/get-data'
import type {
  BuildOptions,
  CommonWebpackOptions,
  ConfigHookContext
} from './types'

const reportedBuildFailures = new WeakSet<object>()

// Failures whose own lines are on stderr already, the closing count aside.
const printedBuildFailures = new WeakSet<object>()

// The tap that prints the compile line, named by the compilation plugin.
const COMPILE_LINE_TAP = 'develop:brand'
const LAST_TAP_STAGE = 2147483647

// Projects whose toolchain sentence this process already printed.
const toolchainLinePrinted = new Set<string>()

// Specs build the same project more than once in one process.
export function resetBuildToolchainLine(): void {
  toolchainLinePrinted.clear()
}

// The card is the session header, printed before the first work line, and its
// key is what lets `start` dedupe the preview leg instead of reprinting.
function printBuildCard(
  manifestPath: string,
  browser: string,
  distPath: string,
  projectRoot: string
) {
  if (!claimCardKey(`${browser}::${nodePath.resolve(distPath)}`)) return

  let extensionLabel = ''

  try {
    const manifest = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))
    const name = resolveLocalizedManifestName(manifest, [
      nodePath.dirname(manifestPath),
      projectRoot
    ])
    const version = String(manifest?.version || '').trim()
    extensionLabel = name && version ? `${name} ${version}` : name
  } catch {
    // Ignore
  }

  const browserLabel = browserRowValue(String(browser || ''))
  const suffix = process.env.EXTENSION_CLI_UPDATE_SUFFIX || ''
  if (suffix) delete process.env.EXTENSION_CLI_UPDATE_SUFFIX

  humanLine(' ')
  humanLine(
    card({
      version:
        process.env.EXTENSION_DEVELOP_VERSION ||
        process.env.EXTENSION_CLI_VERSION,
      suffix,
      rows: [
        {label: 'Browser', value: browserLabel},
        {label: 'Extension', value: extensionLabel},
        {label: 'Output', value: collapseHomeDir(distPath)}
      ]
    })
  )

  humanLine(' ')
  process.env.EXTENSION_CLI_BANNER_PRINTED = 'true'
}

// The build retires and deletes whatever sits at <outDir>/<browser>, so the
// folder is checked before anything is written or removed.
function resolveOutDir(
  raw: unknown,
  packageJsonDir: string,
  browser: string
): string | undefined {
  if (raw === undefined || raw === null) return undefined

  if (typeof raw !== 'string' || !raw.trim()) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(String(raw), 'project-root')
    )
  }

  const value = raw.trim()
  const base = nodePath.resolve(packageJsonDir, value)

  if (isSamePath(base, packageJsonDir)) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(raw, 'project-root')
    )
  }

  const target = nodePath.join(base, browser)
  const baseRefusal = protectedFolderAt(base, packageJsonDir, {
    cwd: false,
    replaced: false
  })

  if (baseRefusal) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(value, baseRefusal, base)
    )
  }

  const targetRefusal = protectedFolderAt(target, packageJsonDir)

  if (targetRefusal) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(value, targetRefusal, target)
    )
  }

  if (holdsForeignFiles(target)) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildOutDirInvalid(
        value,
        'not-a-build',
        target,
        isSameOrInsidePath(packageJsonDir, target) ? 'inside' : 'outside'
      )
    )
  }

  return value
}

// A relative folder stays inside the project, and an absolute one is taken
// as meant. The browser folder ships whole, so no archive may sit in it.
function resolveZipDir(
  raw: unknown,
  packageJsonDir: string,
  distPath: string
): string | undefined {
  if (raw === undefined || raw === null) return undefined

  if (typeof raw !== 'string' || !raw.trim()) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildZipDirInvalid(String(raw), 'empty')
    )
  }

  const value = raw.trim()
  const resolved = nodePath.resolve(packageJsonDir, value)
  const fromProject = nodePath.relative(packageJsonDir, resolved)

  if (
    !nodePath.isAbsolute(value) &&
    (fromProject === '..' ||
      fromProject.startsWith(`..${nodePath.sep}`) ||
      nodePath.isAbsolute(fromProject))
  ) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildZipDirInvalid(value, 'outside', resolved)
    )
  }

  const fromDist = nodePath.relative(distPath, resolved)

  if (
    fromDist === '' ||
    (!fromDist.startsWith('..') && !nodePath.isAbsolute(fromDist))
  ) {
    throw codedError(
      CODES.E_INVALID_OPTION,
      messages.buildZipDirInvalid(value, 'inside-build')
    )
  }

  return resolved
}

// Reads the promoted manifest, so the warning names exactly what ships.
function warnProductionLoopbackOrigins(distPath: string, quiet: boolean): void {
  let manifest: unknown

  try {
    manifest = JSON.parse(
      fs.readFileSync(nodePath.join(distPath, 'manifest.json'), 'utf-8')
    )
  } catch {
    return
  }

  const origins = findLoopbackOrigins(manifest)
  if (origins.length === 0) return

  recordCodedWarning(
    CODES.E_PROD_LOOPBACK_ORIGIN,
    messages.productionLoopbackOriginsText(origins)
  )

  if (!quiet) console.warn(messages.productionLoopbackOrigins(origins))
}

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
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
  buildOptions: BuildOptions | undefined,
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
  let failureCount = 1
  let compilerToClose: {close?: (done: () => void) => void} | undefined
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

    // A browser passed in wins; with none, commands.<cmd>.browser from the
    // project config decides the target before the stock default does.
    const askedBrowser = browserOptionOrThrow(buildOptions?.browser)
    const namesBinary = Boolean(
      buildOptions?.chromiumBinary ||
        buildOptions?.geckoBinary ||
        buildOptions?.firefoxBinary ||
        buildOptions?.safariBinary
    )
    // A binary with no name picks its own family, so the stock default only
    // applies when neither was given.
    const browserFor = (named: typeof askedBrowser) =>
      normalizeBrowser(
        named || (namesBinary ? undefined : 'chromium'),
        buildOptions?.chromiumBinary,
        buildOptions?.geckoBinary || buildOptions?.firefoxBinary,
        buildOptions?.safariBinary
      )
    // The config reads the env files the bundle will, so its first load is
    // told the mode, and the browser whenever the config does not name it.
    const browser = askedBrowser
      ? browserFor(askedBrowser)
      : browserFor(
          configBrowserOrThrow(
            (
              await loadCommandConfig(packageJsonDir, commandKey, {
                mode: resolvedMode
              })
            ).browser,
            commandKey
          )
        )
    const envTarget = {mode: resolvedMode, browser: String(browser)}

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
    const userManifestPath =
      projectStructure.packageJsonPath || projectStructure.denoJsonPath

    if (userManifestPath) {
      assertNoManagedDependencyConflicts(userManifestPath, packageJsonDir)
    }

    const projectConfig = await loadProjectConfigDefaults(
      packageJsonDir,
      envTarget
    )
    const commandConfig = await loadCommandConfig(
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

    // The stock folder is replaced under the rule an asked one follows.
    if (!outDir && holdsForeignFiles(distPath)) {
      throw codedError(
        CODES.E_INVALID_OPTION,
        messages.buildOutputFolderForeign(distPath)
      )
    }

    // Assets are emitted into this staging sibling and a rename publishes it,
    // so an interrupted build can never leave a manifest without its pages.
    stagingDistPath = stagingDistPathFor(distPath)

    // A live dev session owns dist/<browser> the way a second dev session
    // learns it does: the files under it are what the browser is running, and
    // a production bundle written over them pulls the dev stubs and the control
    // file out from under that browser with no word to its owner. So the build
    // is refused, and --out-dir is the way to build beside the session. A build
    // elsewhere still leaves the session's ready.json and events alone.
    const liveDevSession = findLiveDevSession(packageJsonDir, browser)

    if (
      liveDevSession &&
      isSamePath(
        liveDevSession.distPath || browserDistDir(packageJsonDir, browser),
        distPath
      )
    ) {
      throw codedError(
        CODES.E_DEV_SESSION_DIST_SHARED,
        messages.buildSharesDevDist(
          browser,
          displayPath(distPath),
          liveDevSession.pid
        )
      )
    }

    const browserConfig = await loadBrowserConfig(
      packageJsonDir,
      browser,
      envTarget
    )
    const foldersConfig =
      commandConfig.folders ?? browserConfig.folders ?? projectConfig.folders
    rememberSpecialFoldersConfig(packageJsonDir, foldersConfig)

    const specialFoldersData = getSpecialFoldersDataForProjectRoot(
      packageJsonDir,
      foldersConfig
    )

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

    // After the folders and exclude config, so this check reads the entries
    // the compiler will and tsconfig.json never lands without its type file.
    ensureTypeScriptConfig(manifestDir, {
      manifestPath: projectStructure.manifestPath,
      browser
    })

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir, packageJsonDir, envTarget)
    }

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

    const mergedExtensionsConfig =
      buildOptions?.extensions ??
      commandConfig.extensions ??
      browserConfig.extensions ??
      projectConfig.extensions ??
      specialFoldersData.extensions
    // Nothing a build writes loads a companion. Only the start leg, whose
    // launch follows, resolves them, which is where a store download happens.
    const resolvedExtensionsConfig: CompanionExtensionsConfig | undefined =
      commandKey === 'start'
        ? await resolveCompanionExtensionsConfig({
            projectRoot: packageJsonDir,
            browser,
            config: mergedExtensionsConfig
          })
        : undefined

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

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...mergedBuildOptions,
      zipDir,
      extensions: resolvedExtensionsConfig,
      browser,
      mode: resolvedMode,
      // Opera Add-ons rejects minified first-party code on review.
      minify: mergedBuildOptions.minify ?? browser !== 'opera',
      metadataCommand: buildOptions?.metadataCommand || 'build',
      output: {
        clean: false,
        path: stagingDistPath,
        finalPath: distPath
      }
    })

    const buildPlugins = baseConfig.plugins?.filter((plugin) => {
      const name = plugin?.constructor.name

      return !(liveDevSession && name === 'plugin-playwright')
    })

    const hookContext: ConfigHookContext = {
      browser,
      mode: resolvedMode,
      command: buildOptions?.metadataCommand || 'build',
      rspack
    }
    const userExtensionConfig = await loadCustomConfig(
      packageJsonDir,
      hookContext
    )
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: buildPlugins
    })

    const compilerConfig = applySplitChunksGuard(userConfig)
    compilerConfig.stats = false

    const configResolved = await loadConfigResolvedHook(
      packageJsonDir,
      envTarget
    )

    if (configResolved) {
      compilerConfig.plugins = [
        ...(compilerConfig.plugins || []),
        new ConfigResolvedPlugin(configResolved, hookContext)
      ]
    }

    // A user config that re-points output.path opts out of the staging swap
    // and keeps the legacy direct-emit contract, where the bundler empties
    // the folder first. The bundler resolves a relative output.path against
    // the compiler context, never the shell's cwd, so the guard, the receipt
    // and the zip remap must resolve it the same way.
    const compileContext =
      typeof compilerConfig.context === 'string' && compilerConfig.context
        ? nodePath.resolve(compilerConfig.context)
        : packageJsonDir
    const mergedOutputPath =
      typeof compilerConfig.output?.path === 'string'
        ? nodePath.resolve(compileContext, compilerConfig.output.path)
        : ''
    const useStagingSwap =
      mergedOutputPath === nodePath.resolve(stagingDistPath)
    // The receipt must name the directory artifacts actually land in, which
    // under a re-pointed output.path is not dist/<browser>.
    const displayDistPath =
      useStagingSwap || !mergedOutputPath ? distPath : mergedOutputPath

    if (!useStagingSwap && mergedOutputPath) {
      const refusal = protectedFolderAt(mergedOutputPath, packageJsonDir)

      if (refusal) {
        throw codedError(
          CODES.E_INVALID_OPTION,
          messages.buildOutputPathRefused(mergedOutputPath, refusal)
        )
      }

      compilerConfig.output = {...compilerConfig.output, clean: true}
    }

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
    printCompileLineLast(compiler.hooks?.done)

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
        if (err) return reject(fatalFailure(err, packageJsonDir))

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
        try {
          printBuildCard(
            projectStructure.manifestPath,
            browser,
            displayDistPath,
            packageJsonDir
          )

          if (!silent) {
            const assetsTree = messages.buildAssetsTree(stats, outputFiles)
            if (assetsTree) humanLine(assetsTree)
          }
        } catch {
          // Ignore
        }

        if (!stats.hasErrors()) {
          // Publish the finished staging dir before any success receipt so a
          // green line is never printed over a half-populated dist.
          if (useStagingSwap && fs.existsSync(stagingDistPath)) {
            try {
              promoteStagingDist(stagingDistPath, distPath)
            } catch (promoteError) {
              return reject(
                Object.assign(
                  codedError(
                    CODES.E_DESTINATION_NOT_WRITABLE,
                    messages.buildOutputNotPublished(
                      displayPath(distPath),
                      promoteError
                    )
                  ),
                  {cause: promoteError}
                )
              )
            }

            if (!liveDevSession) {
              stampReadyDistExtensionId(packageJsonDir, browser, distPath)
            }
          }

          let keptArtifactsLine = ''

          if (buildType === 'production') {
            const pruned = removeDevelopmentArtifacts(displayDistPath)

            if (pruned.kept.length > 0) {
              keptArtifactsLine = messages.developmentArtifactsKept(
                displayDistPath,
                pruned.kept
              )

              if (!quiet) console.warn(keptArtifactsLine)
            }

            warnProductionLoopbackOrigins(displayDistPath, quiet)
          }

          // Anonymized aggregates (no filenames or paths)
          const info = stats?.toJson({
            all: false,
            assets: true,
            warnings: true,
            errors: true
          })

          // The summary names the folder the artifacts landed in, which under
          // a re-pointed output.path is not dist/<browser>.
          summary = {
            ...summary,
            ...getBuildSummary(
              browser,
              info,
              asAskedPath(displayDistPath),
              outputFiles,
              warningCodes(stats.compilation),
              packageJsonDir
            ),
            toolchain: getBuildToolchain()
          }

          // The setup steps and plugins said these on the human channel as
          // they ran; the summary carries them with the code each one names.
          const codedWarnings = takeCodedWarnings()

          if (codedWarnings.length > 0) {
            summary = {
              ...summary,
              warnings_count: summary.warnings_count + codedWarnings.length,
              warnings: [...(summary.warnings || []), ...codedWarnings]
            }
          }

          // A silent caller reads it here, where every other warning is.
          if (keptArtifactsLine) {
            summary = {
              ...summary,
              warnings_count: summary.warnings_count + 1,
              warnings: [
                ...(summary.warnings || []),
                stripAnsi(keptArtifactsLine)
              ]
            }
          }

          const distDisplay = displayPath(displayDistPath)

          const duplicateLines = duplicateGroups.map((group) =>
            messages.duplicateOutputFiles(
              distDisplay,
              group,
              importedAssetSources(stats.compilation, duplicateGroups)
            )
          )

          if (duplicateLines.length > 0) {
            summary = {
              ...summary,
              warnings_count: summary.warnings_count + duplicateLines.length,
              warnings: [
                ...(summary.warnings || []),
                ...duplicateLines.map((line) => stripAnsi(line))
              ]
            }
          }

          // Store readiness for Gecko targets: addons-linter runs over the
          // promoted dist and its findings join the warnings, never the
          // errors. A missing linter is one hint, a broken one says so, and
          // the summary records the outcome either way.
          const lintLines: string[] = []
          let namesOversizeFiles = false

          try {
            const lint = await runAddonLint({
              projectPath: packageJsonDir,
              distPath: displayDistPath,
              distDisplay,
              browser,
              mode: resolvedMode,
              enabled: mergedBuildOptions.addonLint,
              chunkProvenance: () =>
                collectChunkDependencyProvenance(stats.compilation),
              toolchain: summary.toolchain
            })

            summary = {...summary, addon_lint: summarizeAddonLint(lint)}
            namesOversizeFiles = buildNamesOversizeFiles(lint, {
              browser,
              mode: resolvedMode
            })

            if (lint.status === 'missing') {
              if (lint.hint) lintLines.push(lint.hint)
            } else if (lint.status === 'failed') {
              lintLines.push(lint.line)
              if (isDebug()) lintLines.push(lint.debugLine)
            } else if (lint.status === 'linted' && lint.findings > 0) {
              lintLines.push(...lint.lines)
              // Printed, never a warning: it only says where the note is.
              if (lint.reviewerNote) lintLines.push(lint.reviewerNote.line)

              summary = {
                ...summary,
                warnings_count: summary.warnings_count + lint.findings,
                warnings: [
                  ...(summary.warnings || []),
                  ...lint.lines.map((line) => stripAnsi(line))
                ]
              }
            }
          } catch (lintError) {
            // A store check can never fail a green build.
            const lint = failedAddonLint(lintError, distDisplay)
            summary = {...summary, addon_lint: summarizeAddonLint(lint)}
            lintLines.push(lint.line)
            namesOversizeFiles = true
          }

          // A script over the store's parse limit is named by the store
          // check. With no answer, or the check off, the build names it.
          if (namesOversizeFiles) {
            const sizeLines = oversizeSingleFileLines(displayDistPath)

            if (sizeLines.length > 0) {
              lintLines.push(...sizeLines)
              summary = {
                ...summary,
                warnings_count: summary.warnings_count + sizeLines.length,
                warnings: [
                  ...(summary.warnings || []),
                  ...sizeLines.map((line) => stripAnsi(line))
                ]
              }
            }
          }

          // The docs tell a reader to take the archive path from the build
          // output rather than compose it, so the machine surfaces carry it.
          const zipArtifacts = getZipArtifacts(stats.compilation).map(
            (artifact) => ({
              kind: artifact.kind,
              path: asAskedPath(
                useStagingSwap && artifact.path.startsWith(stagingDistPath)
                  ? distPath + artifact.path.slice(stagingDistPath.length)
                  : artifact.path
              ),
              size: artifact.size
            })
          )

          if (zipArtifacts.length > 0) {
            summary = {...summary, zip_artifacts: zipArtifacts}
          }

          // An archive the caller asked for and did not get is a failure, not a
          // warning: `build --zip && upload dist/*.zip` used to exit 0 with none.
          // It is settled here, so neither the summary on disk nor the closer
          // below ever calls this build a success.
          const zipFailures = getZipFailures(stats.compilation)

          if (zipFailures.length > 0) {
            summary = {
              ...summary,
              errors_count: zipFailures.length,
              errors: zipFailures.map(
                (failure) =>
                  `${CODES.E_ZIP_SKIPPED}: ${messages.zipArtifactNotCreatedText(
                    failure.kind,
                    displayPath(failure.path),
                    failure.reason
                  )}`
              )
            }
          }

          // Hosts that shell out to `extension build` cannot see the returned
          // summary, so persist it next to ready.json. Best-effort only.
          try {
            const summaryFile = buildSummaryPath(packageJsonDir, browser)
            fs.mkdirSync(nodePath.dirname(summaryFile), {recursive: true})
            ensureSessionArtifactsIgnoreFile(packageJsonDir)
            ensureSessionStateInProjectGitignore(packageJsonDir)
            fs.writeFileSync(summaryFile, JSON.stringify(summary))
          } catch {
            // Never fail a green build over the informational contract.
          }

          if (zipFailures.length > 0) {
            failureCount = zipFailures.length
            failureWarnings = summary.warnings || []

            return reject(
              codedError(
                CODES.E_ZIP_SKIPPED,
                zipFailures
                  .map((failure) =>
                    messages.zipArtifactNotCreated(
                      failure.kind,
                      displayPath(failure.path),
                      failure.reason
                    )
                  )
                  .join('\n')
              )
            )
          }

          if ((info?.warnings || []).length > 0) {
            // Emit-time warnings already printed when the plugin acted; the
            // summary keeps them all so the json record stays complete.
            const warningDetails = messages.buildWarningsDetails(
              (info?.warnings || []).filter(
                (warning) => !isEmitTimeWarning(warning)
              )
            )

            if (warningDetails) {
              humanLine(warningDetails)
            }
          }

          for (const line of duplicateLines) humanLine(line)
          for (const line of lintLines) humanLine(line)

          if (
            resolvedMode === 'production' &&
            browser === 'opera' &&
            mergedBuildOptions.minify === undefined
          ) {
            humanLine(messages.operaBuildUnminified())
          }

          humanLine(
            messages.buildComplete(
              browser,
              distDisplay,
              summary.total_bytes,
              resolvedMode,
              summary.source_map_bytes
            )
          )

          // The versions a store reviewer has to rebuild under to get these
          // bytes back; the ids inside the bundles depend on the lockfile too.
          // One process builds every target with the same toolchain, so
          // `--browser all` reads the sentence once, not after every browser.
          if (
            resolvedMode === 'production' &&
            summary.toolchain &&
            !toolchainLinePrinted.has(packageJsonDir)
          ) {
            toolchainLinePrinted.add(packageJsonDir)
            humanLine(messages.buildToolchain(summary.toolchain))
          }

          for (const artifact of zipArtifacts) {
            const zipDisplay = displayPath(artifact.path)
            humanLine(messages.zipArtifactReady(zipDisplay, artifact.size))
          }

          resolve()
        } else {
          // A failed compile keeps the last-good dist: nothing was written to
          // dist/<browser>, only the staging dir, which is discarded here.
          removeStagingDir(stagingDistPath)
          handleStatsErrors(stats)

          let errorCount = 1

          try {
            const info = stats.toJson({all: false, errors: true})
            errorCount = Math.max(1, info?.errors?.length || 1)
          } catch {
            // Ignore
          }

          console.error(messages.buildFailed(errorCount))

          const {details, truncated} = compilationDiagnostics(
            stats.compilation,
            packageJsonDir
          )

          try {
            failureWarnings =
              getBuildSummary(
                browser,
                stats.toJson({all: false, warnings: true}),
                undefined,
                undefined,
                warningCodes(stats.compilation)
              ).warnings || []
          } catch {
            // Ignore
          }

          const failure = Object.assign(new Error('Build failed with errors'), {
            code: CODES.E_COMPILE,
            diagnostics: details,
            truncated
          })
          reportedBuildFailures.add(failure)

          return reject(failure)
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
      if (!fs.existsSync(displayDistPath)) {
        throw codedError(
          CODES.E_PREVIEW_NO_DIST,
          messages.safariBuildOutputNotFound(displayDistPath)
        )
      }

      let safari: Awaited<ReturnType<typeof safariPackager>>

      try {
        safari = await safariPackager(displayDistPath, 'full', safariIdentity)
      } catch (packagerError) {
        // The packager prints a failed tool itself, with that tool's output.
        if (
          packagerError instanceof Error &&
          (packagerError as {code?: unknown}).code === CODES.E_SAFARI_TOOLCHAIN
        ) {
          printedBuildFailures.add(packagerError)
        }

        throw packagerError
      }

      // The app identity (and whether the bundle id was generated rather than
      // user-owned) was a human log line only. Fold it into the summary so a
      // programmatic caller does not have to read project.pbxproj to learn it.
      if (safari) {
        summary = {...summary, safari}

        try {
          fs.writeFileSync(
            buildSummaryPath(packageJsonDir, browser),
            JSON.stringify(summary)
          )
        } catch {
          // Never fail a green build over the informational contract.
        }

        // Safari registers the extension under the appex identity,
        // `<bundleId>.Extension`, so that is the truthful ready.json id.
        if (safari.bundleId && !liveDevSession) {
          stampReadyKnownExtensionId(
            packageJsonDir,
            browser,
            `${safari.bundleId}.Extension`
          )
        }
      }
    }

    return summary
  } catch (thrown) {
    if (stagingDistPath) removeStagingDir(stagingDistPath)

    // The line below and every caller read the message of the failure, so a
    // thrown value with none is wrapped before it is printed and passed on.
    const error = readableFailure(thrown, projectRoot)

    const frameCarriesIt = findingProject && isMachineOutput()

    if (!frameCarriesIt && !reportedBuildFailures.has(error)) {
      if (!printedBuildFailures.has(error)) {
        console.error(isDebug() ? error : messages.buildCommandFailed(error))
      }

      console.error(messages.buildFailed(failureCount))
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
    if (nodeEnvChanged) {
      if (nodeEnvBefore === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = nodeEnvBefore
    }

    await closeCompiler(compilerToClose)
  }
}

function readableFailure(thrown: unknown, projectRoot: string): Error {
  try {
    if (thrown instanceof Error && typeof thrown.message === 'string') {
      if (thrown.message.trim()) return thrown

      // An empty message prints as the bare word Error, so the place it was
      // thrown from stands in for it and the declared code is kept.
      return Object.assign(
        new Error(
          messages.errorWithoutMessageText(thrownFrom(thrown, projectRoot))
        ),
        {cause: thrown},
        hasDeclaredCode(thrown) ? {code: (thrown as {code?: unknown}).code} : {}
      )
    }
  } catch {
    // Ignore
  }

  return Object.assign(new Error(messages.thrownValueText(thrown)), {
    cause: thrown
  })
}

// A throw from a plugin or from the bundler itself, with no compile error
// behind it. A code the thrower declared is the answer it meant.
function fatalFailure(thrown: unknown, projectRoot: string): Error {
  const failure = readableFailure(thrown, projectRoot)

  if (hasDeclaredCode(failure)) return failure

  return Object.assign(codedError(CODES.E_COMPILE_FATAL, failure.message), {
    cause: thrown
  })
}

// The compile line is the receipt of a compile that went through, so it runs
// after every other tap that can still fail the build.
function printCompileLineLast(
  done: {taps?: Array<{name?: string; stage?: number}>} | undefined
): void {
  const taps = done?.taps
  if (!Array.isArray(taps)) return

  const at = taps.findIndex((tap) => tap?.name === COMPILE_LINE_TAP)
  if (at === -1) return

  const [tap] = taps.splice(at, 1)

  tap.stage = LAST_TAP_STAGE
  taps.push(tap)
}

function hasDeclaredCode(error: unknown): boolean {
  const code = (error as {code?: unknown} | null)?.code

  return (
    typeof code === 'string' &&
    Object.prototype.hasOwnProperty.call(CODES, code)
  )
}

// A compiler left open keeps its watchers and cache handles in the host.
async function closeCompiler(
  compiler: {close?: (done: () => void) => void} | undefined
): Promise<void> {
  if (typeof compiler?.close !== 'function') return

  try {
    await new Promise<void>((resolve) => compiler.close?.(() => resolve()))
  } catch {
    // Ignore
  }
}

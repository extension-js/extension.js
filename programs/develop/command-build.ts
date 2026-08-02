// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as nodePath from 'node:path'
import type {Configuration} from '@rspack/core'
import {humanLine} from './dev-server/lifecycle-stream'
import {type BuildSummary, getBuildSummary} from './lib/build-summary'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomConfig
} from './lib/config-loader'
import {
  ensureDevelopArtifacts,
  ensureUserProjectDependencies
} from './lib/ensure-develop-artifacts'
import {generateExtensionTypes} from './lib/generate-extension-types'
import * as messages from './lib/messages'
import {browserRowValue, card, claimCardKey, isDebug} from './lib/messaging'
import {parseJsonSafe} from './lib/parse-json-safe'
import {getDirs, getDistPath, normalizeBrowser} from './lib/paths'
import {getProjectStructure} from './lib/project'
import {
  buildSummaryPath,
  ensureSessionArtifactsIgnoreFile,
  ensureSessionStateInProjectGitignore
} from './lib/session-paths'
import {assertNoManagedDependencyConflicts} from './lib/validate-user-dependencies'
import {getZipArtifacts} from './plugin-compilation/zip-artifacts'
import {
  ensureTypeScriptConfig,
  isUsingTypeScript
} from './plugin-js-frameworks/js-tools/typescript'
import {resolveCompanionExtensionsConfig} from './plugin-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from './plugin-special-folders/get-data'
import type {BuildOptions} from './types'

function collapseHomeDir(value: string): string {
  const home = os.homedir()
  if (!home || !value.startsWith(home)) return value
  const rest = value.slice(home.length)
  if (rest === '') return '~'
  if (rest.startsWith(nodePath.sep) || rest.startsWith('/')) return `~${rest}`
  return value
}

function relativeToCwd(target: string): string | null {
  const relative = nodePath.relative(process.cwd(), target)
  if (
    relative &&
    !relative.startsWith('..') &&
    !nodePath.isAbsolute(relative)
  ) {
    return relative
  }
  return null
}

const reportedBuildFailures = new WeakSet<object>()

// The card is the session header, printed before the first work line, and its
// key is what lets `start` dedupe the preview leg instead of reprinting.
function printBuildCard(
  manifestPath: string,
  browser: string,
  distPath: string
) {
  if (!claimCardKey(`${browser}::${nodePath.resolve(distPath)}`)) return

  let extensionLabel = ''
  try {
    const manifest = parseJsonSafe(fs.readFileSync(manifestPath, 'utf-8'))
    const name = String(manifest?.name || '').trim()
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

export async function extensionBuild(
  pathOrRemoteUrl: string | undefined,
  buildOptions?: BuildOptions
): Promise<BuildSummary> {
  const projectStructure = await getProjectStructure(pathOrRemoteUrl)
  const isVitest = process.env.VITEST === 'true'
  // The CLI wrapper passes exitOnError=true; as a library import a failed
  // build must be a rejected promise, never a process.exit inside the host.
  const shouldExitOnError = (buildOptions?.exitOnError ?? false) && !isVitest
  const browser = normalizeBrowser(
    buildOptions?.browser || 'chrome',
    buildOptions?.chromiumBinary,
    buildOptions?.geckoBinary || buildOptions?.firefoxBinary
  )

  const {manifestDir, packageJsonDir} = getDirs(projectStructure)
  const distPath = getDistPath(packageJsonDir, browser)
  const isAuthor = isDebug()

  try {
    await ensureDevelopArtifacts()
    if (buildOptions?.install !== false) {
      await ensureUserProjectDependencies(packageJsonDir)
    }

    ensureTypeScriptConfig(manifestDir)

    if (isUsingTypeScript(manifestDir)) {
      await generateExtensionTypes(manifestDir, packageJsonDir)
    }

    // Heavy deps are intentionally imported lazily so `preview` can run with a minimal install.
    const [
      {rspack},
      {merge},
      {handleStatsErrors, isEmitTimeWarning},
      {default: webpackConfig}
    ] = await Promise.all([
      import('@rspack/core'),
      import('webpack-merge'),
      import('./lib/stats-handler'),
      import('./rspack-config')
    ])

    const debug = isAuthor
    const userManifestPath =
      projectStructure.packageJsonPath || projectStructure.denoJsonPath
    if (userManifestPath) {
      assertNoManagedDependencyConflicts(userManifestPath, manifestDir)
    }

    const commandConfig = await loadCommandConfig(packageJsonDir, 'build')
    const specialFoldersData =
      getSpecialFoldersDataForProjectRoot(packageJsonDir)

    // Vite-style `emptyOutDir`: wipe the per-browser dist before the build so
    // output is deterministic despite stale hashed bundles from prior dev runs.
    try {
      fs.rmSync(distPath, {recursive: true, force: true})
    } catch {
      // Best-effort; rspack will still emit into the directory.
    }

    if (debug) {
      console.log(messages.debugDirs(manifestDir, packageJsonDir))
      console.log(
        messages.debugBrowser(
          browser,
          buildOptions?.chromiumBinary,
          buildOptions?.geckoBinary || buildOptions?.firefoxBinary
        )
      )
      console.log(messages.debugOutputPath(distPath))
    }

    const mergedExtensionsConfig =
      buildOptions?.extensions ??
      commandConfig.extensions ??
      specialFoldersData.extensions
    const resolvedExtensionsConfig = await resolveCompanionExtensionsConfig({
      projectRoot: packageJsonDir,
      browser,
      config: mergedExtensionsConfig
    })

    const resolvedMode: 'development' | 'production' | 'none' =
      buildOptions?.mode === 'development' ||
      buildOptions?.mode === 'none' ||
      buildOptions?.mode === 'production'
        ? buildOptions.mode
        : 'production'
    if (resolvedMode === 'development' || resolvedMode === 'production') {
      process.env.NODE_ENV = resolvedMode
    }

    const baseConfig: Configuration = webpackConfig(projectStructure, {
      ...commandConfig,
      ...buildOptions,
      extensions: resolvedExtensionsConfig,
      browser,
      mode: resolvedMode,
      metadataCommand: buildOptions?.metadataCommand || 'build',
      output: {
        clean: true,
        path: distPath
      }
    })

    const allPluginsButBrowserRunners = baseConfig.plugins?.filter((plugin) => {
      return plugin?.constructor.name !== 'plugin-browsers'
    })

    const userExtensionConfig = await loadCustomConfig(packageJsonDir)
    const userConfig = userExtensionConfig({
      ...baseConfig,
      plugins: allPluginsButBrowserRunners
    })

    const compilerConfig = merge(userConfig)
    compilerConfig.stats = false
    const compiler = rspack(compilerConfig)

    let summary: BuildSummary = {
      browser,
      output_path: distPath,
      total_assets: 0,
      total_bytes: 0,
      largest_asset_bytes: 0,
      warnings_count: 0,
      errors_count: 0
    }

    await new Promise<void>((resolve, reject) => {
      compiler.run(async (err, stats) => {
        if (err) {
          console.error(err.stack || err)
          return reject(err)
        }

        // Guard against silent-success scenarios where the bundler callback
        // does not provide stats, which means we cannot trust emission output.
        if (!stats || typeof stats.hasErrors !== 'function') {
          return reject(
            new Error(
              'Build failed: bundler returned invalid stats output (no reliable compilation result).'
            )
          )
        }

        // The identity card and asset tree are informational; a throw here
        // would leave this promise pending and the process would exit 0.
        try {
          printBuildCard(projectStructure.manifestPath, browser, distPath)

          if (!buildOptions?.silent) {
            const assetsTree = messages.buildAssetsTree(stats)
            if (assetsTree) humanLine(assetsTree)
          }
        } catch {
          // Ignore
        }

        if (!stats.hasErrors()) {
          // Anonymized aggregates (no filenames or paths)
          const info = stats?.toJson({
            all: false,
            assets: true,
            warnings: true,
            errors: true
          })

          summary = getBuildSummary(browser, info, distPath)

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

          if (summary.warnings_count > 0) {
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

          const distDisplay =
            relativeToCwd(distPath) || collapseHomeDir(distPath)
          humanLine(
            messages.buildComplete(browser, distDisplay, summary.total_bytes)
          )

          for (const artifact of getZipArtifacts(stats.compilation)) {
            const zipDisplay = relativeToCwd(artifact.path) || artifact.path
            humanLine(messages.zipArtifactReady(zipDisplay, artifact.size))
          }
          humanLine(messages.buildShareHint())
          resolve()
        } else {
          handleStatsErrors(stats)

          let errorCount = 1
          try {
            const info = stats.toJson({all: false, errors: true})
            errorCount = Math.max(1, info?.errors?.length || 1)
          } catch {
            // Ignore
          }
          console.error(messages.buildFailed(errorCount))

          if (!shouldExitOnError) {
            const failure = new Error('Build failed with errors')
            reportedBuildFailures.add(failure)
            return reject(failure)
          }
          process.exit(1)
        }
      })
    })

    // Safari is packaged from the freshly built dist; the packager is injected
    // by the CLI so develop stays decoupled. CLI flags win over `browser.safari`.
    if (
      (browser === 'safari' || browser === 'webkit-based') &&
      buildOptions?.safariPackager
    ) {
      const safariConfig = await loadBrowserConfig(packageJsonDir, browser)

      const safari = await buildOptions.safariPackager(distPath, 'full', {
        appName: buildOptions.appName ?? safariConfig.appName,
        bundleId: buildOptions.bundleId ?? safariConfig.bundleId,
        macOsOnly: buildOptions.macOsOnly ?? safariConfig.macOsOnly,
        forceRegenerate: buildOptions.forceRegenerate,
        safariBinary: buildOptions.safariBinary ?? safariConfig.safariBinary
      })

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
      }
    }

    return summary
  } catch (error) {
    const alreadyReported =
      error instanceof Error && reportedBuildFailures.has(error)
    if (!alreadyReported) {
      if (isDebug()) {
        console.error(error)
      } else {
        console.error(messages.buildCommandFailed(error))
      }
      console.error(messages.buildFailed(1))
    }
    if (!shouldExitOnError) {
      throw error
    }
    process.exit(1)
  }
}

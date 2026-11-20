// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as nodePath from 'node:path'
import type {Configuration, rspack as Rspack} from '@rspack/core'
import {protectedFolderAt} from '../lib/build-output-guard'
import {codedError} from '../lib/coded-error'
import type {CompanionExtensionsConfig} from '../lib/companion-extensions/types'
import {
  type ConfigEnvTarget,
  loadConfigResolvedHook,
  loadCustomConfig
} from '../lib/config-loader'
import {ConfigResolvedPlugin} from '../lib/config-resolved-plugin'
import * as messages from '../lib/messages'
import {CODES} from '../lib/messaging'
import {applySplitChunksGuard} from '../lib/normalize-split-chunks'
import type {NormalizedBrowser} from '../lib/paths'
import type {ProjectStructure} from '../lib/project'
import type {
  BuildOptions,
  ConfigHookContext,
  WebpackConfigOptions
} from '../types'

// Builds the compiler config of one build: the stock config, the author's
// config hooks over it, and where the output really lands.
export async function createBuildCompilerConfig(input: {
  buildOptions: BuildOptions | undefined
  mergedBuildOptions: BuildOptions
  zipDir: string | undefined
  resolvedExtensionsConfig: CompanionExtensionsConfig | undefined
  browser: NormalizedBrowser
  resolvedMode: 'development' | 'production' | 'none'
  stagingDistPath: string
  distPath: string
  projectStructure: ProjectStructure
  packageJsonDir: string
  envTarget: ConfigEnvTarget
  liveDevSession: unknown
  rspack: typeof Rspack
  webpackConfig: (
    projectStructure: ProjectStructure,
    options: WebpackConfigOptions
  ) => Configuration
}) {
  const {
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
  } = input

  const metadataCommand = buildOptions?.metadataCommand || 'build'
  const configOptions: WebpackConfigOptions = {
    ...mergedBuildOptions,
    zipDir,
    extensions: resolvedExtensionsConfig,
    browser,
    mode: resolvedMode,
    // Opera Add-ons rejects minified first-party code on review.
    minify: mergedBuildOptions.minify ?? browser !== 'opera',
    metadataCommand,
    // The compile ends with the output still in staging, so the plugin
    // stamps the compile only and this command says ready once it is placed.
    launchFollows: true,
    output: {
      clean: false,
      path: stagingDistPath,
      finalPath: distPath
    }
  }
  const baseConfig: Configuration = webpackConfig(
    projectStructure,
    configOptions
  )

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

  const configResolved = await loadConfigResolvedHook(packageJsonDir, envTarget)

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
  const useStagingSwap = mergedOutputPath === nodePath.resolve(stagingDistPath)
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

  return {
    metadataCommand,
    configOptions,
    compilerConfig,
    useStagingSwap,
    displayDistPath
  }
}

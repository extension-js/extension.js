// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {rspack} from '@rspack/core'
import {RspackDevServer, Configuration} from '@rspack/dev-server'
import {merge} from 'webpack-merge'
import * as messages from './messages'
import {PortManager} from './port-manager'
import {isUsingJSFramework} from './frameworks'
import {type ProjectStructure} from '../webpack-lib/project'
import {
  loadBrowserConfig,
  loadCommandConfig,
  loadCustomWebpackConfig
} from '../webpack-lib/config-loader'
import {resolveCompanionExtensionsConfig} from '../feature-special-folders/folder-extensions/resolve-config'
import {getSpecialFoldersDataForProjectRoot} from '../feature-special-folders/get-data'
import {sanitize} from '../webpack-lib/sanitize'
import {setupCompilerHooks} from './compiler-hooks'
import {setupCleanupHandlers} from './cleanup'
import webpackConfig from '../webpack-config'
import type {DevOptions} from '../webpack-types'

export async function devServer(
  projectStructure: ProjectStructure,
  devOptions: DevOptions
) {
  process.env.EXTENSION_BROWSER_RUNNER_ENABLED = devOptions.noRunner ? '0' : '1'

  const {manifestPath, packageJsonPath} = projectStructure
  const manifestDir = path.dirname(manifestPath)
  const packageJsonDir = path.dirname(packageJsonPath!)

  // Get command defaults from extension.config.js (located at project root)
  const commandConfig = await loadCommandConfig(packageJsonDir, 'dev')
  // Get browser defaults from extension.config.js (located at project root)
  const browserConfig = await loadBrowserConfig(
    packageJsonDir,
    devOptions.browser
  )

  // Initialize port manager and allocate ports for this instance
  const portManager = new PortManager(devOptions.browser, packageJsonDir, 8080)
  const desiredPort =
    typeof devOptions.port === 'string'
      ? parseInt(devOptions.port, 10)
      : devOptions.port
  const portAllocation = await portManager.allocatePorts(
    devOptions.browser,
    packageJsonDir,
    desiredPort
  )

  const currentInstance = portManager.getCurrentInstance()

  if (!currentInstance) {
    throw new Error('Failed to create instance')
  }

  const port = portAllocation.port
  const devServerHost = '127.0.0.1'
  const devServerWebSocketURL = {
    protocol: 'ws',
    hostname: devServerHost,
    port
  }

  // Get the user defined args and merge with the Extension.js base webpack config
  // Avoid overriding file-config values with undefined from CLI args
  const safeBrowserConfig = sanitize(browserConfig)
  const safeCommandConfig = sanitize(commandConfig)
  const safeDevOptions = sanitize(devOptions)
  const specialFoldersData = getSpecialFoldersDataForProjectRoot(packageJsonDir)

  const mergedExtensionsConfig =
    safeDevOptions.extensions ??
    safeCommandConfig.extensions ??
    safeBrowserConfig.extensions ??
    specialFoldersData.extensions
  const resolvedExtensionsConfig = await resolveCompanionExtensionsConfig({
    projectRoot: packageJsonDir,
    browser: devOptions.browser,
    config: mergedExtensionsConfig
  })

  const baseConfig = webpackConfig(projectStructure, {
    ...safeBrowserConfig,
    ...safeCommandConfig,
    ...safeDevOptions,
    extensions: resolvedExtensionsConfig,
    browser: devOptions.browser,
    mode: 'development' as any,
    instanceId: currentInstance.instanceId,
    port: portAllocation.port,
    output: {
      clean: false,
      path: path.join(packageJsonDir, 'dist', devOptions.browser)
    }
  })

  // Get webpack config defaults from extension.config.js
  const customWebpackConfig = await loadCustomWebpackConfig(manifestDir)
  const finalConfig = customWebpackConfig(baseConfig)

  // Use merge to combine the base config with the custom config.
  // This way if the user define properties we don't have a default for,
  // they will be included in the final config.
  const compilerConfig = merge(finalConfig, {})

  // CRITICAL: Ensure the HMR client embedded in extension scripts uses our dev-server
  // host/port, not the current page's host/port (which can be e.g. localhost:8080).
  ;(compilerConfig as any).devServer = {
    ...((compilerConfig as any).devServer || {}),
    host: devServerHost,
    port,
    client: {
      ...(((compilerConfig as any).devServer || {}).client || {}),
      webSocketURL: {
        ...((((compilerConfig as any).devServer || {}).client || {})
          .webSocketURL || {}),
        ...devServerWebSocketURL
      }
    }
  }
  const compiler = rspack(compilerConfig)

  // Surface bundler diagnostics during startup (even if start() hangs)
  setupCompilerHooks(compiler, portAllocation.port)

  // Log port information only in verbose mode
  if (typeof devOptions.port !== 'undefined' && devOptions.port !== port) {
    console.log(messages.portInUse(devOptions.port as number, port))
  }

  // webpack-dev-server configuration
  const serverConfig: Configuration = {
    host: devServerHost,
    allowedHosts: 'all',
    static: {
      directory: path.join(packageJsonDir, 'public'),
      watch: false
    },
    compress: false,
    devMiddleware: {
      writeToDisk: true,
      // Ensure no server-side stats spam leaks to users
      stats: false
    },
    watchFiles: {
      paths: [
        path.join(packageJsonDir, 'public', '**/*'),
        ...(isUsingJSFramework(packageJsonDir)
          ? []
          : [path.join(packageJsonDir, '**/*.html')])
      ],
      options: {
        // Prevent startup self-rebuild: initial emit writes dist/**/*.html.
        // Those generated files must not be treated as source watch inputs.
        ignored: [path.join(packageJsonDir, 'dist', '**/*')],
        // Avoid a startup recompile caused by chokidar "add" events for
        // existing files in watched folders.
        ignoreInitial: true,
        usePolling: true,
        interval: 1000
      }
    },
    client: {
      // Do not surface bundler/dev-server names to end users
      logging: 'none',
      progress: false,
      overlay: false,
      webSocketURL: devServerWebSocketURL
    },
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    port,
    // Use HMR "only" mode globally so the injected hot runtime does NOT hard-reload the page
    // when HMR can't apply updates (important for content scripts to avoid infinite reload loops).
    hot: 'only',
    // Keep liveReload enabled so extension pages can still recover via full reload
    // (we selectively disable hot for those pages via a dev-only runtime patch).
    liveReload: true
  }

  const devServer = new RspackDevServer(serverConfig, compiler)

  // Startup watchdog to surface hangs
  const START_TIMEOUT_MS = parseInt(
    String(process.env.EXTENSION_START_TIMEOUT_MS || '30000'),
    10
  )
  let startTimeout: NodeJS.Timeout | undefined

  try {
    startTimeout = setTimeout(() => {
      console.error(messages.devServerStartTimeout(START_TIMEOUT_MS))
    }, START_TIMEOUT_MS)

    await devServer.start()

    if (startTimeout) clearTimeout(startTimeout)

    console.log(messages.ready('development', devOptions.browser))

    if (devOptions.noRunner) {
      console.log(messages.browserRunnerDisabled())
    }
  } catch (error) {
    if (startTimeout) clearTimeout(startTimeout)

    console.log(messages.extensionJsRunnerError(error))
    process.exit(1)
  }

  // Setup cleanup handlers for graceful shutdown
  setupCleanupHandlers(devServer, portManager)
}

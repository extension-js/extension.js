// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  type ConfigEnvTarget,
  loadCommandConfig,
  loadProjectConfigDefaults
} from '../lib/config-loader'
import {generateExtensionTypes} from '../lib/generate-extension-types'
import {
  type BrowserInput,
  configBrowserOrThrow,
  type NormalizedBrowser,
  normalizeBrowser
} from '../lib/paths'
import type {ProjectStructure} from '../lib/project'
import {assertNoManagedDependencyConflicts} from '../lib/validate-user-dependencies'
import {
  ensureTypeScriptConfig,
  isUsingTypeScript
} from '../plugin-js-frameworks/js-tools/typescript'
import type {LogOptions} from '../types'

type Command = 'dev' | 'build' | 'start' | 'preview'

// A dependency Extension.js manages and the project also lists is refused
// before any command builds or runs with two copies of it.
export function refuseManagedDependencyConflicts(
  projectStructure: ProjectStructure,
  packageJsonDir: string
): void {
  const userManifestPath =
    projectStructure.packageJsonPath || projectStructure.denoJsonPath

  if (userManifestPath) {
    assertNoManagedDependencyConflicts(userManifestPath, packageJsonDir)
  }
}

// A browser passed in wins. With none, commands.<command>.browser from the
// project config decides the target before the stock default does. That
// config read sees the env files of the browser that runs when it names none.
export async function resolveCommandBrowser(options: {
  asked: BrowserInput | undefined
  command: Command
  chromiumBinary?: string
  geckoBinary?: string
  safariBinary?: string
  configBrowser: (stockBrowser: string) => Promise<unknown>
}): Promise<NormalizedBrowser> {
  const {asked, command, chromiumBinary, geckoBinary, safariBinary} = options
  const namesBinary = Boolean(chromiumBinary || geckoBinary || safariBinary)
  // A binary with no name picks its own family, so the stock default only
  // applies when neither was given.
  const browserFor = (named: BrowserInput | undefined) =>
    normalizeBrowser(
      named || (namesBinary ? undefined : 'chromium'),
      chromiumBinary,
      geckoBinary,
      safariBinary
    )

  return asked
    ? browserFor(asked)
    : browserFor(
        configBrowserOrThrow(
          await options.configBrowser(String(browserFor(undefined))),
          command
        )
      )
}

// The top-level config, then the command's own, each reading the env files
// the bundle will.
export async function loadProjectAndCommandConfig(
  packageJsonDir: string,
  command: Command,
  envTarget: ConfigEnvTarget
) {
  const projectConfig = await loadProjectConfigDefaults(
    packageJsonDir,
    envTarget
  )
  const commandConfig = await loadCommandConfig(
    packageJsonDir,
    command,
    envTarget
  )

  return {projectConfig, commandConfig}
}

// Runs after the folders and exclude config are remembered, so the check
// reads the entries the compiler will and tsconfig.json never lands without
// its type file.
export async function prepareProjectTypes(input: {
  manifestDir: string
  packageJsonDir: string
  manifestPath: string
  browser: NormalizedBrowser
  envTarget: ConfigEnvTarget
}): Promise<void> {
  const {manifestDir, packageJsonDir, manifestPath, browser, envTarget} = input

  ensureTypeScriptConfig(manifestDir, {manifestPath, browser})

  if (isUsingTypeScript(manifestDir)) {
    await generateExtensionTypes(manifestDir, packageJsonDir, envTarget)
  }
}

// The log settings a launcher receives, in the order every command lists them.
export function logOptionsOf(merged: LogOptions): LogOptions {
  return {
    logLevel: merged.logLevel,
    logContexts: merged.logContexts,
    logFormat: merged.logFormat,
    logTimestamps: merged.logTimestamps,
    logColor: merged.logColor,
    logUrl: merged.logUrl,
    logTab: merged.logTab
  }
}

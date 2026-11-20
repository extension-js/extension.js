// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {recordCodedWarning} from '../lib/coded-warnings'
import {STOCK_COMPANION_EXTENSIONS} from '../lib/constants'
import {
  companionsDeclaredIn,
  isFirstCompanionWarning,
  unresolvedNamedCompanions
} from '../lib/extensions-to-load'
import {CODES, stripChannelPrefix} from '../lib/messaging'
import type {NormalizedBrowser} from '../lib/paths'
import {resolveCompanionExtensionsConfig} from '../plugin-special-folders/folder-extensions/resolve-config'
import type {CompanionExtensionsConfig} from '../plugin-special-folders/folder-extensions/types'
import type {BuildOptions} from '../types'

type Layer = {extensions?: CompanionExtensionsConfig}

// Settles which companion extensions the run loads and warns once for each
// one a layer names that is not there.
export async function resolveBuildCompanions(input: {
  buildOptions: BuildOptions | undefined
  commandConfig: Layer
  browserConfig: Layer
  projectConfig: Layer
  commandKey: 'start' | 'build'
  packageJsonDir: string
  browser: NormalizedBrowser
  quiet: boolean
}): Promise<CompanionExtensionsConfig | undefined> {
  const {
    buildOptions,
    commandConfig,
    browserConfig,
    projectConfig,
    commandKey,
    packageJsonDir,
    browser,
    quiet
  } = input

  const mergedExtensionsConfig =
    buildOptions?.extensions ??
    commandConfig.extensions ??
    browserConfig.extensions ??
    projectConfig.extensions ??
    STOCK_COMPANION_EXTENSIONS
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

  // Said here, where the layer that named the companion is known. The
  // compiler config finds the same entry and leaves it to this line.
  for (const companion of unresolvedNamedCompanions({
    projectRoot: packageJsonDir,
    resolved: resolvedExtensionsConfig,
    declared: mergedExtensionsConfig,
    declaredIn: companionsDeclaredIn(commandKey, {
      flag: buildOptions?.extensions,
      command: commandConfig.extensions,
      browser: browserConfig.extensions,
      project: projectConfig.extensions
    })
  })) {
    isFirstCompanionWarning(companion.manifestPath)
    recordCodedWarning(
      CODES.W_COMPANION_EXTENSION_PATH,
      stripChannelPrefix(companion.frame)
    )

    if (!quiet) console.warn(companion.frame)
  }

  return resolvedExtensionsConfig
}

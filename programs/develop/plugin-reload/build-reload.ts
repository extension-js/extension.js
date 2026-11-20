// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compilation} from '@rspack/core'
import {isEmulatorBrowser, isGeckoBasedBrowser} from '../lib/constants'
import {
  buildSourceFeatureIndex,
  classifyReloadFromSources,
  createLoadedContentScripts,
  type ReloadInstruction,
  readContentScriptCount
} from './classify-reload'
import type {ChangedSourcesTracker} from './reload-dispatch'

export type LoadedContentScripts = ReturnType<typeof createLoadedContentScripts>

// Emulated Chromium reads the new file index on every reload and swaps a
// renamed static content script itself, so nothing is compared for it.
export function loadedContentScriptsFor(
  browser: string
): LoadedContentScripts | undefined {
  if (isEmulatorBrowser(browser)) return undefined

  return createLoadedContentScripts({
    refreshInPlace: isGeckoBasedBrowser(browser)
  })
}

// What a dev build reloads, from the sources that changed since the last
// one and, when given, what the browser last read through the manifest.
export function reloadForBuild(
  compilation: Compilation,
  options: {
    changedSources: ChangedSourcesTracker
    loaded?: LoadedContentScripts
  }
): ReloadInstruction | undefined {
  const outputPath = String(compilation.options.output.path || '')
  const contextDir = String(compilation.options.context || '')
  const {forcedFull, changedSources} = options.changedSources.snapshot()
  const classified = classifyReloadFromSources({
    changedSources,
    forcedFull,
    getContentScriptCount: () =>
      readContentScriptCount(compilation, outputPath),
    getSourceFeatureIndex: () =>
      buildSourceFeatureIndex(compilation, contextDir),
    outputPath,
    contextDir
  })

  return options.loaded
    ? options.loaded.resolve(compilation, classified)
    : classified
}

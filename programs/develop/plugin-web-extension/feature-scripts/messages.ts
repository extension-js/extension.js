// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'

export function importScriptsDependencyMissing(
  workerPath: string,
  literal: string,
  expectedPath: string,
  sourceSibling?: string
) {
  const lines: string[] = []
  lines.push(
    `The background service worker calls importScripts('${literal}'), but the file isn't in the output.`
  )

  lines.push(`${colors.gray('PATH')} ${colors.underline(workerPath)}`)
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The call fails at runtime.`)

  if (sourceSibling) {
    lines.push(
      `Found ${colors.underline(sourceSibling)}, but importScripts dependencies are copied as-is, not compiled.`
    )
  }

  lines.push(
    `- Move the file to ${colors.blue(expectedPath)} or ${colors.blue('public/')} so it ships with the extension.`
  )

  lines.push(`- Import it from the worker so it gets bundled.`)

  return lines.join('\n')
}

export function injectedFileDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string,
  sourceSibling?: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} injects '${literal}' via executeScript/insertCSS, but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The injection fails at runtime.`)

  if (sourceSibling) {
    lines.push(
      `Found ${colors.underline(sourceSibling)}, but injected files are copied as-is, not compiled.`
    )
  }

  lines.push(
    `Move the file to ${colors.blue(expectedPath)} or ${colors.blue('public/')} so it ships with the extension.`
  )

  return lines.join('\n')
}

export function injectedCompiledSourceLiteral(
  assetName: string,
  literal: string,
  emittedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} injects '${literal}', but ${literal} is compiled to ${emittedPath}.`
  )

  lines.push(`${colors.gray('REQUESTED')} ${colors.underline(literal)}`)
  lines.push(`${colors.gray('EMITTED')} ${colors.underline(emittedPath)}`)
  lines.push(
    `The browser asks for the source path, which the output does not contain, so the injection fails at runtime.`
  )

  lines.push(`Inject the emitted path: ${colors.blue(emittedPath)}.`)

  return lines.join('\n')
}

const SPLIT_ENTRY_RECIPE_URL =
  'https://extension.js.org/docs/features/rspack-configuration#share-a-module-between-entries'

// One loader per surface: the HTML tag, the background registration, the
// content_scripts list or the injection call. Each names exactly one file.
const SPLIT_ENTRY_SURFACES = {
  page: {
    loads: (entryName: string) => `${entryName}.html references only`,
    effect: 'the page renders blank'
  },
  background: {
    loads: () => 'the background registration loads only',
    effect: 'the background script never starts'
  },
  content_script: {
    loads: () => 'the content_scripts declaration injects only',
    effect: 'the content script never runs on the page'
  },
  // A scripting API call and a user_scripts api_script both hand the browser
  // one file to inject, so the wording has to hold for either.
  script: {
    loads: () => 'the browser injects only',
    effect: 'the script never runs'
  }
} as const

export function entrySplitAcrossInitialFiles(
  entryName: string,
  surface: keyof typeof SPLIT_ENTRY_SURFACES,
  ownFile: string,
  extraFiles: string[]
) {
  const shape = SPLIT_ENTRY_SURFACES[surface]
  const count = extraFiles.length + 1
  const lines: string[] = []
  lines.push(
    `${entryName} is split into ${count} initial files, but ${shape.loads(entryName)} ${ownFile}.`
  )

  lines.push(`${colors.gray('LOADED')} ${colors.underline(ownFile)}`)
  lines.push(
    `${colors.gray('NOT LOADED')} ${extraFiles.map((file) => colors.underline(file)).join(', ')}`
  )

  lines.push(
    `The entry waits for the other files at runtime and never runs, so ${shape.effect}.`
  )

  lines.push(
    `Only a user-set optimization.splitChunks cache group does this. Use chunks: 'async' and import() the shared module: ${colors.blue(SPLIT_ENTRY_RECIPE_URL)}`
  )

  return lines.join('\n')
}

// The two surfaces whose document is the web page, so a worker started from
// the extension origin is cross-origin and the browser refuses to start it.
const PAGE_CONTEXT_SURFACES = {
  content_script: 'a content script',
  script: 'an injected script'
} as const

export function workerStartedFromPageContext(
  assetName: string,
  surface: keyof typeof PAGE_CONTEXT_SURFACES
) {
  const lines: string[] = []
  lines.push(
    `${assetName} starts a worker with new Worker(new URL(...)), which the browser refuses in ${PAGE_CONTEXT_SURFACES[surface]}.`
  )

  lines.push(`${colors.gray('SCRIPT')} ${colors.underline(assetName)}`)
  lines.push(
    `The worker file ships, but a worker script must be same-origin with the document that starts it, and this document is the page, so the extension URL throws a SecurityError at runtime.`
  )

  lines.push(
    `- Fetch the worker file first and start the worker from a blob: ${colors.blue("new Worker(URL.createObjectURL(new Blob([await (await fetch(chrome.runtime.getURL('worker.js'))).text()])))")}`
  )

  lines.push(
    `- Or start the worker from an extension page, where the document is the extension and this spelling works as written.`
  )

  return lines.join('\n')
}

export function fetchedFileDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} loads '${literal}' at runtime (fetch/XMLHttpRequest/new URL), but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The request fails at runtime.`)
  lines.push(
    `Move the file so it resolves to ${colors.blue(expectedPath)}, or serve it from ${colors.blue('public/')} so it ships with the extension.`
  )

  return lines.join('\n')
}

export function getURLDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} references '${literal}' via chrome.runtime.getURL(), but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The reference fails at runtime.`)
  lines.push(
    `Move the file to ${colors.blue(expectedPath)} or ${colors.blue('public/')} so it ships with the extension.`
  )

  return lines.join('\n')
}

export function runtimeSetSurfaceDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} sets '${literal}' as a runtime surface (setPopup/setOptions), but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The surface opens a 404 at runtime.`)
  lines.push(
    `Move the file to ${colors.blue(expectedPath)} or ${colors.blue('public/')} so it ships with the extension.`
  )

  return lines.join('\n')
}

export function staticImportDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} (copied verbatim into the output) imports '${literal}', but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The import fails at runtime.`)
  lines.push(
    `Move the file to ${colors.blue(expectedPath)} or ${colors.blue('public/')} so it ships with the extension.`
  )

  return lines.join('\n')
}

export function reservedScriptsFolder(relPath: string, indicators: string[]) {
  const reasons = indicators.map((r) => `- ${colors.gray(r)}`).join('\n')

  return (
    `${prefix('error')} scripts/ is a reserved folder in Extension.js.\n` +
    `${colors.gray('PATH')} ${colors.underline(relPath)}\n` +
    `Every file under ${colors.blue('scripts/')} is wrapped with the browser ` +
    `content-script mount runtime, so Node.js-only files placed here fail ` +
    `to parse or run.\n` +
    `This file looks Node.js-only:\n${reasons}\n` +
    `Rename the folder at the project root (for example ${colors.blue('bin/')}, ` +
    `${colors.blue('tools/')}, or ${colors.blue('tasks/')}), or move the file out of scripts/.`
  )
}

// A getURL, importScripts or HTML literal that spells a compiled source.
// Injection calls have their own entry above, the other loaders share this.
export function compiledSourceSpelling(
  assetName: string,
  api: string,
  literal: string,
  emittedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} loads '${literal}' via ${api}, but ${literal} is compiled to ${emittedPath}.`
  )

  lines.push(`${colors.gray('REQUESTED')} ${colors.underline(literal)}`)
  lines.push(`${colors.gray('EMITTED')} ${colors.underline(emittedPath)}`)
  lines.push(
    `The browser asks for the source path, which the output does not contain, so the load fails at runtime.`
  )

  lines.push(`Reference the emitted path: ${colors.blue(emittedPath)}.`)

  return lines.join('\n')
}

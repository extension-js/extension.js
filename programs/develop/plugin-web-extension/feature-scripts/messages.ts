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

export type SplitEntryCause = 'runtimeChunk' | 'cacheGroup'

// A runtime chunk is the one split a cache group cannot produce, and the
// remedy differs: only chunks: 'async' helps a cache group split.
const SPLIT_ENTRY_CAUSES = {
  runtimeChunk: () =>
    `Only a user-set optimization.runtimeChunk does this. Keep runtimeChunk: false so every entry carries its own runtime`,
  cacheGroup: () =>
    `Only a user-set optimization.splitChunks cache group does this. Use chunks: 'async' and import() the shared module`
} as const

export function entrySplitAcrossInitialFiles(
  entryName: string,
  surface: keyof typeof SPLIT_ENTRY_SURFACES,
  ownFile: string,
  extraFiles: string[],
  cause: SplitEntryCause = 'cacheGroup'
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
    `${SPLIT_ENTRY_CAUSES[cause]()}: ${colors.blue(SPLIT_ENTRY_RECIPE_URL)}`
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
    `${assetName} starts a worker from an extension URL, which the browser refuses in ${PAGE_CONTEXT_SURFACES[surface]}.`
  )

  lines.push(`${colors.gray('SCRIPT')} ${colors.underline(assetName)}`)
  lines.push(
    `The worker file ships, but a worker script must be same-origin with the document that starts it, and this document is the page, so the worker never runs. Chromium throws a SecurityError and Firefox fires an error event on the worker.`
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

function moveFileHint(expectedPath: string, foundOutside?: string) {
  if (foundOutside) {
    return `The file exists at ${colors.blue(foundOutside)}, outside the manifest folder. Declare it under ${colors.blue('web_accessible_resources')} so it ships at that path, or move it to ${colors.blue(expectedPath)} or ${colors.blue('public/')}.`
  }

  return `Move the file to ${colors.blue(expectedPath)} or ${colors.blue('public/')} so it ships with the extension.`
}

export function getURLDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string,
  foundOutside?: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} references '${literal}' via chrome.runtime.getURL(), but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The reference fails at runtime.`)
  lines.push(moveFileHint(expectedPath, foundOutside))

  return lines.join('\n')
}

// The page the literal opens was declared only under a key the WebKit filter
// drops, so the build emitted nothing for it and the open fails in Safari.
export function webkitDroppedPageOpened(
  assetName: string,
  literal: string,
  page: {path: string; key: string; reason: string},
  browser: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} opens '${literal}' via chrome.runtime.getURL(), but the ${browser} build emitted no such page: ` +
      `${page.key} was the only manifest key naming it, and Safari drops that key (${page.reason}).`
  )

  lines.push(`${colors.gray('NOT EMITTED')} ${colors.underline(page.path)}`)
  lines.push(
    `Safari answers "can't find the file" when the extension opens it.`
  )

  lines.push(
    `Move the page under ${colors.blue('pages/')}, which every browser emits as ${colors.blue('pages/<name>.html')}, and open that path, ` +
      `or declare it under a manifest key Safari keeps.`
  )

  return lines.join('\n')
}

export function runtimeSetSurfaceDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string,
  foundOutside?: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} names '${literal}' at runtime (setPopup, setIcon, panels.create, tabs.create and friends), but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The surface opens a 404 at runtime.`)
  lines.push(moveFileHint(expectedPath, foundOutside))

  return lines.join('\n')
}

export function staticImportDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string,
  foundOutside?: string
) {
  const lines: string[] = []
  lines.push(
    `${assetName} (copied verbatim into the output) imports '${literal}', but the file isn't in the output.`
  )

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`)
  lines.push(`The import fails at runtime.`)
  lines.push(moveFileHint(expectedPath, foundOutside))

  return lines.join('\n')
}

export function buildConstantNeverDefined(
  file: string,
  name: string,
  entryName: string
) {
  const lines: string[] = []
  lines.push(
    `${file} reads ${name} as it loads, but nothing defines it, so ${entryName} throws "${name} is not defined" before it registers a listener.`
  )

  lines.push(`${colors.gray('FILE')} ${colors.underline(file)}`)
  lines.push(`${colors.gray('CONSTANT')} ${colors.underline(name)}`)
  lines.push(
    `- Set it in extension.config.js: ${colors.blue(`define: {${name}: value}`)}, or ${colors.blue(`browser.<vendor>.define`)} for a value per browser.`
  )

  lines.push(`- Or declare it in the file before the first read.`)

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

export function runtimeAssetFolderNotShipped(
  assetName: string,
  literal: string,
  folder: string,
  missing: string[]
) {
  const shown = folder ? `${folder}/` : 'the extension root'
  const publicPath = folder ? `public/${folder}/` : 'public/'
  const lines: string[] = []
  lines.push(
    `${assetName} names '${literal}' at runtime, but ${missing.length} file${missing.length === 1 ? '' : 's'} in ${shown} ${missing.length === 1 ? "isn't" : "aren't"} in the output.`
  )

  for (const file of missing.slice(0, 3)) {
    lines.push(`${colors.gray('NOT SHIPPED')} ${colors.underline(file)}`)
  }

  if (missing.length > 3) {
    lines.push(colors.gray(`and ${missing.length - 3} more`))
  }

  lines.push(
    `Paths built from strings at runtime are not traced, so these files fail to load.`
  )

  lines.push(
    `Move the folder to ${colors.blue(publicPath)} at the project root so it ships at the same path.`
  )

  return lines.join('\n')
}

export function pageRelativeScriptPath(
  sourcePath: string,
  literal: string,
  requestedPath: string,
  emittedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${sourcePath} names '${literal}' in a scripting call made from an extension page, and Firefox resolves that path against the page.`
  )

  lines.push(`${colors.gray('REQUESTED')} ${colors.underline(requestedPath)}`)
  lines.push(`${colors.gray('EMITTED')} ${colors.underline(emittedPath)}`)
  lines.push(
    `Firefox looks for a file the output does not contain and reports no failure: registerContentScripts resolves and executeScript resolves with an error in its result, so the script never runs. Chromium resolves the same path against the extension root, where it works.`
  )

  lines.push(
    `Start the path at the extension root: ${colors.blue(`/${emittedPath}`)}.`
  )

  return lines.join('\n')
}

// A dev session picks the world of each scripts/ file once, as it starts.
// registeredBy is the source that now registers it, absent once none does.
export function mainWorldRegistrationChanged(
  scriptPath: string,
  registeredBy?: string
) {
  const lines: string[] = []

  if (registeredBy) {
    lines.push(
      `${registeredBy} now registers ${scriptPath} into the MAIN world, but this dev session started before that call was there.`
    )
  } else {
    lines.push(
      `Nothing registers ${scriptPath} into the MAIN world anymore, but this dev session started while a call did.`
    )
  }

  lines.push(`${colors.gray('FILE')} ${colors.underline(scriptPath)}`)

  if (registeredBy) {
    lines.push(
      `${colors.gray('REGISTERED BY')} ${colors.underline(registeredBy)}`
    )

    lines.push(
      `The session keeps building the file as a content script, so the page it runs on receives the dev reload runtime and the content script wrapper.`
    )
  } else {
    lines.push(
      `The session keeps building the file for the page, without the content script wrapper and its reload on change.`
    )
  }

  lines.push(`Restart the dev server to build it for the world it runs in.`)

  return lines.join('\n')
}

export function unknownRegistrationWorld(
  sourcePath: string,
  line: number,
  emittedPaths: string[]
) {
  const lines: string[] = []
  const named = emittedPaths.join(', ')
  const treated =
    emittedPaths.length > 1
      ? 'They are treated as isolated world scripts'
      : 'It is treated as an isolated world script'
  lines.push(
    `${sourcePath}:${line} names ${named} in a scripting call whose world is only known when the call runs.`
  )

  lines.push(
    `${colors.gray('CALL')} ${colors.underline(`${sourcePath}:${line}`)}`
  )

  for (const emittedPath of emittedPaths) {
    lines.push(`${colors.gray('FILE')} ${colors.underline(emittedPath)}`)
  }

  lines.push(
    `${treated}, so a call that runs with world: 'MAIN' puts the isolated world build on the page.`
  )

  lines.push(
    `Write the world as ${colors.blue("'MAIN'")} or ${colors.blue("'ISOLATED'")} in the call, or as a choice between the two, and the build prepares the file for each world it names.`
  )

  return lines.join('\n')
}

export function contentScriptWithoutDefaultExport(file: string) {
  return (
    `${prefix('warn')} ${colors.yellow(file)} has no default export, so each re-inject in this dev session runs it again and the copy before it keeps running.\n` +
    `Export a default function that mounts the script and returns a cleanup, and Extension.js calls that cleanup before the next copy starts.\n` +
    "A whole-extension reload discards the old copy's code, so no cleanup runs for it and what it added to the page stays. Mount that under an element with data-extension-root and the next copy removes it."
  )
}

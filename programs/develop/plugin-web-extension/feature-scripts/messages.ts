// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import colors from 'pintor'
import {prefix} from '../../lib/messaging'
import {withheldFileLines} from '../../lib/withheld-file'
import {isCanonicalContentScriptAsset} from './contracts'

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

// The value names a file that exists, so staying quiet would hide why the
// extension cannot read it once installed.
export function manifestNamedFileNotShipped(
  manifestKey: string,
  literal: string,
  expectedPath: string
) {
  const lines: string[] = []
  lines.push(
    `manifest.json names '${literal}' under the custom key ${colors.blue(manifestKey)}, but the file isn't in the output.`
  )

  lines.push(...neverCopiedLines(expectedPath))

  return lines.join('\n')
}

function neverCopiedLines(expectedPath: string) {
  return [
    `${colors.gray('NOT FOUND')} ${colors.underline(expectedPath)}`,
    `A read of it fails at runtime.`,
    `The build copies only files the project or its workspace shares, never env files or tooling files. Keep what the extension reads in a project file under another name, or in ${colors.blue('public/')}.`
  ]
}

// The same finding for a path found in code, where a missing file of that
// kind is not worth a word and one the build withholds is.
export function codeNamedFileNotShipped(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  return [
    `${assetName} names '${literal}', but the file isn't in the output.`,
    ...neverCopiedLines(expectedPath)
  ].join('\n')
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

  // With no folder the names are files at the root, one or several.
  const moved = folder ? 'folder' : missing.length === 1 ? 'file' : 'files'

  lines.push(
    `Move the ${moved} to ${colors.blue(publicPath)} at the project root so ${moved === 'files' ? 'they ship' : 'it ships'} at the same path.`
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

// The build ships a declared page in a folder named after its surface, so a
// relative path a script of that page sets resolves in the new folder.
export function movedPageRelativeUrl(
  sourcePath: string,
  literal: string,
  page: string,
  requestedPath: string,
  emittedPath: string
) {
  const lines: string[] = []
  lines.push(
    `${sourcePath} sets a src or href to '${literal}', and the build moves the page that runs it.`
  )

  lines.push(`${colors.gray('PAGE')} ${colors.underline(page)}`)

  lines.push(`${colors.gray('REQUESTED')} ${colors.underline(requestedPath)}`)
  lines.push(`${colors.gray('EMITTED')} ${colors.underline(emittedPath)}`)
  lines.push(
    `A path without a leading slash resolves against the page, so the request fails at runtime with a 404.`
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
      `The session keeps building the file as a content script, so the page it runs on receives the dev session runtime and the content script wrapper.`
    )
  } else {
    lines.push(
      `The session keeps building the file for the page, without the content script wrapper and the dev session runtime.`
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

// One detail per file, opening with the file: two missing files of one
// field would otherwise read as the same error twice.
export function scriptsMissingFile(
  file: string,
  field: string,
  notFound: string,
  fromOutputRoot: boolean
) {
  const lines: string[] = []
  lines.push(
    `${file} does not exist. Check the ${field} field in your manifest.json file.`
  )

  lines.push(`The path must point to an existing file that will be bundled.`)

  if (fromOutputRoot) {
    lines.push(
      `Paths starting with '/' are resolved from the extension output root (served from public/), not your source directory.`
    )
  }

  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(notFound)}`)

  return lines.join('\n')
}

// A file on disk the build will not bundle: saying it does not exist would
// send the author looking for a file that is right there.
export function scriptsWithheldFile(
  file: string,
  field: string,
  kind: 'private' | 'outside',
  notFound: string
) {
  const lines: string[] = withheldFileLines(file, kind, {
    check: `Check the ${field} field in your manifest.json file.`
  })

  lines.push('')
  lines.push(`${colors.gray('NOT FOUND')} ${colors.underline(notFound)}`)

  return lines.join('\n')
}

export function scriptPathsCheckFailed(reason: string) {
  const lines: string[] = []
  lines.push(
    `Extension.js could not finish checking the script paths in manifest.json: ${reason}`
  )

  lines.push(
    `The check that every script and stylesheet the manifest names exists stopped early, so a missing file may go unreported in this build.`
  )

  lines.push(
    `This is a fault in Extension.js, not in your project. Run the build again, and report it if it repeats.`
  )

  return lines.join('\n')
}

export function topLevelMountCallRemoved(file: string, name: string) {
  const lines: string[] = []
  lines.push(
    `${file} calls ${name}() at the top level and also exports ${name} as default, so the call was left out of the build.`
  )

  lines.push(`${colors.gray('FILE')} ${colors.underline(file)}`)
  lines.push(
    `Extension.js runs the default export once the page is ready, and the call would run it a second time.`
  )

  lines.push(
    `Remove the ${colors.blue(`${name}()`)} call, or drop the default export if the script should start itself.`
  )

  return lines.join('\n')
}

// Thrown, so the build stops where the script would otherwise ship unmounted.
export function defaultExportUnreadable(file: string, reason: string) {
  return (
    `${prefix('error')} Extension.js could not read the default export of ${file}.\n` +
    `${colors.gray('PATH')} ${colors.underline(file)}\n` +
    `${colors.gray('REASON')} ${reason}\n` +
    `The build parses a content script to find the function it mounts, and the parser stopped before it reached the export, so the script would never run.\n` +
    `Move the code named above into a module this file imports, and keep the default export in a file of plain JavaScript, TypeScript or JSX.`
  )
}

// The wrapper reads what the loaders of extension.config.js return. With a
// reason the parser stopped in that text, without one the export is gone.
export function defaultExportLostToLoaders(
  file: string,
  loaders: string[],
  reason?: string
) {
  return (
    `${prefix('error')} Extension.js could not find the default export of ${file} in what a loader returned.\n` +
    `${colors.gray('PATH')} ${colors.underline(file)}\n` +
    `${colors.gray('LOADERS')} ${loaders.join(', ')}\n` +
    (reason
      ? `${colors.gray('REASON')} ${reason}\n` +
        `The build parses a content script to find the function it mounts. It read this one after the loaders named above, and the parser stopped in the text they returned before it reached the export, so the script would never run.\n`
      : `The file has a default export as written, which is the function the build mounts. The build read the file after the loaders named above, and the text they returned has no default export, so the script would never run.\n`) +
    `Keep the default export in what the loaders return, as plain JavaScript, TypeScript or JSX, or narrow their rule so it skips this file.`
  )
}

// Thrown, so the bundler's parse error of the wrapped text never shows.
export function contentScriptTopLevelAwait(
  file: string,
  line: number,
  column: number,
  declared: boolean
) {
  const runsAs = declared
    ? 'A content script declared in the manifest runs as a classic script'
    : 'A file a scripting call injects runs as a classic script'

  return (
    `${prefix('error')} ${file} uses await at the top level, outside any function.\n` +
    `${colors.gray('PATH')} ${colors.underline(`${file}:${line}:${column}`)}\n` +
    `${runsAs}, and a classic script only allows await inside an async function. This file has no import or export, so the build compiles it as that classic script too.\n` +
    `Wrap the code in an async function that runs right away:\n` +
    `  ${colors.blue('(async () => {')}\n` +
    `    // the code that uses await\n` +
    `  ${colors.blue('})()')}`
  )
}

// Chromium drops an @import in a sheet it injects, so one the build could
// not write into the sheet is a rule that styles nothing there.
export function injectedSheetImportKept(
  sheet: string,
  line: number,
  request: string,
  reason: 'remote' | 'missing'
) {
  const lines: string[] = []
  lines.push(
    `${sheet} is injected by file and imports '${request}', which Chrome drops in a sheet it injects.`
  )

  lines.push(`${colors.gray('PATH')} ${colors.underline(`${sheet}:${line}`)}`)
  lines.push(
    reason === 'remote'
      ? `The build writes an imported sheet into the injected one, and it cannot read a sheet another origin serves.`
      : `The build writes an imported sheet into the injected one, and this file isn't in the output.`
  )

  lines.push(
    reason === 'remote'
      ? `Keep a copy of that sheet in the project and import the copy.`
      : `Fix the path, or remove the import.`
  )

  return lines.join('\n')
}

export function publicInjectedSheetImportIgnored(
  sheet: string,
  line: number,
  request: string
) {
  const lines: string[] = []
  lines.push(
    `${sheet} is injected by file and imports '${request}', which Chrome drops in a sheet it injects.`
  )

  lines.push(`${colors.gray('PATH')} ${colors.underline(`${sheet}:${line}`)}`)
  lines.push(
    `A file in ${colors.blue('public/')} ships byte for byte, so the import stays as written. Firefox loads it, Chrome does not.`
  )

  lines.push(
    `Move the sheet out of ${colors.blue('public/')} and the build writes the imported rules into it.`
  )

  return lines.join('\n')
}

// A public/ sheet keeps the targets its author wrote, which Chromium reads
// against the visited page when the sheet is injected by file.
export function publicInjectedSheetPageRelativeTarget(
  sheet: string,
  line: number,
  request: string,
  named: string
) {
  const lines: string[] = []
  lines.push(
    `${sheet} is injected by file and names ${colors.blue(`url(${request})`)}, which Chrome reads against the visited page.`
  )

  lines.push(`${colors.gray('PATH')} ${colors.underline(`${sheet}:${line}`)}`)
  lines.push(
    `A file in ${colors.blue('public/')} ships byte for byte, so the target stays as written. Firefox reads it beside the sheet.`
  )

  lines.push(
    `- Move the sheet out of ${colors.blue('public/')} and the build names each target from the extension and lets a page fetch it.`
  )

  lines.push(
    `- Or, in a sheet for Chrome alone, spell it ${colors.blue(`url("${named}")`)} and list the file in ${colors.blue('web_accessible_resources')}.`
  )

  return lines.join('\n')
}

// The browser refuses a file it cannot parse without a word, so the build
// says what that costs the surface the file backs.
export function emittedScriptUnparsable(name: string, reason: string) {
  const slot = isCanonicalContentScriptAsset(name)
    ? [
        'The browser will silently skip an unparsable content script:',
        'it never injects and reports no error anywhere. Fix the syntax',
        'error in the source file(s) this content_scripts entry bundles.'
      ]
    : [
        'The browser refuses to run a file it cannot parse, so the surface this',
        'backs is dead on arrival. Fix the syntax error in the source file(s)',
        'this entry bundles.'
      ]

  return [`${name} is not valid JavaScript: ${reason}.`, ...slot].join('\n')
}

export function runtimeLoadedFileCompileFailed(
  emitPath: string,
  reason: string
) {
  return `Compiling runtime-loaded ${emitPath} failed: ${reason}`
}

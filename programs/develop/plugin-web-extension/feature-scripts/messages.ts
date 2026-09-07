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

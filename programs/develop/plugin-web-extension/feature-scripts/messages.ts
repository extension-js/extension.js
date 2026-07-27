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
  const sibling = sourceSibling
    ? `Found ${colors.yellow(sourceSibling)}, but importScripts dependencies ` +
      `are copied as-is, not compiled.\n`
    : ''
  return (
    `The background service_worker ${colors.yellow(workerPath)} calls ` +
    `importScripts(${colors.yellow(`'${literal}'`)}), but ` +
    `${colors.yellow(expectedPath)} is not part of the output.\n` +
    `The call will fail at runtime.\n` +
    sibling +
    `Move the file to ${colors.yellow(expectedPath)} (or ${colors.yellow(
      'public/'
    )}) so it ships with the extension, or import it from the worker so it ` +
    `gets bundled.`
  )
}

export function injectedFileDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string,
  sourceSibling?: string
) {
  const sibling = sourceSibling
    ? `Found ${colors.yellow(sourceSibling)}, but injected files are copied ` +
      `as-is, not compiled.\n`
    : ''
  return (
    `${colors.yellow(assetName)} injects ${colors.yellow(
      `'${literal}'`
    )} via executeScript/insertCSS, but ${colors.yellow(expectedPath)} is ` +
    `not part of the output.\nThe injection will fail at runtime.\n` +
    sibling +
    `Move the file to ${colors.yellow(expectedPath)} (or ${colors.yellow(
      'public/'
    )}) so it ships with the extension.`
  )
}

export function fetchedFileDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  return (
    `${colors.yellow(assetName)} loads ${colors.yellow(
      `'${literal}'`
    )} at runtime (fetch/XMLHttpRequest/new URL), but ${colors.yellow(
      expectedPath
    )} is not part of the output.\nThe request will fail at runtime.\n` +
    `Move the file so it resolves to ${colors.yellow(expectedPath)} (or ` +
    `serve it from ${colors.yellow('public/')}) so it ships with the extension.`
  )
}

export function getURLDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  return (
    `${colors.yellow(assetName)} references ${colors.yellow(
      `'${literal}'`
    )} via chrome.runtime.getURL(), but ${colors.yellow(expectedPath)} is ` +
    `not part of the output.\nThe reference will fail at runtime.\n` +
    `Move the file to ${colors.yellow(expectedPath)} (or ${colors.yellow(
      'public/'
    )}) so it ships with the extension.`
  )
}

export function runtimeSetSurfaceDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  return (
    `${colors.yellow(assetName)} sets ${colors.yellow(
      `'${literal}'`
    )} as a runtime surface (setPopup/setOptions), but ${colors.yellow(
      expectedPath
    )} is not part of the output.\nThe surface will open a 404 at runtime.\n` +
    `Move the file to ${colors.yellow(expectedPath)} (or ${colors.yellow(
      'public/'
    )}) so it ships with the extension.`
  )
}

export function staticImportDependencyMissing(
  assetName: string,
  literal: string,
  expectedPath: string
) {
  return (
    `${colors.yellow(assetName)} (copied verbatim into the output) imports ` +
    `${colors.yellow(`'${literal}'`)}, but ${colors.yellow(expectedPath)} is ` +
    `not part of the output.\nThe import will fail at runtime.\n` +
    `Move the file to ${colors.yellow(expectedPath)} (or ${colors.yellow(
      'public/'
    )}) so it ships with the extension.`
  )
}

export function reservedScriptsFolder(relPath: string, indicators: string[]) {
  const reasons = indicators.map((r) => `- ${colors.gray(r)}`).join('\n')
  return (
    `${prefix('error')} scripts/ is a reserved folder in Extension.js.\n` +
    `Every file under ${colors.yellow('scripts/')} is wrapped with the browser ` +
    `content-script mount runtime, so Node.js-only files placed here will fail ` +
    `to parse or run.\n` +
    `Rename the folder at the project root (for example ${colors.yellow('bin/')}, ` +
    `${colors.yellow('tools/')}, ${colors.yellow('ops/')}, ${colors.yellow('tasks/')}, ` +
    `or ${colors.yellow('ci-scripts/')}) or move the file out of scripts/.\n\n` +
    `${colors.red('NODE.JS SHAPE')}\n${reasons}\n` +
    `${colors.red('NOT ALLOWED')} ${colors.underline(relPath)}`
  )
}

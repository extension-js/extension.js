// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {canonicalizeDir, toProjectRelativePath} from './resource-path'

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g
// The glyph, with the severity word a plain stream gets right after it.
const CHANNEL_GLYPH = /^\s*⏵⏵⏵\s*(?:(?:Warning|Error):(?:\s+|$))?/
const PATH_CHARACTER = /[\w.~\\/-]/
const PACKAGE_NAME = 'extension-develop'

// The bundler heads a loader's report with the loader's own path, which
// names a folder inside the installed package and nothing in the project.
function stripLoaderHeader(message: string): string {
  return message.replace(
    /^(\s*(?:[×⚠]\s*)?)Module (?:Warning|Error|build failed) \(from [^\n]*\):\s*(?:│ ?)?/,
    '$1'
  )
}

// The glyph, the arrow and the bar gutter are how a terminal frames the
// text, so a structured field carries the sentences and none of the frame.
function stripLayout(message: string): string {
  return message
    .replace(/\r/g, '')
    .split('\n')
    .map((line, index) =>
      (index === 0
        ? line.replace(/^\s*(?:[×⚠]\s*)?(?:╰─▶\s*)?(?:[×⚠]\s*)?/, '')
        : line.replace(/^\s*│ ?/, '')
      ).replace(CHANNEL_GLYPH, '')
    )
    .join('\n')
    .trim()
}

// Rewrites every path that opens with the given folder. A match that is
// only the tail of a longer path is left alone.
function rewriteUnder(
  text: string,
  folder: string,
  rewrite: (found: string) => string
): string {
  const opening = folder + path.sep
  let out = ''
  let from = 0

  for (;;) {
    const at = text.indexOf(opening, from)

    if (at === -1) return out + text.slice(from)

    const rest = text.slice(at + opening.length)
    const end = at + opening.length + (/^\S*/.exec(rest)?.[0].length ?? 0)
    const found = text.slice(at, end)
    const whole = at === 0 || !PATH_CHARACTER.test(text[at - 1])

    out += text.slice(from, at) + (whole ? rewrite(found) : found)
    from = end
  }
}

// The package folder plus every node_modules folder Node would search from
// it, which together hold the installed toolchain and nothing the user wrote.
function toolchainFolders(): string[] {
  const packageRoot = path.resolve(__dirname, '..')
  const folders = [packageRoot]

  for (let dir = packageRoot; ; dir = path.dirname(dir)) {
    folders.push(path.join(dir, 'node_modules'))

    if (path.dirname(dir) === dir) return folders
  }
}

// A dependency reads from its own package name on, and a file of this
// package reads under the name the package is published by.
function toPackagePath(found: string, folder: string): string {
  const inside = found
    .slice(folder.length + 1)
    .split(path.sep)
    .join('/')
  const dependency = /^(?:.*\/)?node_modules\/(.*)$/.exec(inside)?.[1]

  if (dependency !== undefined) return dependency

  return path.basename(folder) === 'node_modules'
    ? inside
    : `${PACKAGE_NAME}/${inside}`
}

// A file in the project reads relative to it, and a file of the installed
// toolchain reads by its package, since its folder differs on every machine.
function plainPaths(text: string, projectPath: string | undefined): string {
  let out = text

  if (projectPath) {
    const roots = new Set([projectPath, canonicalizeDir(projectPath)])

    for (const root of [...roots].sort((a, b) => b.length - a.length)) {
      out = rewriteUnder(out, root, (found) =>
        toProjectRelativePath(projectPath, found)
      )
    }
  }

  for (const folder of toolchainFolders()) {
    out = rewriteUnder(out, folder, (found) => toPackagePath(found, folder))
  }

  return out
}

// A stack names a module by its file URL, which is the same folder again.
function fromFileUrl(url: string): string {
  try {
    return fileURLToPath(url)
  } catch {
    return url
  }
}

// The one place a compiler message turns into a machine string: no color,
// no loader header, no frame, and no path that only this machine has.
export function toMachineText(raw: unknown, projectPath?: string): string {
  const plain = String(raw ?? '')
    .replace(ANSI_PATTERN, '')
    .replace(/\bfile:\/\/\/\S+/g, fromFileUrl)

  return plainPaths(stripLayout(stripLoaderHeader(plain)), projectPath)
}

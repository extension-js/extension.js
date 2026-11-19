// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as nodePath from 'node:path'
import {fileURLToPath} from 'node:url'
import {isSameOrInsidePath, realPath} from './real-path'

const PLACE = /^(.+):(\d+):(\d+)$/

// `at name (file:line:column)` or `at file:line:column`.
function framePlace(line: string): RegExpExecArray | null {
  const text = line.trim()
  if (!text.startsWith('at ')) return null

  const open = text.endsWith(')') ? text.indexOf(' (') : -1

  return PLACE.exec(open === -1 ? text.slice(3) : text.slice(open + 2, -1))
}

function frameFile(raw: string): string {
  if (!raw.startsWith('file://')) return raw

  try {
    return fileURLToPath(raw)
  } catch {
    return raw
  }
}

// Where an error was thrown from, for one that says nothing else: the first
// stack frame in the project's own files, as a path from the project root.
export function thrownFrom(
  error: unknown,
  projectRoot: string
): string | undefined {
  let stack = ''

  try {
    stack = String((error as {stack?: unknown} | null)?.stack || '')
  } catch {
    return undefined
  }

  let first: string | undefined

  for (const line of stack.split('\n')) {
    const frame = framePlace(line)
    if (!frame) continue

    const file = frameFile(frame[1])
    if (!nodePath.isAbsolute(file)) continue

    const place = `:${frame[2]}:${frame[3]}`
    first ??= `${file}${place}`

    if (
      projectRoot &&
      isSameOrInsidePath(projectRoot, file) &&
      !file.split(/[\\/]/).includes('node_modules')
    ) {
      const relative = nodePath
        .relative(realPath(projectRoot), realPath(file))
        .split(nodePath.sep)
        .join('/')

      return `${relative}${place}`
    }
  }

  return first
}

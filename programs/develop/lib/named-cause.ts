// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {isKnownDiagnosticName} from './diagnostic-code'

// eslint-disable-next-line no-control-regex
const ANSI_AT_START = /^\u001b\[[0-9;]*m/
// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g

const BUILD_FAILED_HEAD =
  /^\s*(?:[×]\s*)?Module build failed \(from [^\n]*\):\s*$/
const NESTED_HEAD =
  /^\s*(?:│\s*)*╰─▶\s*(?:[×]\s*)?Module build failed \(from [^\n]*\):\s*$/
const NAMED_CAUSE = /^(\s*(?:│\s*)*╰─▶\s*(?:[×]\s*)?)([A-Za-z]\w*): /
const GUTTER = /^\s*(?:│\s*)*│ ?/
// The glyph, with the severity word a plain stream gets right after it.
const CHANNEL_GLYPH = /^⏵⏵⏵\s*(?:(?:Warning|Error):(?:\s+|$))?/
const STACK_FRAME = /^\s+at (?:.*\(.*\)|\S+:\d+:\d+)\s*$/

export interface NamedCauseOptions {
  // A machine string keeps one gutter per line, the frame the layout strip expects.
  machine?: boolean
  keepStack?: boolean
}

// Drops the first `count` visible characters and the color codes among them,
// so a colored line loses its frame and keeps the color of what follows.
function afterVisible(line: string, count: number): string {
  let at = 0
  let seen = 0

  while (at < line.length && seen < count) {
    const code = ANSI_AT_START.exec(line.slice(at))

    if (code) {
      at += code[0].length
      continue
    }

    at += 1
    seen += 1
  }

  return line.slice(at)
}

function beforeVisible(line: string, count: number): string {
  return line.slice(0, line.length - afterVisible(line, count).length)
}

function plainOf(line: string): string {
  return line.replace(ANSI_PATTERN, '')
}

// A loader that refuses a file with a named error already wrote the whole
// message, so the bundler's head line naming the outermost loader is noise.
export function unwrapNamedCauses(
  text: string,
  options: NamedCauseOptions = {}
): string {
  const lines = String(text ?? '').split('\n')
  const out: string[] = []
  let index = 0

  while (index < lines.length) {
    const head = lines[index]
    const headPlain = plainOf(head)

    if (!BUILD_FAILED_HEAD.test(headPlain)) {
      out.push(head)
      index += 1
      continue
    }

    let next = index + 1

    while (next < lines.length && NESTED_HEAD.test(plainOf(lines[next]))) {
      next += 1
    }

    const cause = lines[next]
    const causePlain = cause === undefined ? '' : plainOf(cause)
    const match = NAMED_CAUSE.exec(causePlain)

    if (!match || !isKnownDiagnosticName(match[2])) {
      out.push(head)
      index += 1
      continue
    }

    const lead = /^\s*/.exec(headPlain)?.[0] ?? ''
    const glyph = beforeVisible(head, headPlain.indexOf('Module build failed'))
    let message = afterVisible(cause, match[0].length)
    const glyphRun = CHANNEL_GLYPH.exec(plainOf(message))
    if (glyphRun) message = afterVisible(message, glyphRun[0].length)

    out.push(options.machine ? `${lead}× ${plainOf(message)}` : glyph + message)
    index = next + 1

    while (index < lines.length) {
      const line = lines[index]
      const plain = plainOf(line)
      const gutter = GUTTER.exec(plain)
      if (!gutter) break

      index += 1
      const rest = afterVisible(line, gutter[0].length)
      if (!options.keepStack && STACK_FRAME.test(plainOf(rest))) continue

      out.push(options.machine ? `│ ${plainOf(rest)}` : `${lead}  ${rest}`)
    }
  }

  return out.join('\n')
}

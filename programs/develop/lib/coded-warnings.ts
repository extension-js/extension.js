// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {codeForSeverity} from './diagnostic-code'
import type {ErrorCode} from './messaging'

// A warning the run carries on past, in the shape the envelope's warnings
// array speaks: the declared code, a colon, one plain sentence.
const pending: string[] = []

export function recordCodedWarning(code: ErrorCode, text: string): void {
  const line = `${codeForSeverity(code, 'warning').code}: ${text}`

  if (!pending.includes(line)) pending.push(line)
}

export function takeCodedWarnings(): string[] {
  return pending.splice(0)
}

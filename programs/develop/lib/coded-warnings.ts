// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {AsyncLocalStorage} from 'node:async_hooks'
import type {ErrorCode} from './messaging'

// A warning the run carries on past, in the shape the envelope's warnings
// array speaks: the declared code, a colon, one plain sentence.
const pending: string[] = []
const scopes = new AsyncLocalStorage<string[]>()
let activeBuilds = 0

export function recordCodedWarning(code: ErrorCode, text: string): void {
  const line = `${code}: ${text}`
  const lines = scopes.getStore() ?? pending

  if (!lines.includes(line)) lines.push(line)
}

// A bundler hook runs outside the build's async scope, so what a plugin
// records sits in the shared list and the build that asks first takes it.
export function takeCodedWarnings(): string[] {
  const own = scopes.getStore()
  const shared = pending.splice(0)

  return own ? [...new Set([...own.splice(0), ...shared])] : shared
}

// What an earlier run left behind is not this build's. A second build that
// starts while one is running leaves the first one's warnings alone.
export async function withCodedWarnings<T>(run: () => Promise<T>): Promise<T> {
  if (activeBuilds === 0) pending.length = 0

  activeBuilds += 1

  try {
    return await scopes.run([], run)
  } finally {
    activeBuilds -= 1
  }
}

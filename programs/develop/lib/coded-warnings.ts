// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {AsyncLocalStorage, AsyncResource} from 'node:async_hooks'
import type {WarningCode} from './diagnostic-code'

// A warning the run carries on past, in the shape the envelope's warnings
// array speaks: the declared code, a colon, one plain sentence.
const pending: string[] = []
const scopes = new AsyncLocalStorage<string[]>()
const activeBuilds = new Set<string[]>()
const compilerLists = new WeakMap<object, string[]>()

// Bound while no scope is open, so whatever it calls sees none.
const outsideScopes = AsyncResource.bind(<T>(run: () => T): T => run())

// A bundler hook runs outside the build's async scope, so a plugin passes the
// compiler it was applied to and the line lands in that compiler's build.
function listsFor(compiler: object | undefined): string[][] {
  const named = compiler ? compilerLists.get(compiler) : undefined
  const own = named ?? scopes.getStore()

  if (own) return [own]

  // A line no build can be named for goes to every build running now: a
  // copy too many beats a warning lost, or one handed to the wrong build.
  return activeBuilds.size > 0 ? [...activeBuilds] : [pending]
}

export type CodedWarningListener = (
  code: WarningCode,
  text: string,
  owner?: object
) => void

const listeners = new Set<CodedWarningListener>()

// A session that reports a warning the moment it is known. While one
// listens, a warning no build owns goes to it and is kept nowhere else.
export function onCodedWarning(listener: CodedWarningListener): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function recordCodedWarning(
  code: WarningCode,
  text: string,
  compiler?: object
): void {
  const line = `${code}: ${text}`
  const ownedByBuild =
    (compiler ? compilerLists.has(compiler) : false) ||
    scopes.getStore() !== undefined ||
    activeBuilds.size > 0

  if (!ownedByBuild && listeners.size > 0) {
    for (const listener of [...listeners]) listener(code, text, compiler)

    return
  }

  for (const lines of listsFor(compiler)) {
    if (!lines.includes(line)) lines.push(line)
  }
}

// Called by the build that made the compiler, inside its own scope.
export function keepCodedWarningsOf(compiler: object): void {
  const own = scopes.getStore()

  if (own) compilerLists.set(compiler, own)
}

// The shared list holds what was recorded while no build ran, and the build
// that asks first takes it.
export function takeCodedWarnings(): string[] {
  const own = scopes.getStore()
  const shared = pending.splice(0)

  return own ? [...new Set([...own.splice(0), ...shared])] : shared
}

// What an earlier run left behind is not this build's. A second build that
// starts while one is running leaves the first one's warnings alone.
export async function withCodedWarnings<T>(run: () => Promise<T>): Promise<T> {
  if (activeBuilds.size === 0) pending.length = 0

  const own: string[] = []

  activeBuilds.add(own)

  try {
    return await scopes.run(own, run)
  } finally {
    activeBuilds.delete(own)
  }
}

// Bun 1.2.0 crashes when the bundler starts inside an async scope, and the
// bundler's hooks never see the scope on any runtime, so it starts outside.
export function outsideCodedWarnings<T>(run: () => T): T {
  return outsideScopes(run) as T
}

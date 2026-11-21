// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'

type DevSessionRestartReason =
  | 'scripts'
  | 'html'
  | 'icons'
  | 'json'
  | 'env'
  | 'public'
  | 'main-world'
  | 'styles'

export interface DevSessionRestartRequest {
  reason: DevSessionRestartReason
  pathAfter?: string
  pathBefore?: string
  // A file whose contents changed, as opposed to an entry that moved.
  pathChanged?: string
  manifestField?: string
  // The field pathChanged sat under, when only its manifest key changed.
  manifestFieldBefore?: string
  // The source that now registers pathChanged into the MAIN world.
  registeredBy?: string
  // How many more files changed for the same reason.
  alsoChanged?: number
}

export interface MainWorldScriptChange {
  files: string[]
  registeredBy?: string
}

export interface MainWorldRestartOptions {
  // The hook name the compiler taps are made under.
  name: string
  // One key per manifest, so a restart that did not take is told apart.
  key: string
  // The set the compiler was made with, and how to read it from disk now.
  startSignature: string
  readSignature: () => string
}

// Called with each compilation's MAIN world set. True when the session
// restart takes the change, false when the author is to be warned instead.
export type NoteMainWorldSet = (
  compilation: object,
  signature: string,
  changed: MainWorldScriptChange[]
) => boolean

// What the dev server answers for a live session. A build with no session
// has no answers, so a plugin reports the change to the author itself.
interface SessionRestartAnswers {
  request(
    compiler: object | undefined,
    request: DevSessionRestartRequest
  ): boolean
  isRestarting(compiler: object | undefined): boolean
}

let answers: SessionRestartAnswers | undefined
let trackMainWorld:
  | ((compiler: Compiler, options: MainWorldRestartOptions) => NoteMainWorldSet)
  | undefined

// Whoever runs sessions answers. The earlier answers come back, so a spec
// that stands in for the dev server can put them back.
export function answerSessionRestarts(
  next: SessionRestartAnswers | undefined
): SessionRestartAnswers | undefined {
  const before = answers

  answers = next

  return before
}

export function answerMainWorldRestarts(
  next: typeof trackMainWorld
): typeof trackMainWorld {
  const before = trackMainWorld

  trackMainWorld = next

  return before
}

// True when a live session will carry the change. False means the caller
// must still surface its restart-required diagnostic.
export function requestSessionRestart(
  compiler: object | undefined,
  request: DevSessionRestartRequest
): boolean {
  return answers?.request(compiler, request) ?? false
}

// True while the build of this compiler is one a restart will supersede.
export function isSessionRestarting(compiler: object | undefined): boolean {
  return answers?.isRestarting(compiler) ?? false
}

// With no session the set a compiler started with is the only one that
// passes, and any other is the author's to restart for.
export function trackMainWorldSet(
  compiler: Compiler,
  options: MainWorldRestartOptions
): NoteMainWorldSet {
  if (trackMainWorld) return trackMainWorld(compiler, options)

  return (_compilation, signature) => signature === options.startSignature
}

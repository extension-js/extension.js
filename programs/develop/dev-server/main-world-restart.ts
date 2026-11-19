// ██████╗ ███████╗██╗   ██╗      ███████╗███████╗██████╗ ██╗   ██╗███████╗██████╗
// ██╔══██╗██╔════╝██║   ██║      ██╔════╝██╔════╝██╔══██╗██║   ██║██╔════╝██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗███████╗█████╗  ██████╔╝██║   ██║█████╗  ██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝╚════╝╚════██║██╔══╝  ██╔══██╗╚██╗ ██╔╝██╔══╝  ██╔══██╗
// ██████╔╝███████╗ ╚████╔╝       ███████║███████╗██║  ██║ ╚████╔╝ ███████╗██║  ██║
// ╚═════╝ ╚══════╝  ╚═══╝        ╚══════╝╚══════╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {Compiler} from '@rspack/core'
import {
  canAutoRestartDevSession,
  DEV_SESSION_RESTART_DEBOUNCE_MS,
  type DevSessionRestartRequest,
  isCompilerRestarting,
  isDevSessionRestartPending,
  requestDevSessionRestart
} from './session-restart'
import {
  holdBuildForMainWorldRestart,
  holdForMainWorldRestart,
  releaseMainWorldRestartHold
} from './session-restart-holds'

// The set a restart was last asked for, by manifest. A compiler that finds
// that same set again was not put in line by the restart, so it warns.
const lastRequested = new Map<string, string>()

// How long a changed set has to hold before a restart is asked for. An edit
// taken back inside it leaves the session on the compiler it already has.
export const MAIN_WORLD_SETTLE_MS = DEV_SESSION_RESTART_DEBOUNCE_MS

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

// The steps that build a MAIN world file take their list once, when the
// compiler is made, so a set changed mid-session restarts the session.
export function trackMainWorldRestart(
  compiler: Compiler,
  options: MainWorldRestartOptions
): NoteMainWorldSet {
  const {key, startSignature, readSignature} = options
  let requested: string | undefined
  let settling: ReturnType<typeof setTimeout> | undefined

  const stopSettling = () => {
    if (settling) clearTimeout(settling)

    settling = undefined
  }

  const standDown = () => {
    stopSettling()
    requested = undefined
    releaseMainWorldRestartHold(compiler)
  }

  // False once the restart asked for here ended with this compiler still
  // serving, which only a restart that could not build its bundle does.
  const restartIsComing = () =>
    settling !== undefined ||
    isCompilerRestarting(compiler) ||
    isDevSessionRestartPending(compiler)

  // Asked once the set has held, and read from disk again first: a save
  // that put the call back may not have reached a compilation yet.
  const askOnceSettled = (
    signature: string,
    request: DevSessionRestartRequest
  ) => {
    stopSettling()

    settling = setTimeout(() => {
      settling = undefined

      if (
        readSignature() === startSignature ||
        !requestDevSessionRestart(compiler, request)
      ) {
        standDown()

        return
      }

      lastRequested.set(key, signature)
    }, MAIN_WORLD_SETTLE_MS)

    settling.unref?.()
  }

  // A compiler that is closed was replaced, and its successor took the list
  // as it stood, so a restart still settling here has nothing left to do.
  for (const hook of ['watchClose', 'shutdown'] as const) {
    compiler.hooks[hook]?.tap?.(options.name, stopSettling)
  }

  return (compilation, signature, changed) => {
    if (signature === startSignature) {
      standDown()
      lastRequested.delete(key)

      return true
    }

    // This compiler already took this set, the restart is on its way.
    if (requested === signature && restartIsComing()) {
      holdBuildForMainWorldRestart(compilation)

      return true
    }

    // The restart failed and this compiler kept serving, so the build a
    // save makes asks for it again, as the failure told the author.
    if (requested === signature) {
      standDown()
      lastRequested.delete(key)
    }

    // A live session rebuilds itself with the new list. Without one, or
    // after a restart that did not take, the author is told to restart.
    if (
      lastRequested.get(key) !== signature &&
      canAutoRestartDevSession(compiler)
    ) {
      requested = signature
      holdForMainWorldRestart(compiler, compilation)
      askOnceSettled(signature, {
        reason: 'main-world',
        pathChanged: changed[0].files[0],
        registeredBy: changed[0].registeredBy,
        alsoChanged: changed.length - 1
      })

      return true
    }

    // The set a restart did not take is warned about and reloads as usual.
    standDown()

    return false
  }
}

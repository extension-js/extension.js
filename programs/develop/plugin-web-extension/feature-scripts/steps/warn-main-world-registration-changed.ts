// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {type Compiler, WebpackError} from '@rspack/core'
import {
  canAutoRestartDevSession,
  DEV_SESSION_RESTART_DEBOUNCE_MS,
  requestDevSessionRestart
} from '../../../dev-server/session-restart'
import type {FilepathList, PluginInterface} from '../../../types'
import {unixify} from '../../shared/paths'
import * as messages from '../messages'
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'

// The set a restart was last asked for, by manifest. A compiler that finds
// that same set again was not put in line by the restart, so it warns.
const lastRequested = new Map<string, string>()

// How long a changed set has to hold before a restart is asked for. An edit
// taken back inside it leaves the session on the compiler it already has.
export const MAIN_WORLD_SETTLE_MS = DEV_SESSION_RESTART_DEBOUNCE_MS

// Compilers whose set differs from the one they were made with, while the
// restart for it settles or runs. That restart reloads the extension once.
const awaitingRestart = new WeakSet<object>()

// Builds made while the set differed. A slow one can end after the set was
// taken back, and it still must not reload for what it was built with.
const heldBuilds = new WeakSet<object>()

// True for a build the restart is about to replace. Reloading for it too
// would start the background twice for the one edit.
export function isAwaitingMainWorldRestart(
  compiler: object | undefined,
  compilation?: object
): boolean {
  if (compilation != null && heldBuilds.has(compilation)) return true

  return compiler != null && awaitingRestart.has(compiler)
}

function signatureOf(entries: Map<string, unknown>): string {
  return [...entries.keys()].sort().join('\n')
}

// The steps that build a MAIN world file take their list once, when the
// compiler is made, so a call written mid-session needs a new session.
export class WarnMainWorldRegistrationChanged {
  public static readonly name: string =
    'scripts:warn-main-world-registration-changed'

  private readonly manifestPath: string
  private readonly includeList: FilepathList
  private readonly pageList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList || {}
    this.pageList = options.pageList
  }

  public apply(compiler: Compiler): void {
    if (compiler.options.mode !== 'development') return
    if (!compiler?.hooks?.thisCompilation?.tap) return

    const manifestDir = path.dirname(this.manifestPath)
    const projectPath = (compiler.options.context as string) || manifestDir
    const find = () =>
      findRuntimeMainWorldEntries({
        includeList: this.includeList,
        pageList: this.pageList,
        manifestDir,
        projectPath
      })
    const relative = (file: string) => unixify(path.relative(projectPath, file))
    // The same answer the build steps took as this compiler was made.
    const atStart = new Map(
      find().map((entry) => [entry.entryName, entry.files])
    )
    const startSignature = signatureOf(atStart)
    let requested: string | undefined
    let settling: ReturnType<typeof setTimeout> | undefined

    const stopSettling = () => {
      if (settling) clearTimeout(settling)

      settling = undefined
    }

    const standDown = () => {
      stopSettling()
      requested = undefined
      awaitingRestart.delete(compiler)
    }

    // Asked once the set has held, and read from disk again first: a save
    // that put the call back may not have reached a compilation yet.
    const askOnceSettled = (
      signature: string,
      request: Parameters<typeof requestDevSessionRestart>[1]
    ) => {
      stopSettling()

      settling = setTimeout(() => {
        settling = undefined

        const settled = signatureOf(
          new Map(find().map((entry) => [entry.entryName, entry]))
        )

        if (
          settled === startSignature ||
          !requestDevSessionRestart(compiler, request)
        ) {
          standDown()

          return
        }

        lastRequested.set(this.manifestPath, signature)
      }, MAIN_WORLD_SETTLE_MS)

      settling.unref?.()
    }

    // A compiler that is closed was replaced, and its successor took the list
    // as it stood, so a restart still settling here has nothing left to do.
    for (const hook of ['watchClose', 'shutdown'] as const) {
      compiler.hooks[hook]?.tap?.(
        WarnMainWorldRegistrationChanged.name,
        stopSettling
      )
    }

    compiler.hooks.thisCompilation.tap(
      WarnMainWorldRegistrationChanged.name,
      (compilation) => {
        // Read on every compilation, so a call taken back stops warning.
        const now = new Map(find().map((entry) => [entry.entryName, entry]))
        const signature = signatureOf(now)

        if (signature === startSignature) {
          standDown()
          lastRequested.delete(this.manifestPath)

          return
        }

        // This compiler already took this set, the restart is on its way.
        if (requested === signature) {
          heldBuilds.add(compilation)

          return
        }

        const changed: Array<{files: string[]; registeredBy?: string}> = []

        // A file and its MAIN world copy are two entries of one script,
        // which the author is told about once.
        const note = (entry: {files: string[]; registeredBy?: string}) => {
          if (changed.some(({files}) => files[0] === entry.files[0])) return

          changed.push(entry)
        }

        for (const [entryName, entry] of now) {
          if (!atStart.has(entryName)) note(entry)
        }

        for (const [entryName, files] of atStart) {
          if (!now.has(entryName)) note({files})
        }

        // A live session rebuilds itself with the new list. Without one, or
        // after a restart that did not take, the author is told to restart.
        if (
          lastRequested.get(this.manifestPath) !== signature &&
          canAutoRestartDevSession()
        ) {
          requested = signature
          awaitingRestart.add(compiler)
          heldBuilds.add(compilation)
          askOnceSettled(signature, {
            reason: 'main-world',
            pathChanged: changed[0].files[0],
            registeredBy: changed[0].registeredBy,
            alsoChanged: changed.length - 1
          })

          return
        }

        // The set a restart did not take is warned about and reloads as usual.
        standDown()

        for (const {files, registeredBy} of changed) {
          const scriptPath = relative(files[0])
          const warning = new WebpackError(
            messages.mainWorldRegistrationChanged(
              scriptPath,
              registeredBy ? relative(registeredBy) : undefined
            )
          ) as Error & {name?: string; file?: string}
          warning.name = 'MainWorldRegistrationChange'
          warning.file = registeredBy ? relative(registeredBy) : scriptPath
          compilation.warnings.push(warning)
        }
      }
    )
  }
}

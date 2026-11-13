// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {type Compiler, WebpackError} from '@rspack/core'
import {requestDevSessionRestart} from '../../../dev-server/session-restart'
import type {FilepathList, PluginInterface} from '../../../types'
import {unixify} from '../../shared/paths'
import * as messages from '../messages'
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'

// The set a restart was last asked for, by manifest. A compiler that finds
// that same set again was not put in line by the restart, so it warns.
const lastRequested = new Map<string, string>()

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

    compiler.hooks.thisCompilation.tap(
      WarnMainWorldRegistrationChanged.name,
      (compilation) => {
        // Read on every compilation, so a call taken back stops warning.
        const now = new Map(find().map((entry) => [entry.entryName, entry]))
        const signature = signatureOf(now)

        if (signature === startSignature) {
          requested = undefined
          lastRequested.delete(this.manifestPath)

          return
        }

        // This compiler already asked for this set, the restart is on its way.
        if (requested === signature) return

        const changed: Array<{files: string[]; registeredBy?: string}> = []

        for (const [entryName, entry] of now) {
          if (!atStart.has(entryName)) changed.push(entry)
        }

        for (const [entryName, files] of atStart) {
          if (!now.has(entryName)) changed.push({files})
        }

        // A live session rebuilds itself with the new list. Without one, or
        // after a restart that did not take, the author is told to restart.
        if (
          lastRequested.get(this.manifestPath) !== signature &&
          requestDevSessionRestart(compiler, {
            reason: 'main-world',
            pathChanged: changed[0].files[0],
            registeredBy: changed[0].registeredBy,
            alsoChanged: changed.length - 1
          })
        ) {
          requested = signature
          lastRequested.set(this.manifestPath, signature)

          return
        }

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

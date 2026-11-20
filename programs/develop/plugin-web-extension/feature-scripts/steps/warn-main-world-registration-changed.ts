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
  type MainWorldScriptChange,
  trackMainWorldSet
} from '../../../lib/session-restart-signal'
import type {FilepathList, PluginInterface} from '../../../types'
import {unixify} from '../../shared/paths'
import * as messages from '../messages'
import {findRuntimeMainWorldEntries} from '../scripts-lib/runtime-main-world-scripts'

function signatureOf(entries: Map<string, unknown>): string {
  return [...entries.keys()].sort().join('\n')
}

// The steps that build a MAIN world file take their list once, when the
// compiler is made. The dev server restarts a session whose set changed.
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
    const noteMainWorldSet = trackMainWorldSet(compiler, {
      name: WarnMainWorldRegistrationChanged.name,
      key: this.manifestPath,
      startSignature: signatureOf(atStart),
      readSignature: () =>
        signatureOf(new Map(find().map((entry) => [entry.entryName, entry])))
    })

    compiler.hooks.thisCompilation.tap(
      WarnMainWorldRegistrationChanged.name,
      (compilation) => {
        // Read on every compilation, so a call taken back stops warning.
        const now = new Map(find().map((entry) => [entry.entryName, entry]))
        const changed: MainWorldScriptChange[] = []

        // A file and its MAIN world copy are two entries of one script,
        // which the author is told about once.
        const note = (entry: MainWorldScriptChange) => {
          if (changed.some(({files}) => files[0] === entry.files[0])) return

          changed.push(entry)
        }

        for (const [entryName, entry] of now) {
          if (!atStart.has(entryName)) note(entry)
        }

        for (const [entryName, files] of atStart) {
          if (!now.has(entryName)) note({files})
        }

        if (noteMainWorldSet(compilation, signatureOf(now), changed)) return

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

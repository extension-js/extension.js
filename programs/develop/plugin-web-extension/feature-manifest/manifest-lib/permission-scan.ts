// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as path from 'node:path'
import {
  type EmittedCompilation,
  type EmittedModule,
  emittedFilesOf,
  readEmittedScripts,
  readProjectSource,
  shippableText
} from '../../../lib/emitted-evidence'
import {scannableSourcePath} from '../../shared/scannable-source-path'
import {usesGatedPart} from './dev-injected-permissions'
import {findTabFieldReads} from './tab-field-reads'

export interface PermissionScanCompilation extends EmittedCompilation {
  modules: Iterable<EmittedModule>
}

// A project source names the file the author can fix, so the source is what
// the scan reads and the message names. Whether the call ships is a second
// question, and the emitted script answers it: a call the build target
// branched away never runs there, so no permission covers it and naming one
// would send the author to add a permission both stores then ask about.
interface PermissionUse {
  file: string
  line?: number
  field?: string
}

function gatedUse(
  api: string,
  source: string,
  resource: string
): Omit<PermissionUse, 'file'> | undefined {
  if (api !== 'tabs') return usesGatedPart(api, source) ? {} : undefined

  const reads = findTabFieldReads(source, resource)
  if (reads === undefined) return usesGatedPart(api, source) ? {} : undefined
  if (!reads.length) return undefined

  return {line: reads[0].line, field: reads[0].field}
}

export function findInjectedOnlyPermissionUses(
  compilation: PermissionScanCompilation,
  declared: Set<string>,
  injected: readonly string[]
): Map<string, PermissionUse> {
  const firstOffenderByApi = new Map<string, PermissionUse>()
  const candidates = injected.filter((api) => !declared.has(api))
  if (!candidates.length) return firstOffenderByApi

  const emitted = readEmittedScripts(compilation)
  const shipped = new Map<string, string>()

  // One compression per script per scan, and only for a script some module
  // already named, so a project that declares its permissions pays nothing.
  const shippedText = (file: string): string | undefined => {
    if (shipped.has(file)) return shipped.get(file)

    const text = emitted.get(file)
    if (text === undefined) return undefined

    const compressed = shippableText(text)
    shipped.set(file, compressed)

    return compressed
  }

  for (const outer of compilation.modules) {
    // Production concatenates modules, so the source comes from the inner
    // ones while the chunk graph only knows the outer one.
    const inner = outer.modules ? [...outer.modules] : [outer]

    for (const module of inner) {
      const resource = scannableSourcePath(module.resource)
      if (!resource) continue

      const source = readProjectSource(resource, compilation)
      if (source === undefined) continue

      for (const api of candidates) {
        if (firstOffenderByApi.has(api)) continue

        const useRe = new RegExp(`\\b(?:chrome|browser)\\s*\\.\\s*${api}\\b`)
        if (!useRe.test(source)) continue

        const use = gatedUse(api, source, resource)
        if (!use) continue

        const files = emittedFilesOf(compilation, outer)

        // Without a chunk graph nothing ties this module to a script, so the
        // source scan is the whole answer and the warning stands on it.
        if (
          files &&
          !files.some((file) => {
            const text = shippedText(file)

            return text !== undefined && useRe.test(text)
          })
        ) {
          continue
        }

        firstOffenderByApi.set(api, {file: resource, ...use})
      }
    }

    if (firstOffenderByApi.size === candidates.length) break
  }

  return firstOffenderByApi
}

export function useLocation(manifestPath: string, use: PermissionUse): string {
  const relative = path.relative(path.dirname(manifestPath), use.file)

  return use.line ? `${relative}:${String(use.line)}` : relative
}

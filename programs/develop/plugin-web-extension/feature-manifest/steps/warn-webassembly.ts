// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, WebpackError} from '@rspack/core'
import parse from 'content-security-policy-parser'
import {isGeckoBasedBrowser} from '../../../lib/constants'
import {
  type EmittedCompilation,
  type EmittedModule,
  readEmittedScripts,
  readProjectSource
} from '../../../lib/emitted-evidence'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import {parseJsonSafe} from '../../../lib/parse-json-safe'
import type {DevOptions, Manifest} from '../../../types'
import {scannableSourcePath} from '../../shared/scannable-source-path'
import {getOriginalManifestContent} from '../manifest-lib/manifest'
import * as messages from '../messages'
import {relativeToProject} from './warn-gecko-unsupported-apis'

const WASM_POLICY_SOURCE = "'wasm-unsafe-eval'"
export const WASM_PAGES_POLICY =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"

// Manifest V2 on Chromium also compiles WebAssembly under these two.
const MV2_WASM_SOURCES = [WASM_POLICY_SOURCE, "'wasm-eval'", "'unsafe-eval'"]

const EMITTED_WASM_RE = /\.wasm$/i

// The build folds the MV3 string into extension_pages and the MV2 object
// into its extension_pages string, so both spellings name the same policy.
function pagesPolicyOf(manifest: unknown): string | undefined {
  const policy = (manifest as {content_security_policy?: unknown} | null)
    ?.content_security_policy

  if (typeof policy === 'string') return policy

  if (policy && typeof policy === 'object' && !Array.isArray(policy)) {
    const pages = (policy as {extension_pages?: unknown}).extension_pages
    if (typeof pages === 'string') return pages
  }

  return undefined
}

// Firefox compiles WebAssembly on Manifest V2 whatever the policy says. Every
// Manifest V3 browser asks for the keyword where scripts are allowed.
export function policyRunsWebAssembly(
  manifest: unknown,
  browser: string
): boolean {
  const version = Number(
    (manifest as {manifest_version?: unknown} | null)?.manifest_version
  )

  if (version === 2 && isGeckoBasedBrowser(browser)) return true

  const policy = pagesPolicyOf(manifest)
  if (!policy) return false

  const csp = parse(policy)
  const sources = (csp.get('script-src') || csp.get('default-src') || []).map(
    (source) => source.toLowerCase()
  )
  const accepted = version === 2 ? MV2_WASM_SOURCES : [WASM_POLICY_SOURCE]

  return accepted.some((source) => sources.includes(source))
}

function findEmittedWebAssembly(compilation: EmittedCompilation): string[] {
  try {
    return (compilation.getAssets?.() || [])
      .map((asset) => asset.name)
      .filter((name) => EMITTED_WASM_RE.test(name))
      .sort()
  } catch {
    return []
  }
}

interface RemoteWebAssemblyHit {
  // The emitted script that carries the address
  file: string
  address: string
}

// A whole string literal that is a remote address ending in .wasm.
const REMOTE_WASM_RE =
  /["'`](https?:\/\/[^"'`\s\\<>]+?\.wasm(?:[?#][^"'`\s\\<>]*)?)\\?["'`]/g

// The emscripten hook that answers where the binary lives. Only the first
// string after the name counts, so Module["locateFile"](path) stays quiet.
const LOCATE_FILE_RE =
  /\blocateFile\b[^"'`]{0,120}["'`](https?:\/\/[^"'`\s\\<>$]+)/g

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function isLoopbackAddress(address: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(address).hostname)
  } catch {
    return false
  }
}

export function findRemoteWebAssemblyAddresses(text: string): string[] {
  if (!text.includes('.wasm') && !text.includes('locateFile')) return []

  const found = new Set<string>()

  for (const pattern of [REMOTE_WASM_RE, LOCATE_FILE_RE]) {
    for (const match of text.matchAll(pattern)) {
      if (!isLoopbackAddress(match[1])) found.add(match[1])
    }
  }

  return [...found]
}

function findRemoteWebAssembly(
  compilation: EmittedCompilation
): RemoteWebAssemblyHit[] {
  const hits: RemoteWebAssemblyHit[] = []

  for (const [file, text] of readEmittedScripts(compilation)) {
    for (const address of findRemoteWebAssemblyAddresses(text)) {
      hits.push({file, address})
    }
  }

  return hits
}

interface SourceCompilation extends EmittedCompilation {
  modules?: Iterable<EmittedModule>
}

// The emitted script proves the address ships. The project file that spells
// it is the one the author edits, so it is named when one is found.
export function sourceFileOf(
  compilation: SourceCompilation,
  address: string,
  projectPath: string
): string | undefined {
  try {
    for (const outer of compilation.modules || []) {
      for (const module of outer.modules ? [...outer.modules] : [outer]) {
        const resource = scannableSourcePath(module.resource)
        if (!resource) continue

        if (readProjectSource(resource, compilation)?.includes(address)) {
          return relativeToProject(projectPath, resource)
        }
      }
    }
  } catch {
    // The emitted name is the fallback
  }

  return undefined
}

export class WarnWebAssembly {
  public static readonly name: string = 'manifest:warn-webassembly'
  private readonly browser: string
  // A dev session recompiles on every save. One line per distinct finding is
  // enough there, and production prints every build.
  private reported = new Set<string>()

  constructor(options: {browser: DevOptions['browser']}) {
    this.browser = String(options.browser || 'chrome')
  }

  private isNew(compiler: Compiler, signature: string): boolean {
    if (compiler.options.mode !== 'development') return true
    if (this.reported.has(signature)) return false

    this.reported.add(signature)

    return true
  }

  private warn(
    compilation: Compilation,
    name: string,
    file: string,
    message: string
  ) {
    const warn = new WebpackError(message) as Error & {
      file?: string
      name?: string
    }
    warn.name = name
    warn.file = file
    compilation.warnings.push(warn)
  }

  private reportPolicy(compiler: Compiler, compilation: Compilation) {
    const original = getOriginalManifestContent(compilation)
    if (!original) return

    const files = findEmittedWebAssembly(
      compilation as unknown as EmittedCompilation
    )
    if (!files.length) return

    const manifest = filterKeysForThisBrowser(
      parseJsonSafe(original) as Manifest,
      this.browser as DevOptions['browser']
    )
    if (policyRunsWebAssembly(manifest, this.browser)) return

    const policy = pagesPolicyOf(manifest)
    // A content hash moves on every edit of the binary, so the session
    // signature is the policy alone.
    if (!this.isNew(compiler, `policy\0${policy || ''}`)) return

    this.warn(
      compilation,
      'WebAssemblyPolicyWarning',
      'manifest.json',
      messages.webAssemblyPolicyMissing(
        this.browser,
        files,
        Number(manifest.manifest_version) === 2
          ? 'content_security_policy'
          : 'content_security_policy.extension_pages',
        WASM_PAGES_POLICY,
        Boolean(policy)
      )
    )
  }

  private reportRemote(compiler: Compiler, compilation: Compilation) {
    const projectPath = compiler.options.context || process.cwd()
    const seen = new Set<string>()
    const hits: RemoteWebAssemblyHit[] = []

    for (const hit of findRemoteWebAssembly(
      compilation as unknown as EmittedCompilation
    )) {
      const file =
        sourceFileOf(
          compilation as unknown as SourceCompilation,
          hit.address,
          projectPath
        ) || hit.file
      const key = `${file}\0${hit.address}`
      if (seen.has(key)) continue

      seen.add(key)
      hits.push({file, address: hit.address})
    }

    if (!hits.length) return
    if (!this.isNew(compiler, `remote\0${[...seen].sort().join('\n')}`)) return

    this.warn(
      compilation,
      'RemoteWebAssemblyWarning',
      hits[0].file,
      messages.webAssemblyFetchedFromRemote(hits)
    )
  }

  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(WarnWebAssembly.name, (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: WarnWebAssembly.name,
          stage: Compilation.PROCESS_ASSETS_STAGE_REPORT
        },
        () => {
          // Diagnostics only, so neither scan may fail the compile.
          try {
            this.reportPolicy(compiler, compilation)
          } catch {
            // Ignore
          }

          try {
            this.reportRemote(compiler, compilation)
          } catch {
            // Ignore
          }
        }
      )
    })
  }
}

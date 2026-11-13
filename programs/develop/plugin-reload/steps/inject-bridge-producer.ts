// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {createHash} from 'node:crypto'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {
  buildBridgeProducerSource,
  CONTROL_PORT_ASSET_NAME,
  DEV_BOOT_REGISTERS_GLOBAL
} from '../../dev-server/control-bridge/producer-runtime'
import {prependToEmittedAsset} from '../../lib/asset-source-maps'
import {
  type EmittedCompilation,
  type EmittedModule,
  emittedFilesOf,
  readProjectSource
} from '../../plugin-web-extension/feature-manifest/steps/apply-dev-defaults-lib/emitted-evidence'
import {DEV_BUILD_GLOBAL} from '../reload-dispatch'

// Matches the compiled background entry across engines: Chromium emits
// background/service_worker.js, Firefox background/scripts.js, and a declared
// background page compiles to background/index.js; scripts? covers both forms.
const BACKGROUND_ASSET =
  /(^|\/)background\/(?:service_worker|scripts?|index)\.js$/i

const builds = new WeakMap<object, string>()
const bootRegistrations = new WeakMap<object, boolean>()
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte)$/i
const REGISTERS_A_CONTENT_SCRIPT = 'registerContentScripts'

// The build a compilation named its background by, or '' when it named none.
export function readDevBuild(compilation: object | undefined): string {
  return (compilation && builds.get(compilation)) || ''
}

// Whether a compilation's background names a content script registration,
// which is when the first page waits for the calls it makes as it starts.
export function readBootRegistrations(
  compilation: object | undefined
): boolean {
  return Boolean(compilation && bootRegistrations.get(compilation))
}

// Read from the files the author wrote: the dev runtime the build adds to a
// background names the same call in every project.
export function backgroundNamesRegistration(
  compilation: EmittedCompilation & {modules?: Iterable<EmittedModule>}
): boolean {
  try {
    for (const outer of compilation.modules || []) {
      const files = emittedFilesOf(compilation, outer)
      if (!files?.some((file) => BACKGROUND_ASSET.test(file))) continue

      for (const module of outer.modules ? [...outer.modules] : [outer]) {
        const resource = String(module.resource || '').split('?')[0]
        if (!SOURCE_FILE.test(resource)) continue

        if (readProjectSource(resource)?.includes(REGISTERS_A_CONTENT_SCRIPT)) {
          return true
        }
      }
    }
  } catch {
    // A module graph that cannot be read names no registration.
  }

  return false
}

// Every file a restarted extension reads from disk. The compilation hash
// moves on a compile that changed no byte, so a script is digested without it.
function digestBuild(compilation: Compilation): string {
  const stamp = String(compilation.hash || '')
  const digest = createHash('sha256')
  const assets = [...compilation.getAssets()].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  )

  for (const asset of assets) {
    // A hot update is written anew by every compile, under that compile's hash.
    // The control file names the session, and the build is what the session
    // runs: the same files give the same build in the next session too.
    if (
      asset.name === CONTROL_PORT_ASSET_NAME ||
      asset.name.endsWith('.map') ||
      asset.name.startsWith('hot/') ||
      asset.name.includes('.hot-update.')
    ) {
      continue
    }

    digest.update(`${asset.name}\0`)

    if (stamp && /\.[cm]?js$/i.test(asset.name)) {
      digest.update(asset.source.source().toString().split(stamp).join(''))
    } else {
      digest.update(asset.source.buffer())
    }

    digest.update('\0')
  }

  return digest.digest('hex').slice(0, 16)
}

// Prepends the agent-bridge producer to the compiled background SW; control
// port + instanceId come from process.env, nothing injected when unavailable.
export class InjectBridgeProducer {
  apply(compiler: Compiler) {
    const controlPort = parseInt(
      String(process.env.EXTENSION_CONTROL_PORT || ''),
      10
    )
    const instanceId = String(process.env.EXTENSION_INSTANCE_ID || '')
    // Connectable host of the control WS (loopback locally; the public host for
    // remote/devcontainer). Resolved once by dev-server/index.ts.
    const host =
      String(process.env.EXTENSION_DEV_SERVER_CONNECTABLE_HOST || '').trim() ||
      '127.0.0.1'
    const source = buildBridgeProducerSource({
      controlPort: Number.isFinite(controlPort) ? controlPort : null,
      instanceId,
      sessionFromFile: true,
      context: 'background',
      host
    })

    if (!source) return

    // Read once, from the first compile that built: the answer only decides
    // how the session opens its first page.
    let registersAtBoot: boolean | undefined

    compiler.hooks.thisCompilation.tap(
      InjectBridgeProducer.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: InjectBridgeProducer.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 101
          },
          () => {
            // A profile-cached SW keeps running the OLD bundle after a server
            // restart; this file is its only path to the live port (fetched
            // from disk, so it is always the current session's value).
            // It is REWRITTEN every compile on purpose: an emit guarded on
            // absence left a previous session's instanceId in place, and the
            // instance id gates every hello, so the extension could never
            // reconnect to the new session.
            const controlAsset = new sources.RawSource(
              JSON.stringify({
                port: controlPort,
                instanceId,
                buildType: 'development'
              })
            )

            if (compilation.getAsset(CONTROL_PORT_ASSET_NAME)) {
              compilation.updateAsset(CONTROL_PORT_ASSET_NAME, controlAsset)
            } else {
              compilation.emitAsset(CONTROL_PORT_ASSET_NAME, controlAsset)
            }

            let build = ''

            try {
              build = digestBuild(compilation)
            } catch {
              // An unreadable asset names no build, and nothing is skipped.
            }

            builds.set(compilation, build)

            const registers =
              registersAtBoot ??
              backgroundNamesRegistration(
                compilation as unknown as EmittedCompilation
              )

            if (!compilation.errors?.length) registersAtBoot = registers

            bootRegistrations.set(compilation, registers)

            for (const asset of compilation.getAssets()) {
              if (!BACKGROUND_ASSET.test(asset.name)) continue

              const original = asset.source.source().toString()

              if (original.indexOf('__extjsBridgeProducerInstalled') !== -1) {
                continue
              }

              // The worker tells the broker which build it runs, so a reload
              // for that same build is not applied a second time.
              const named = build
                ? `;globalThis.${DEV_BUILD_GLOBAL}=${JSON.stringify(build)};\n`
                : ''

              const watched = registers
                ? `;globalThis.${DEV_BOOT_REGISTERS_GLOBAL}=true;\n`
                : ''

              prependToEmittedAsset(
                compilation,
                asset,
                `${named}${watched}${source}\n`
              )
            }
          }
        )
      }
    )
  }
}

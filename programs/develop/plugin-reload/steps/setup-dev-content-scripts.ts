// ██████╗ ███████╗██╗      ██████╗  █████╗ ██████╗
// ██╔══██╗██╔════╝██║     ██╔═══██╗██╔══██╗██╔══██╗
// ██████╔╝█████╗  ██║     ██║   ██║███████║██║  ██║
// ██╔══██╗██╔══╝  ██║     ██║   ██║██╔══██║██║  ██║
// ██║  ██║███████╗███████╗╚██████╔╝██║  ██║██████╔╝
// ╚═╝  ╚═╝╚══════╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {Compilation, type Compiler, sources} from '@rspack/core'
import {prependToEmittedAsset} from '../../lib/asset-source-maps'
import {
  getCurrentManifestContent,
  setCurrentManifestContent
} from '../../plugin-web-extension/feature-manifest/manifest-lib/manifest'
import type {Manifest} from '../../types'
import {
  buildDevContentScriptMarkerPrelude,
  contentScriptEntryForAsset,
  DEV_CONTENT_SCRIPT_REGISTRY_ASSET,
  DEV_CONTENT_SCRIPTS_RUNTIME_SOURCE,
  planDevContentScripts
} from '../reload-lib/dev-content-scripts'

// The compiled background entry the runtime is prepended to; the same shapes
// the bridge producer targets, since both must ride the one worker bundle.
const BACKGROUND_ASSET =
  /(^|\/)background\/(?:service_worker|scripts?|index)\.js$/i

function putAsset(compilation: Compilation, name: string, text: string) {
  const source = new sources.RawSource(text)

  if (compilation.getAsset(name)) compilation.updateAsset(name, source)
  else compilation.emitAsset(name, source)
}

// Chromium development only: the manifest's content_scripts entries become
// signalling stubs, the real bundles are registered by a runtime in the
// worker from a registry emitted beside them, and each bundle marks its
// world so no injection path ever adds a second copy. Runs after the
// manifest step resolved the hashed bundle names and before persist-manifest
// captures the manifest, so the gate that refuses to name a missing file
// still guards the stubs.
export class SetupDevContentScripts {
  apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      SetupDevContentScripts.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: SetupDevContentScripts.name,
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 100
          },
          () => {
            if (compilation.errors.length > 0) return

            const background = compilation
              .getAssets()
              .find((asset) => BACKGROUND_ASSET.test(asset.name))
            // Without a worker nothing could register the real bundles, so
            // the manifest keeps its static entries.
            if (!background) return

            const manifestAsset = compilation.getAsset('manifest.json')
            if (!manifestAsset) return

            let manifest: Manifest

            // The manifest feature hands its latest text down a shared slot
            // that persist-manifest reads before the asset; read and write
            // that slot too, or the file on disk keeps the real entries.
            try {
              manifest = JSON.parse(
                getCurrentManifestContent(compilation) ||
                  manifestAsset.source.source().toString()
              ) as Manifest
            } catch {
              return
            }

            const plan = planDevContentScripts(manifest)
            if (!plan) return

            for (const asset of compilation.getAssets()) {
              const entry = contentScriptEntryForAsset(asset.name)
              if (!entry) continue

              const text = asset.source.source().toString()

              if (
                text.includes(
                  buildDevContentScriptMarkerPrelude(entry, asset.name)
                )
              ) {
                continue
              }

              prependToEmittedAsset(
                compilation,
                asset,
                buildDevContentScriptMarkerPrelude(entry, asset.name)
              )
            }

            for (const [name, text] of Object.entries(plan.stubs)) {
              putAsset(compilation, name, text)
            }

            putAsset(
              compilation,
              DEV_CONTENT_SCRIPT_REGISTRY_ASSET,
              `${JSON.stringify(plan.registry, null, 2)}\n`
            )

            const manifestText = JSON.stringify(plan.manifest, null, 2)
            putAsset(compilation, 'manifest.json', manifestText)
            setCurrentManifestContent(compilation, manifestText)

            const backgroundText = background.source.source().toString()

            if (backgroundText.includes('__extjsDevContentScriptsInstalled')) {
              return
            }

            prependToEmittedAsset(
              compilation,
              background,
              DEV_CONTENT_SCRIPTS_RUNTIME_SOURCE
            )
          }
        )
      }
    )
  }
}

import {type Compiler, sources} from '@rspack/core'
import {CONTROL_PORT_ASSET_NAME} from '../../../dev-server/control-bridge/producer-runtime'

type Tap = {name: string; fn: (compilation: unknown) => void}

// The control file the bridge producer applied to this compiler writes, from
// its own tap, for a compilation that holds one worker. Null when none.
export function bakedBridgeControl(
  compiler: Compiler
): Record<string, unknown> | null {
  const tap = (
    compiler.hooks.thisCompilation as unknown as {taps: Tap[]}
  ).taps.find(({name}) => name === 'InjectBridgeProducer')

  if (!tap) return null

  const assets: Record<string, {name: string; source: sources.Source}> = {
    'background/service_worker.js': {
      name: 'background/service_worker.js',
      source: new sources.RawSource('/* worker */')
    }
  }
  const processAssets: Array<() => void> = []

  const put = (name: string, source: sources.Source) => {
    assets[name] = {name, source}
  }

  tap.fn({
    hooks: {
      processAssets: {
        tap: (_options: unknown, fn: () => void) => processAssets.push(fn)
      }
    },
    getAssets: () => Object.values(assets),
    getAsset: (name: string) => assets[name],
    emitAsset: put,
    updateAsset: put
  })

  for (const run of processAssets) run()

  const control = assets[CONTROL_PORT_ASSET_NAME]

  return control ? JSON.parse(String(control.source.source())) : null
}

// ██████╗ ███████╗██████╗ ███████╗      ██████╗ ██╗   ██╗██████╗  ██████╗ ███████╗████████╗███████╗
// ██╔══██╗██╔════╝██╔══██╗██╔════╝      ██╔══██╗██║   ██║██╔══██╗██╔════╝ ██╔════╝╚══██╔══╝██╔════╝
// ██████╔╝█████╗  ██████╔╝█████╗  █████╗██████╔╝██║   ██║██║  ██║██║  ███╗█████╗     ██║   ███████╗
// ██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ╚════╝██╔══██╗██║   ██║██║  ██║██║   ██║██╔══╝     ██║   ╚════██║
// ██║     ███████╗██║  ██║██║          ██████╔╝╚██████╔╝██████╔╝╚██████╔╝███████╗   ██║   ███████║
// ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝          ╚═════╝  ╚═════╝ ╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import type {AssetCategory} from './categorize'

function fmtKiB(bytes: number): string {
  const kib = bytes / 1024
  if (kib >= 1024) return `${(kib / 1024).toFixed(2)} MiB`

  return `${kib.toFixed(1)} KiB`
}

export interface OversizedAsset {
  name: string
  size: number
  budget: number
  category: AssetCategory
}

export function perfBudgetWarning(assets: OversizedAsset[]): string {
  const count = assets.length
  const header =
    `${count === 1 ? 'One asset exceeds' : `${count} assets exceed`} the ` +
    'extension performance budget. Browser extensions inject content ' +
    'scripts on every navigation and wake service workers from cold, so ' +
    'Extension.js applies tighter budgets than the rspack default.'

  const lines = assets.map((a) => {
    const over = ((a.size / a.budget) * 100 - 100).toFixed(0)

    return (
      `  ${a.name}\n` +
      `    size:   ${fmtKiB(a.size)}\n` +
      `    budget: ${fmtKiB(a.budget)}  (over by ${over}%)\n` +
      `    role:   ${categoryRole(a.category)}`
    )
  })

  // A copied file never met the bundler, so code splitting is no answer
  // for it: the remedy names the public/ source instead. A wasm runtime is
  // one file by nature, whichever budget it fell under, so its remedy is a
  // smaller build, a remote fetch or the budget knobs.
  const isWasm = (a: OversizedAsset) => /\.wasm$/i.test(a.name)
  const remediation = [
    ...(assets.some((a) => a.category !== 'public' && !isWasm(a))
      ? [
          'Lazy-load with dynamic import(), code-split per route, or replace ' +
            'large SDKs with thin fetch wrappers.\n' +
            'See https://rspack.rs/guide/optimization/code-splitting'
        ]
      : []),
    ...(assets.some((a) => a.category === 'public')
      ? [
          'A public/ file ships as authored: minify or trim it at its source, ' +
            'or fetch it on demand instead of shipping it in the package.'
        ]
      : []),
    ...(assets.some(isWasm)
      ? [
          'A .wasm runtime cannot be code-split: pick a smaller build of the ' +
            'library when it offers one (no threads, no SIMD), fetch it from ' +
            'your own server on demand, raise perfBudgets.wasm in ' +
            'extension.config.js when this size is intended, or list the ' +
            'file under perfBudgets.ignore.'
        ]
      : [])
  ].join('\n')

  return `${header}\n\n${lines.join('\n')}\n\n${remediation}`
}

function categoryRole(c: AssetCategory): string {
  switch (c) {
    case 'content-script':
      return 'content script, injected on every page navigation'
    case 'service-worker':
      return 'service worker / background, wakes from cold each session'
    case 'page':
      return 'UI page, opened on demand'
    case 'shared':
      return 'shared chunk, loaded by every page that imports it'
    case 'public':
      return 'copied public file, shipped as authored'
    case 'runtime':
      return 'runtime payload, reached by a content script or the service worker, or shipped at the output root'
    case 'wasm':
      return 'WebAssembly runtime, fetched when its feature runs'
    default:
      return 'asset'
  }
}

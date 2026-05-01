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
  const header =
    `${assets.length === 1 ? 'asset exceeds' : 'assets exceed'} the ` +
    'extension performance budget. Browser extensions inject content ' +
    'scripts on every navigation and wake service workers from cold, so ' +
    'we apply tighter budgets than the rspack default.'

  const lines = assets.map((a) => {
    const over = ((a.size / a.budget) * 100 - 100).toFixed(0)
    return (
      `  ${a.name}\n` +
      `    size:   ${fmtKiB(a.size)}\n` +
      `    budget: ${fmtKiB(a.budget)}  (over by ${over}%)\n` +
      `    role:   ${categoryRole(a.category)}`
    )
  })

  const remediation =
    'Recommended: lazy-load with dynamic import(), code-split per route, ' +
    'or replace large SDKs with thin fetch wrappers. ' +
    'See https://rspack.rs/guide/optimization/code-splitting'

  return `${header}\n\n${lines.join('\n')}\n\n${remediation}`
}

function categoryRole(c: AssetCategory): string {
  switch (c) {
    case 'content-script':
      return 'content script — injected on every page navigation'
    case 'service-worker':
      return 'service worker / background — wakes from cold each session'
    case 'page':
      return 'UI page — opened on demand'
    default:
      return 'asset'
  }
}

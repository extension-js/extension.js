// Regression coverage for the controller-level reload serialization that
// wraps both Chromium (CDP) and Firefox (RDP) launchers. The user-facing
// symptom: editing one file (e.g. _locales/en/messages.json) sometimes
// produced a sequence of flashes because multiple sources can land a reload
// request inside the same save window. The serialization gate guarantees at
// most one reload runs at a time and merges any reloads that arrive while
// one is in flight into a single follow-up.

import {describe, it, expect, vi} from 'vitest'

// Internal helper exported for test purposes only — the production code
// uses the same function in two places (Chromium + Firefox launch paths).
import {__test__} from '../index'

describe('reload serialization gate', () => {
  it('runs reloads sequentially and never overlaps two perform() calls', async () => {
    const order: string[] = []
    let inFlightCount = 0
    let maxInFlight = 0

    const perform = async (instruction: any) => {
      inFlightCount++
      maxInFlight = Math.max(maxInFlight, inFlightCount)
      order.push(`start:${instruction.type}`)
      await new Promise((r) => setTimeout(r, 20))
      order.push(`end:${instruction.type}`)
      inFlightCount--
    }

    const reload = __test__.serializeReloads(perform)

    // Fire three reloads back-to-back. The first runs immediately; the next
    // two are coalesced into one follow-up that fires after the settle window.
    await Promise.all([
      reload({type: 'full', changedAssets: ['a']}),
      reload({type: 'full', changedAssets: ['b']}),
      reload({type: 'full', changedAssets: ['c']})
    ])

    expect(maxInFlight).toBe(1)
    // first call drains; remaining two coalesce into exactly one follow-up call
    const startCount = order.filter((s) => s.startsWith('start:')).length
    expect(startCount).toBeLessThanOrEqual(2)
  })

  it('coalesces multiple in-flight requests into a single follow-up', async () => {
    let performCount = 0
    const perform = async () => {
      performCount++
      await new Promise((r) => setTimeout(r, 30))
    }

    const reload = __test__.serializeReloads(perform)

    // Start one reload, then queue 5 more while it's in flight + settling.
    const first = reload({type: 'full', changedAssets: ['save1']})
    // Wait until first reload is in flight before piling up more.
    await new Promise((r) => setTimeout(r, 5))
    for (let i = 0; i < 5; i++) {
      void reload({type: 'full', changedAssets: [`save-extra-${i}`]})
    }
    await first

    // Wait for any pending follow-up to drain.
    await new Promise((r) => setTimeout(r, 600))

    // 1 initial + at most 1 coalesced follow-up = 2 reloads total.
    // The five queued requests must NOT each trigger their own perform call.
    expect(performCount).toBeLessThanOrEqual(2)
  })

  it('upgrades content-scripts + service-worker to a single service-worker reload', () => {
    const merged = __test__.mergeReloadInstructions(
      {
        type: 'content-scripts',
        changedContentScriptEntries: ['content_scripts/content-0'],
        changedAssets: ['a.tsx']
      },
      {
        type: 'service-worker',
        changedAssets: ['background.ts']
      }
    )
    expect(merged.type).toBe('service-worker')
    // Service-worker restart re-evaluates content-scripts at injection time,
    // so dropping the per-entry list here is safe.
    expect(merged.changedAssets).toEqual(['a.tsx', 'background.ts'])
  })

  it('upgrades anything mixed with full to a full reload', () => {
    const merged = __test__.mergeReloadInstructions(
      {type: 'service-worker', changedAssets: ['sw.ts']},
      {type: 'full', changedAssets: ['_locales/en/messages.json']}
    )
    expect(merged.type).toBe('full')
    expect(merged.changedAssets).toEqual([
      'sw.ts',
      '_locales/en/messages.json'
    ])
  })

  it('merges two content-scripts requests deduping entries', () => {
    const merged = __test__.mergeReloadInstructions(
      {
        type: 'content-scripts',
        changedContentScriptEntries: [
          'content_scripts/content-0',
          'content_scripts/content-1'
        ],
        changedAssets: ['a']
      },
      {
        type: 'content-scripts',
        changedContentScriptEntries: ['content_scripts/content-1'],
        changedAssets: ['b']
      }
    )
    expect(merged.type).toBe('content-scripts')
    expect(merged.changedContentScriptEntries).toEqual([
      'content_scripts/content-0',
      'content_scripts/content-1'
    ])
    expect(merged.changedAssets).toEqual(['a', 'b'])
  })

  it('drops undefined instructions without invoking perform', async () => {
    const perform = vi.fn(async () => {})
    const reload = __test__.serializeReloads(perform)

    await reload(undefined as any)
    expect(perform).not.toHaveBeenCalled()
  })
})

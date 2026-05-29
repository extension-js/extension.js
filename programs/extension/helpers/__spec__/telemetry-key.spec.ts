import {describe, it, expect} from 'vitest'
import {DEFAULT_POSTHOG_KEY} from '../telemetry'

describe('telemetry ingestion key', () => {
  // Regression guard: removing the hardcoded PostHog key fallback silenced all
  // CLI telemetry from v3.14.0 onward (published builds have no POSTHOG_KEY at
  // runtime, so track() bailed on the empty-key guard). The default must always
  // resolve to a non-empty ingestion key, even when POSTHOG_KEY is unset.
  it('always resolves to a non-empty PostHog key', () => {
    expect(DEFAULT_POSTHOG_KEY.length).toBeGreaterThan(0)
  })
})

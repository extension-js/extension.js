import {describe, expect, it} from 'vitest'
import {DEFAULT_POSTHOG_KEY} from '../telemetry'

describe('telemetry ingestion key', () => {
  it('always resolves to a non-empty PostHog key', () => {
    expect(DEFAULT_POSTHOG_KEY.length).toBeGreaterThan(0)
  })
})

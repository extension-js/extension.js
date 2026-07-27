import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// The warn-once latch is module state, so every test imports a fresh copy.
async function freshModule() {
  vi.resetModules()
  return import('../output-flag')
}

let errorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('resolveOutputFormat', () => {
  it('defaults to pretty when nothing is passed', async () => {
    const {resolveOutputFormat} = await freshModule()
    expect(resolveOutputFormat({})).toBe('pretty')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('honors --output without warning', async () => {
    const {resolveOutputFormat} = await freshModule()
    expect(resolveOutputFormat({output: 'json'})).toBe('json')
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('maps the --wait-format alias onto --output and warns on stderr', async () => {
    const {resolveOutputFormat} = await freshModule()
    expect(resolveOutputFormat({waitFormat: 'json'})).toBe('json')
    expect(errorSpy).toHaveBeenCalledTimes(1)
    const notice = String(errorSpy.mock.calls[0][0])
    expect(notice).toContain('--wait-format')
    expect(notice).toContain('--output')
    expect(notice).toContain('deprecated')
  })

  it('maps the --format alias and names it in the notice', async () => {
    const {resolveOutputFormat} = await freshModule()
    expect(resolveOutputFormat({format: 'json'})).toBe('json')
    expect(String(errorSpy.mock.calls[0][0])).toContain('--format')
  })

  it('warns once per process, not once per alias', async () => {
    const {resolveOutputFormat} = await freshModule()
    resolveOutputFormat({format: 'json', waitFormat: 'json'})
    resolveOutputFormat({waitFormat: 'pretty'})
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('lets an explicit --output beat any alias, silently', async () => {
    const {resolveOutputFormat} = await freshModule()
    expect(resolveOutputFormat({output: 'pretty', waitFormat: 'json'})).toBe(
      'pretty'
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('ignores unrecognized values like the old parsers did', async () => {
    const {resolveOutputFormat} = await freshModule()
    expect(resolveOutputFormat({output: 'bogus', waitFormat: 'nope'})).toBe(
      'pretty'
    )
    expect(errorSpy).not.toHaveBeenCalled()
  })
})

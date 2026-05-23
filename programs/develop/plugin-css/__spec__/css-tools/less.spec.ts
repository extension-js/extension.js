import {describe, it, expect, vi, beforeEach} from 'vitest'

const {lessHasDependencyMock} = vi.hoisted(() => ({
  lessHasDependencyMock: vi.fn(() => false)
}))

vi.mock('../../../lib/has-dependency', () => ({
  hasDependency: (...args: [string, string]) => lessHasDependencyMock(...args)
}))

describe('less tools', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ;(process as any).env.EXTENSION_AUTHOR_MODE = 'true'
  })

  it('isUsingLess returns true when dependency is present and logs once', async () => {
    lessHasDependencyMock.mockImplementation(
      (_p: string, dep: string) => dep === 'less'
    )

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const {isUsingLess} = await import('../../css-tools/less')
    expect(isUsingLess('/p')).toBe(true)
    expect(isUsingLess('/p')).toBe(true)
    expect(logSpy).toHaveBeenCalledTimes(1)
  })

  it('maybeUseLess resolves without emitting rules when less is not in use', async () => {
    const less = await import('../../css-tools/less')
    // less not declared (mock returns false) -> no contract work, returns void.
    await expect(less.maybeUseLess('/p')).resolves.toBeUndefined()
  })
})

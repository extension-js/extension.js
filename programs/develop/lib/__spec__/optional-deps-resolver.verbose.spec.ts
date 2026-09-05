import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveOptionalPackageWithoutInstall} from '../optional-deps-resolver'

// A best-effort resolver step that fails stays quiet by default and says
// what it swallowed under EXTENSION_VERBOSE=1, through the branded prefix.
describe('optional-deps-resolver swallowed errors', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('stays silent by default and speaks under EXTENSION_VERBOSE=1', () => {
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {})
    // An unresolvable package throws the formatted resolver error either way;
    // what changes with verbose is whether the swallowed steps on the way spoke.
    const attempt = () => {
      try {
        resolveOptionalPackageWithoutInstall({
          projectPath: '/definitely/not/a/project',
          dependencyId: 'not-a-real-package-xyz'
        } as any)
      } catch {
        // Expected: nothing resolves it.
      }
    }
    vi.stubEnv('EXTENSION_VERBOSE', '')
    attempt()
    expect(quiet.mock.calls.flat().join(' ')).not.toContain('optional-deps')

    quiet.mockClear()
    vi.stubEnv('EXTENSION_VERBOSE', '1')
    attempt()
    const said = quiet.mock.calls.flat().join(' ')
    expect(said).toContain('optional-deps')
    expect(said).toContain('not-a-real-package-xyz')
  })
})

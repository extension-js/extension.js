import {describe, expect, it} from 'vitest'
import {exportSessionEnv} from '../session-env'

describe('a variable a dev session exports for its compilers', () => {
  it('leaves the host as it was, set or unset, once the session ends', () => {
    const env: Record<string, string | undefined> = {KEPT: 'host'}
    const releaseKept = exportSessionEnv('KEPT', 'session', env)
    const releaseNew = exportSessionEnv('NEW', '8080', env)

    expect(env).toEqual({KEPT: 'session', NEW: '8080'})

    releaseNew()
    releaseKept()
    releaseKept()

    expect(env).toEqual({KEPT: 'host'})
    expect('NEW' in env).toBe(false)
  })

  it('reads as the newest live session wrote it, whichever ends first', () => {
    const env: Record<string, string | undefined> = {}
    const releaseA = exportSessionEnv('PORT', '8080', env)
    const releaseB = exportSessionEnv('PORT', '8081', env)
    const releaseC = exportSessionEnv('PORT', '8080', env)

    expect(env.PORT).toBe('8080')

    // The oldest ends first: the two still live keep theirs.
    releaseA()
    expect(env.PORT).toBe('8080')

    releaseC()
    expect(env.PORT).toBe('8081')

    releaseB()
    expect('PORT' in env).toBe(false)

    // The next session starts from the host's own value again.
    env.PORT = 'host'
    exportSessionEnv('PORT', '9000', env)()
    expect(env.PORT).toBe('host')
  })
})

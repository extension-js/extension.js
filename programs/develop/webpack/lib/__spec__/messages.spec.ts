import {describe, it, expect} from 'vitest'
import * as messages from '../messages'

describe('messages', () => {
  it('formats server running message', () => {
    const msg = messages.serverIsRunning(false, 1234)
    expect(msg).toContain('ws://localhost:1234')
  })

  it('formats port in use warnings', () => {
    expect(messages.defaultPortInUse(8080)).toContain('8080')
    expect(messages.portInUse(8080, 3000)).toContain('3000')
  })
})

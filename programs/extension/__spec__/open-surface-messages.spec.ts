import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {describe, expect, it} from 'vitest'

// Two refusals that used to send the reader somewhere useless.
//
// `open sidebar` surfaced Chromium's own sentence, which names a rule without
// naming the way out. `open popup` answered "is the session started with
// --allow-control?" on close code 4003 even when it was, because every close
// code shared one hint. Both are messages, not behaviour: Chromium's gesture
// rule stands either way, and this is about what the reader is told.
const root = join(__dirname, '..', '..')

describe('open-surface refusals say something the reader can act on', () => {
  it('tells a gesture-blocked caller what actually opens the surface', () => {
    const act = readFileSync(join(root, 'extension/commands/act.ts'), 'utf-8')
    const hint = act.slice(act.indexOf('E_USER_GESTURE_REQUIRED'))
    expect(hint).toContain('only in response to a click')
    expect(hint).toContain('toolbar')
    // The old behaviour was to pass the engine sentence through untouched.
    expect(act).not.toContain(
      'may only be called in response to a user gesture'
    )
  })

  it('stops blaming --allow-control when the channel is simply absent', () => {
    const client = readFileSync(
      join(root, 'develop/dev-server/control-bridge/controller-client.ts'),
      'utf-8'
    )
    expect(client).toContain('CLOSE_CONTROL_UNAVAILABLE')
    expect(client).toContain('the session has no control channel')
    // The flag hint must survive for the codes it genuinely explains.
    expect(client).toContain('is the session started with')
  })
})

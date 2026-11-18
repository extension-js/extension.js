import {describe, expect, it} from 'vitest'
import {CODES} from '../../lib/messaging'
import {createLifecycleStream} from '../lifecycle-stream'
import {endSessionAsFailed, registerLiveSession} from '../session-end'

describe('a host ending the dev sessions of its process as failed', () => {
  it('says no session is live, so the host reports the failure itself', () => {
    expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'the owner is gone')).toBe(
      false
    )
  })

  it('has each live session write its one failed frame and nothing after', () => {
    const saved = process.env.EXTENSION_OUTPUT
    process.env.EXTENSION_OUTPUT = 'ndjson'
    const lines: string[] = []
    const ended: string[] = []
    const stream = createLifecycleStream({
      command: 'dev',
      browser: 'chromium',
      distPath: '/proj/dist/chromium',
      write: (line) => lines.push(line)
    })
    // Wired as the dev server wires a session.
    const unregister = registerLiveSession((code, message) => {
      stream.failed(message, code)
      ended.push('shutdown')
    })
    const unregisterBroken = registerLiveSession(() => {
      throw new Error('this session could not end')
    })

    try {
      stream.starting({requestedPort: 8080, port: 8080})

      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'the owner is gone')).toBe(
        true
      )

      // The signal the host sends itself next, and the exit after it.
      stream.interrupted('SIGTERM')
      stream.exited(1)

      const frames = lines.map((line) => JSON.parse(line))
      expect(frames.map((frame) => frame.status)).toEqual([
        'starting',
        'failed'
      ])

      expect(frames[1]).toMatchObject({
        ok: false,
        error: {code: 'E_PARENT_GONE', message: 'the owner is gone'},
        value: {pid: process.pid, port: 8080}
      })

      expect(ended).toEqual(['shutdown'])

      // A session that ended is no longer reached.
      unregister()
      unregisterBroken()
      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'again')).toBe(false)
      expect(ended).toEqual(['shutdown'])
    } finally {
      unregister()
      unregisterBroken()

      if (saved === undefined) {
        Reflect.deleteProperty(process.env, 'EXTENSION_OUTPUT')
      } else process.env.EXTENSION_OUTPUT = saved
    }
  })
})

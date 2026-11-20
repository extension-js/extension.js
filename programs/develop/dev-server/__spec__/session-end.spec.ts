import {describe, expect, it} from 'vitest'
import {CODES} from '../../lib/messaging'
import type {ErrorCode} from '../../module'
import {createLifecycleStream} from '../lifecycle-stream'
import {
  endAfterFrame,
  endSessionAsFailed,
  registerLiveSession
} from '../session-end'

describe('a host ending the dev sessions of its process as failed', () => {
  it('says no session is live, so the host reports the failure itself', () => {
    expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'the owner is gone')).toBe(
      false
    )
  })

  it('has the newest live session write its one failed frame and nothing after', () => {
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
    const unregisterBroken = registerLiveSession('broken', () => {
      throw new Error('this session could not end')
    })
    const unregister = registerLiveSession('newest', (code, message) => {
      stream.failed(message, code)
      ended.push('shutdown')

      return true
    })

    try {
      stream.starting({requestedPort: 8080, port: 8080})

      // Named, the session that throws answers false and writes nothing.
      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone', 'broken')).toBe(
        false
      )

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

describe('a host naming the dev session it ends as failed', () => {
  it('ends only the session it names, or the newest, and says when none was', () => {
    const ended: string[] = []
    const session = (id: string) =>
      registerLiveSession(id, () => {
        if (ended.includes(id)) return false

        ended.push(id)

        return true
      })
    const unregister = [session('older'), session('newer')]

    try {
      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone', 'missing')).toBe(
        false
      )

      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone', 'older')).toBe(
        true
      )

      expect(ended).toEqual(['older'])

      // A session that is already ending says so and nothing else ends.
      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone', 'older')).toBe(
        'ending'
      )

      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone')).toBe(true)
      expect(ended).toEqual(['older', 'newer'])

      // Every session is stopping, which is not the same as none being live.
      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone')).toBe('ending')
    } finally {
      for (const off of unregister) off()
    }
  })
})

describe('a host ending sessions while the newest is already stopping', () => {
  it('reaches the older session behind it', () => {
    const ended: string[] = []
    const unregister = [
      registerLiveSession('older', () => {
        ended.push('older')

        return true
      }),
      registerLiveSession('stopping', () => false)
    ]

    try {
      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone')).toBe(true)
      expect(ended).toEqual(['older'])
    } finally {
      for (const off of unregister) off()
    }
  })
})

describe('a dev session that throws while it ends as failed', () => {
  it('answers true once its frame is out and still runs the release', () => {
    const steps: string[] = []
    const unregister = registerLiveSession('throws', (code, message) =>
      endAfterFrame(
        () => steps.push(`frame ${code} ${message}`),
        [
          () => {
            throw new Error('the restart would not stop')
          },
          () => Promise.reject(new Error('the bridge would not close')),
          () => steps.push('release')
        ]
      )
    )

    try {
      expect(endSessionAsFailed(CODES.E_PARENT_GONE, 'gone', 'throws')).toBe(
        true
      )

      expect(steps).toEqual(['frame E_PARENT_GONE gone', 'release'])
    } finally {
      unregister()
    }
  })

  it('types a host hint resolver by the codes the package exports', () => {
    const hintFor = (code: ErrorCode) =>
      code === CODES.E_PARENT_GONE ? 'the owner is gone' : undefined

    expect(hintFor(CODES.E_PARENT_GONE)).toBe('the owner is gone')
  })
})

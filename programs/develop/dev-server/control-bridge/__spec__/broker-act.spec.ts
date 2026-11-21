import {describe, expect, it} from 'vitest'
import type {ActionRecord, ActionsSink} from '../actions-file'
import {
  BridgeBroker,
  type BridgeConnection,
  CLOSE_CONTROL_UNAVAILABLE
} from '../broker'
import type {
  CommandFrame,
  ReadyFrame,
  ResultFrame,
  ServerFrame
} from '../contracts'

class FakeConn implements BridgeConnection {
  sent: (ServerFrame | CommandFrame)[] = []
  closed: {code?: number; reason?: string} | null = null
  constructor(readonly id: string) {}
  send(frame: ServerFrame | CommandFrame) {
    this.sent.push(frame)

    return true
  }
  close(code?: number, reason?: string) {
    this.closed = {code, reason}
  }
}

class FakeActions implements ActionsSink {
  records: ActionRecord[] = []
  write(record: ActionRecord) {
    this.records.push(record)
  }
}

// A refused result carries its error, so a frame without one fails the row
// the same way reading a field off a missing error did.
function errorOf(frame: ServerFrame | CommandFrame | undefined) {
  const error = (frame as ResultFrame | undefined)?.error

  if (!error) {
    throw new Error(`expected a refused result, got ${JSON.stringify(frame)}`)
  }

  return error
}

function makeScheduler() {
  const tasks = new Map<number, () => void>()
  let id = 0

  return {
    setTimer: (fn: () => void) => {
      const handle = ++id
      tasks.set(handle, fn)

      return handle as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: (h: ReturnType<typeof setTimeout>) => {
      tasks.delete(h as unknown as number)
    },
    fire: (h: number) => {
      const fn = tasks.get(h)
      tasks.delete(h)
      fn?.()
    },
    pending: () => tasks.size
  }
}

function base(extra: Record<string, unknown> = {}) {
  return {
    instanceId: 'inst-1',
    runId: 'run-A',
    engine: 'chromium' as const,
    allowControl: true,
    ...extra
  }
}

function helloController(b: BridgeBroker, conn: FakeConn, token?: string) {
  b.onFrame(conn, {
    type: 'hello',
    v: 1,
    role: 'controller',
    instanceId: 'inst-1',
    token
  })
}

function helloProducer(b: BridgeBroker, conn: FakeConn) {
  b.onFrame(conn, {type: 'hello', v: 1, role: 'producer', instanceId: 'inst-1'})
}

describe('BridgeBroker (Slice 2: act)', () => {
  it('accepts a controller when control is enabled and sends capabilities', () => {
    const b = new BridgeBroker(base())
    const c = new FakeConn('ctl')
    helloController(b, c)
    expect(b.controllerCount).toBe(1)
    const ready = c.sent[0] as ReadyFrame
    expect(ready.type).toBe('ready')
    expect(ready.capabilities).toMatchObject({
      storage: true,
      reload: true,
      deepDom: true
    })

    expect(ready.capabilities?.eval).toBe(false)
    expect(ready.capabilities?.open).toEqual([
      'popup',
      'options',
      'sidebar',
      'action',
      'command'
    ])
  })

  it('firefox capabilities drop sidebar and deepDom', () => {
    const b = new BridgeBroker(base({engine: 'firefox'}))
    const c = new FakeConn('ctl')
    helloController(b, c)
    const ready = c.sent[0] as ReadyFrame
    expect(ready.capabilities?.open).toEqual([
      'popup',
      'options',
      'action',
      'command'
    ])

    expect(ready.capabilities?.deepDom).toBe(false)
  })

  it('refuses a controller when control is disabled', () => {
    const b = new BridgeBroker({...base(), allowControl: false})
    const c = new FakeConn('ctl')
    helloController(b, c)
    expect(c.closed?.code).toBe(CLOSE_CONTROL_UNAVAILABLE)
    expect(b.controllerCount).toBe(0)
  })

  it('admits a controller on an eval-only session, allowEval implies control', () => {
    const b = new BridgeBroker({
      ...base(),
      allowControl: false,
      allowEval: true
    })
    const c = new FakeConn('ctl')
    helloController(b, c)
    expect(b.controllerCount).toBe(1)
    const ready = c.sent[0] as ReadyFrame
    expect(ready.capabilities).toMatchObject({eval: true, storage: true})
  })

  it('routes a command to the executor and the result back to the controller', () => {
    const actions = new FakeActions()
    const b = new BridgeBroker(base({actions, now: () => 1000}))
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    ctl.sent = []

    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'cmd-1',
      op: 'reload',
      target: {context: 'background'}
    })

    const fwd = exec.sent.find((f) => f.type === 'command') as CommandFrame
    expect(fwd).toMatchObject({type: 'command', cmdId: 'cmd-1', op: 'reload'})
    expect(b.pendingCount).toBe(1)

    b.onFrame(exec, {
      type: 'result',
      cmdId: 'cmd-1',
      ok: true,
      value: {reloaded: true},
      durationMs: 12
    })

    expect(ctl.sent.at(-1)).toMatchObject({
      type: 'result',
      cmdId: 'cmd-1',
      ok: true
    })

    expect(b.pendingCount).toBe(0)
    expect(actions.records).toHaveLength(1)
    expect(actions.records[0]).toMatchObject({
      v: 1,
      cmdId: 'cmd-1',
      op: 'reload',
      ok: true,
      durationMs: 12,
      principal: 'controller'
    })
  })

  it('routes an `open action` command (background context, action surface)', () => {
    const actions = new FakeActions()
    const b = new BridgeBroker(base({actions, now: () => 1000}))
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    ctl.sent = []

    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'cmd-act',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    })

    const fwd = exec.sent.find((f) => f.type === 'command') as CommandFrame
    expect(fwd).toMatchObject({
      type: 'command',
      cmdId: 'cmd-act',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    })

    b.onFrame(exec, {
      type: 'result',
      cmdId: 'cmd-act',
      ok: true,
      value: {triggered: 'popup'},
      durationMs: 8
    })

    expect(ctl.sent.at(-1)).toMatchObject({
      type: 'result',
      cmdId: 'cmd-act',
      ok: true
    })

    expect(actions.records.at(-1)).toMatchObject({
      cmdId: 'cmd-act',
      op: 'open',
      ok: true,
      principal: 'controller'
    })
  })

  it('denies a command when no executor is connected', () => {
    const actions = new FakeActions()
    const b = new BridgeBroker(base({actions}))
    const ctl = new FakeConn('ctl')
    helloController(b, ctl)
    ctl.sent = []
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'c2',
      op: 'reload',
      target: {context: 'background'}
    })

    const result = ctl.sent[0] as ResultFrame
    expect(result).toMatchObject({
      type: 'result',
      ok: false,
      error: {name: 'Unavailable'}
    })

    expect(errorOf(result).message).toContain('no executor connected')
    expect(errorOf(result).message).toContain(
      'no extension service worker has connected'
    )

    expect(actions.records[0]).toMatchObject({
      ok: false,
      errorName: 'Unavailable'
    })
  })

  describe('executor-absence diagnosis', () => {
    const denyMessage = (b: BridgeBroker, ctl: FakeConn): string => {
      ctl.sent = []
      b.onFrame(ctl, {
        type: 'command',
        cmdId: `c-${Math.random().toString(36).slice(2)}`,
        op: 'reload',
        target: {context: 'background'}
      })

      const result = ctl.sent[0] as ResultFrame
      expect(result).toMatchObject({ok: false, error: {name: 'Unavailable'}})
      expect(errorOf(result).message).toContain('no executor connected')

      return errorOf(result).message
    }

    const staleProducerHello = (b: BridgeBroker, conn: FakeConn) => {
      b.onFrame(conn, {
        type: 'hello',
        v: 1,
        role: 'producer',
        instanceId: 'inst-STALE'
      })
    }

    it('names recently-disconnected with elapsed seconds', () => {
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))
      const exec = new FakeConn('exec')
      helloProducer(b, exec)
      b.onClose(exec)
      t += 7000

      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      expect(denyMessage(b, ctl)).toContain('disconnected 7s ago')
    })

    it('names a browser exit over the idle-worker story, until a producer is back', () => {
      // After the launcher stamped an exit, "retry, the worker reconnects on
      // its own" sends the caller in circles: nothing reconnects until a new
      // dev session relaunches the browser.
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))
      const exec = new FakeConn('exec')
      helloProducer(b, exec)
      b.onClose(exec)
      t += 7000
      b.noteBrowserExited('2026-09-25T23:24:37.253Z', 'signal SIGTRAP')

      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      const msg = denyMessage(b, ctl)

      expect(msg).toContain(
        'the browser exited at 2026-09-25T23:24:37.253Z (signal SIGTRAP)'
      )

      expect(msg).toContain('Restart extension dev')
      expect(msg).not.toContain('idle out')

      // Firefox can hand the session to a fresh process: a producer that
      // talks again means a browser that runs, so the exit story ends.
      helloProducer(b, new FakeConn('exec-2'))
      b.onClose(exec)
      expect(b.producerCount).toBe(1)
    })

    it('names the load refusal the session recorded, not a browser still launching', () => {
      let refusal: string | null =
        'Cannot install extension because it uses an unsupported manifest version.'
      const b = new BridgeBroker(base({readLoadRefusal: () => refusal}))
      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      const msg = denyMessage(b, ctl)

      expect(msg).toContain('the browser refused to load this extension')
      expect(msg).toContain(
        'The browser said: Cannot install extension because it uses an unsupported manifest version. Fix'
      )

      expect(msg).toContain(
        'the dev session tries the load again on the next build. If it stays refused, restart extension dev'
      )

      expect(msg).not.toMatch(/still be launching|has connected since/)
      expect(errorOf(ctl.sent[0]).code).toBe('extension_load_refused')

      // The stamp leaves the contract once the browser accepts the extension.
      refusal = null
      expect(denyMessage(b, ctl)).toContain('may still be launching')
      expect(errorOf(ctl.sent[0]).code).toBeUndefined()
    })

    it('keeps the wait hint while no refusal is recorded or the contract cannot be read', () => {
      const none = new BridgeBroker(base({readLoadRefusal: () => null}))
      const unreadable = new BridgeBroker(
        base({
          readLoadRefusal: () => {
            throw new Error('unreadable')
          }
        })
      )

      for (const b of [none, unreadable]) {
        const ctl = new FakeConn('ctl')
        helloController(b, ctl)
        expect(denyMessage(b, ctl)).toContain('may still be launching')
      }
    })

    it('names a refusal with no reason, and what a start session has to do', () => {
      const b = new BridgeBroker(
        base({
          engine: 'firefox',
          sessionCommand: 'start',
          readLoadRefusal: () => ''
        })
      )
      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      const msg = denyMessage(b, ctl)

      expect(msg).toContain(
        'the browser refused to load this extension, so no background page runs'
      )

      expect(msg).not.toContain('The browser said')
      expect(msg).toContain('build again and restart extension start')
      expect(msg).not.toMatch(/dev session/)
    })

    it('names a browser exit over a refusal recorded before it', () => {
      const b = new BridgeBroker(base({readLoadRefusal: () => 'refused'}))
      b.noteBrowserExited('2026-09-25T23:24:37.253Z', 'code 0')
      const ctl = new FakeConn('ctl')
      helloController(b, ctl)

      expect(denyMessage(b, ctl)).toContain('the browser exited at')
      expect(errorOf(ctl.sent[0]).code).toBeUndefined()
    })

    it('speaks of a background page, not a service worker, on Firefox', () => {
      let t = 0
      const b = new BridgeBroker(base({engine: 'firefox', now: () => t}))
      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      const never = denyMessage(b, ctl)
      expect(never).toContain('no extension background page has connected')
      expect(never).not.toContain('service worker')

      staleProducerHello(b, new FakeConn('stale'))
      t += 4000
      const stale = denyMessage(b, ctl)
      expect(stale).toContain('told to full-reload')
      expect(stale).toContain('a background page from a previous dev session')
      expect(stale).not.toMatch(/service worker|worker should/)
    })

    it('names stale-resync-pending after a stale producer hello', () => {
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))
      staleProducerHello(b, new FakeConn('stale'))
      t += 4000

      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      const msg = denyMessage(b, ctl)
      expect(msg).toContain('told to full-reload')
      expect(msg).toContain('4s ago')
    })

    it('records the stale hello even when the resync is rate-limited', () => {
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))

      for (let i = 0; i < 4; i++) {
        t += 1000
        staleProducerHello(b, new FakeConn(`stale-${i}`))
      }

      t += 5000

      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      expect(denyMessage(b, ctl)).toContain('told to full-reload')
    })

    it('does not stamp producer-disconnect on a controller close', () => {
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))
      const ctl1 = new FakeConn('ctl1')
      helloController(b, ctl1)
      b.onClose(ctl1)
      t += 5000

      const ctl2 = new FakeConn('ctl2')
      helloController(b, ctl2)
      expect(denyMessage(b, ctl2)).toContain(
        'no extension service worker has connected'
      )
    })

    it('stale-resync hint expires back to never-connected after 30s', () => {
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))
      staleProducerHello(b, new FakeConn('stale'))
      t += 31_000

      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      expect(denyMessage(b, ctl)).toContain(
        'no extension service worker has connected'
      )
    })
  })

  it('forbids eval without --allow-eval and a matching token', () => {
    const actions = new FakeActions()
    const b = new BridgeBroker(
      base({actions, allowEval: true, controlToken: 'secret'})
    )
    const exec = new FakeConn('exec')
    helloProducer(b, exec)

    const ctl = new FakeConn('ctl')
    helloController(b, ctl, 'WRONG')
    ctl.sent = []
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'e1',
      op: 'eval',
      target: {context: 'background'},
      args: {expression: 'chrome.runtime.id'}
    })

    expect(ctl.sent[0]).toMatchObject({
      type: 'result',
      ok: false,
      error: {name: 'EvalTokenMismatch'}
    })

    expect(exec.sent.find((f) => f.type === 'command')).toBeUndefined()
    const rec = actions.records.at(-1)!
    expect(rec).toMatchObject({
      op: 'eval',
      ok: false,
      errorName: 'EvalTokenMismatch'
    })

    expect(typeof rec.exprHash).toBe('string')
    expect(rec.expr).toBeUndefined()

    const ctl2 = new FakeConn('ctl2')
    helloController(b, ctl2, 'secret')
    b.onFrame(ctl2, {
      type: 'command',
      cmdId: 'e2',
      op: 'eval',
      target: {context: 'background'},
      args: {expression: 'chrome.runtime.id'}
    })

    expect(
      exec.sent.find((f) => f.type === 'command' && f.cmdId === 'e2')
    ).toBeDefined()
  })

  it('names the failing eval gate leg on the wire', () => {
    const evalDeny = (
      brokerOpts: Record<string, unknown>,
      helloToken?: string
    ): {name: string; message: string} => {
      const b = new BridgeBroker(base(brokerOpts))
      helloProducer(b, new FakeConn('exec'))
      const ctl = new FakeConn('ctl')
      helloController(b, ctl, helloToken)
      ctl.sent = []
      b.onFrame(ctl, {
        type: 'command',
        cmdId: 'e-gate',
        op: 'eval',
        target: {context: 'background'},
        args: {expression: '1'}
      })

      const result = ctl.sent[0] as ResultFrame
      expect(result).toMatchObject({ok: false})

      return errorOf(result)
    }

    const disabled = evalDeny({allowEval: false}, 'anything')
    expect(disabled.name).toBe('EvalDisabled')
    expect(disabled.message).toContain('--allow-eval')

    const missing = evalDeny({allowEval: true, controlToken: 'secret'})
    expect(missing.name).toBe('EvalTokenMissing')
    expect(missing.message).toContain('token missing')

    const mismatch = evalDeny(
      {allowEval: true, controlToken: 'secret'},
      'WRONG'
    )
    expect(mismatch.name).toBe('EvalTokenMismatch')
    expect(mismatch.message).toContain('token mismatch')
  })

  it('writes the raw eval source only in author mode', () => {
    const actions = new FakeActions()
    const b = new BridgeBroker(
      base({actions, allowEval: true, controlToken: 't', authorMode: true})
    )
    const exec = new FakeConn('exec')
    helloProducer(b, exec)
    const ctl = new FakeConn('ctl')
    helloController(b, ctl, 't')
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'e3',
      op: 'eval',
      target: {context: 'background'},
      args: {expression: '1 + 1'}
    })

    b.onFrame(exec, {type: 'result', cmdId: 'e3', ok: true, value: 2})
    expect(actions.records.at(-1)).toMatchObject({op: 'eval', expr: '1 + 1'})
  })

  it('times out a command with no result and audits it', () => {
    const sched = makeScheduler()
    const actions = new FakeActions()
    const b = new BridgeBroker(
      base({
        actions,
        now: () => 5000,
        setTimer: sched.setTimer,
        clearTimer: sched.clearTimer
      })
    )
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    ctl.sent = []
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 't1',
      op: 'storage.get',
      target: {context: 'background'},
      timeoutMs: 1000
    })

    expect(b.pendingCount).toBe(1)
    sched.fire(1)
    expect(ctl.sent.at(-1)).toMatchObject({
      type: 'result',
      cmdId: 't1',
      ok: false,
      error: {name: 'Timeout'}
    })

    expect(b.pendingCount).toBe(0)
    expect(actions.records.at(-1)).toMatchObject({
      ok: false,
      errorName: 'Timeout'
    })
  })

  it('drops a controller’s pending commands when it disconnects', () => {
    const sched = makeScheduler()
    const b = new BridgeBroker(
      base({setTimer: sched.setTimer, clearTimer: sched.clearTimer})
    )
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'd1',
      op: 'reload',
      target: {context: 'background'}
    })

    expect(b.pendingCount).toBe(1)
    b.onClose(ctl)
    expect(b.pendingCount).toBe(0)
    expect(sched.pending()).toBe(0)
  })

  it('fails an in-flight command the moment its executor disconnects', () => {
    const sched = makeScheduler()
    const actions = new FakeActions()
    let t = 10_000
    const b = new BridgeBroker(
      base({
        actions,
        now: () => t,
        setTimer: sched.setTimer,
        clearTimer: sched.clearTimer
      })
    )
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    ctl.sent = []
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'gone-1',
      op: 'storage.get',
      target: {context: 'background'},
      timeoutMs: 30_000
    })

    expect(b.pendingCount).toBe(1)
    t += 250
    b.onClose(exec)

    expect(ctl.sent).toHaveLength(1)
    const result = ctl.sent[0] as ResultFrame
    expect(result).toMatchObject({
      type: 'result',
      cmdId: 'gone-1',
      ok: false,
      error: {name: 'Unavailable'}
    })

    expect(errorOf(result).message).toContain('no executor connected')
    expect(errorOf(result).message).toContain('disconnected 0s ago')
    expect(b.pendingCount).toBe(0)
    expect(sched.pending()).toBe(0)
    expect(actions.records.at(-1)).toMatchObject({
      cmdId: 'gone-1',
      op: 'storage.get',
      ok: false,
      durationMs: 250,
      errorName: 'Unavailable'
    })

    sched.fire(1)
    expect(ctl.sent).toHaveLength(1)
  })

  it('names the browser exit when the executor socket closes after the stamp', () => {
    const sched = makeScheduler()
    const b = new BridgeBroker(
      base({setTimer: sched.setTimer, clearTimer: sched.clearTimer})
    )
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    ctl.sent = []
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'gone-2',
      op: 'reload',
      target: {context: 'background'}
    })

    b.noteBrowserExited('2026-09-25T23:24:37.253Z', 'code 0')
    b.onClose(exec)
    const result = ctl.sent[0] as ResultFrame
    expect(errorOf(result).name).toBe('Unavailable')
    expect(errorOf(result).message).toContain('the browser exited at')
    expect(errorOf(result).message).not.toContain('idle out')
  })

  it('refuses a cmdId that is still pending without touching the first command', () => {
    const sched = makeScheduler()
    const actions = new FakeActions()
    const b = new BridgeBroker(
      base({
        actions,
        now: () => 1000,
        setTimer: sched.setTimer,
        clearTimer: sched.clearTimer
      })
    )
    const exec = new FakeConn('exec')
    const a = new FakeConn('ctl-a')
    const other = new FakeConn('ctl-b')
    helloProducer(b, exec)
    helloController(b, a)
    helloController(b, other)
    a.sent = []
    other.sent = []

    b.onFrame(a, {
      type: 'command',
      cmdId: 'c-1759300000000-1',
      op: 'tabs.query',
      target: {context: 'background'}
    })

    b.onFrame(other, {
      type: 'command',
      cmdId: 'c-1759300000000-1',
      op: 'storage.get',
      target: {context: 'background'}
    })

    expect(b.pendingCount).toBe(1)
    expect(sched.pending()).toBe(1)
    expect(exec.sent.filter((f) => f.type === 'command')).toHaveLength(1)
    expect(other.sent).toHaveLength(1)
    expect(other.sent[0]).toMatchObject({
      type: 'result',
      cmdId: 'c-1759300000000-1',
      ok: false,
      error: {name: 'BadRequest'}
    })

    expect(errorOf(other.sent[0]).message).toContain('cmdId')
    expect(a.sent).toHaveLength(0)

    b.onFrame(exec, {
      type: 'result',
      cmdId: 'c-1759300000000-1',
      ok: true,
      value: 'answer-for-A'
    })

    expect(a.sent).toEqual([
      {
        type: 'result',
        cmdId: 'c-1759300000000-1',
        ok: true,
        value: 'answer-for-A'
      }
    ])

    expect(other.sent).toHaveLength(1)
    expect(b.pendingCount).toBe(0)
    expect(sched.pending()).toBe(0)
    expect(actions.records.map((r) => [r.op, r.ok, r.errorName])).toEqual([
      ['storage.get', false, 'BadRequest'],
      ['tabs.query', true, undefined]
    ])
  })

  describe('a start or preview session names its own command', () => {
    const answer = (
      extra: Record<string, unknown>,
      op: 'reload' | 'eval' = 'reload',
      prepare?: (b: BridgeBroker) => void
    ): string => {
      const b = new BridgeBroker(base(extra))
      const ctl = new FakeConn('ctl')

      prepare?.(b)
      helloController(b, ctl)
      ctl.sent = []
      b.onFrame(ctl, {
        type: 'command',
        cmdId: 'c1',
        op,
        target: {context: 'background'},
        ...(op === 'eval' ? {args: {expression: '1'}} : {})
      })

      return String(errorOf(ctl.sent[0]).message)
    }

    it.each([
      'start',
      'preview'
    ] as const)('never-connected on extension %s says nothing about a dev session', (sessionCommand) => {
      const message = answer({sessionCommand})

      expect(message).toContain(
        `since this extension ${sessionCommand} session started`
      )

      expect(message).not.toMatch(/dev session|extension dev/)
    })

    it.each([
      'start',
      'preview'
    ] as const)('a browser that exited under extension %s is restarted with that command', (sessionCommand) => {
      const message = answer({sessionCommand}, 'reload', (b) =>
        b.noteBrowserExited('2026-11-15T00:00:00.000Z')
      )

      expect(message).toContain(
        `Restart extension ${sessionCommand} to relaunch it`
      )

      expect(message).not.toMatch(/dev session|extension dev/)
    })

    it('a Firefox event page suspended under preview is restarted with preview', () => {
      const b = new BridgeBroker(
        base({engine: 'firefox', sessionCommand: 'preview'})
      )
      const exec = new FakeConn('exec')
      const ctl = new FakeConn('ctl')

      helloProducer(b, exec)
      b.onClose(exec)
      helloController(b, ctl)
      ctl.sent = []
      b.onFrame(ctl, {
        type: 'command',
        cmdId: 'c1',
        op: 'reload',
        target: {context: 'background'}
      })

      const message = String(errorOf(ctl.sent[0]).message)

      expect(message).toContain('restart extension preview')
      expect(message).not.toMatch(/dev session|extension dev/)
    })

    it('the eval refusal names the session that has eval off', () => {
      expect(answer({sessionCommand: 'preview'}, 'eval')).toBe(
        'eval is disabled for this session: restart the extension preview session with --allow-eval'
      )

      expect(answer({}, 'eval')).toBe(
        'eval is disabled for this session: restart the dev session with --allow-eval'
      )
    })

    it('a dev session keeps its own words', () => {
      expect(answer({})).toContain('since this dev session started')
    })

    it('a build with no background is not told the browser may still be launching', () => {
      const message = answer({sessionCommand: 'start'}, 'reload', (b) =>
        b.noteNoBackground()
      )

      expect(message).toContain('no executor connected')
      expect(message).toContain('has no background')
      expect(message).toContain('restart extension start')
      expect(message).not.toContain('may still be launching')
    })

    it('names that absence with a code, and no other absence', () => {
      const codeOf = (prepare?: (b: BridgeBroker) => void) => {
        const b = new BridgeBroker(base({sessionCommand: 'preview'}))
        const ctl = new FakeConn('ctl')

        prepare?.(b)
        helloController(b, ctl)
        ctl.sent = []
        b.onFrame(ctl, {
          type: 'command',
          cmdId: 'c1',
          op: 'reload',
          target: {context: 'background'}
        })

        return errorOf(ctl.sent[0]).code
      }

      expect(codeOf((b) => b.noteNoBackground())).toBe('no_background')
      expect(codeOf()).toBeUndefined()
    })
  })

  it('ignores result frames from non-executor connections', () => {
    const b = new BridgeBroker(base())
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'x1',
      op: 'reload',
      target: {context: 'background'}
    })

    ctl.sent = []
    b.onFrame(ctl, {type: 'result', cmdId: 'x1', ok: true})
    expect(b.pendingCount).toBe(1)
    expect(ctl.sent).toHaveLength(0)
  })
})

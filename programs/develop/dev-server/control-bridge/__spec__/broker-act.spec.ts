import {describe, it, expect} from 'vitest'
import {
  BridgeBroker,
  CLOSE_CONTROL_UNAVAILABLE,
  type BridgeConnection
} from '../broker'
import type {ActionRecord, ActionsSink} from '../actions-file'
import type {CommandFrame, ServerFrame} from '../contracts'

class FakeConn implements BridgeConnection {
  sent: (ServerFrame | CommandFrame)[] = []
  closed: {code?: number; reason?: string} | null = null
  constructor(readonly id: string) {}
  send(frame: ServerFrame | CommandFrame) {
    this.sent.push(frame)
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

/** Manual scheduler so timeouts are deterministic. */
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
    const ready = c.sent[0] as any
    expect(ready.type).toBe('ready')
    expect(ready.capabilities).toMatchObject({
      storage: true,
      reload: true,
      deepDom: true
    })
    // eval not enabled by default even with allow-control.
    expect(ready.capabilities.eval).toBe(false)
    expect(ready.capabilities.open).toEqual([
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
    const ready = c.sent[0] as any
    expect(ready.capabilities.open).toEqual([
      'popup',
      'options',
      'action',
      'command'
    ])
    expect(ready.capabilities.deepDom).toBe(false)
  })

  it('refuses a controller when control is disabled', () => {
    const b = new BridgeBroker({...base(), allowControl: false})
    const c = new FakeConn('ctl')
    helloController(b, c)
    expect(c.closed?.code).toBe(CLOSE_CONTROL_UNAVAILABLE)
    expect(b.controllerCount).toBe(0)
  })

  it('routes a command to the executor and the result back to the controller', () => {
    const actions = new FakeActions()
    const b = new BridgeBroker(base({actions, now: () => 1000}))
    const exec = new FakeConn('exec')
    const ctl = new FakeConn('ctl')
    helloProducer(b, exec)
    helloController(b, ctl)
    ctl.sent = [] // drop ready

    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'cmd-1',
      op: 'reload',
      target: {context: 'background'}
    })

    // Executor received the command (token never relayed).
    const fwd = exec.sent.find((f) => f.type === 'command') as any
    expect(fwd).toMatchObject({type: 'command', cmdId: 'cmd-1', op: 'reload'})
    expect(b.pendingCount).toBe(1)

    // Executor replies; result is routed to the controller and audited.
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
    ctl.sent = [] // drop ready

    b.onFrame(ctl, {
      type: 'command',
      cmdId: 'cmd-act',
      op: 'open',
      target: {context: 'background'},
      args: {surface: 'action'}
    })

    const fwd = exec.sent.find((f) => f.type === 'command') as any
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
    const result = ctl.sent[0] as any
    expect(result).toMatchObject({
      type: 'result',
      ok: false,
      error: {name: 'Unavailable'}
    })
    // No producer has ever said hello → the never-connected diagnosis.
    expect(result.error.message).toContain('no executor connected')
    expect(result.error.message).toContain('no extension service worker has connected')
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
      const result = ctl.sent[0] as any
      expect(result).toMatchObject({ok: false, error: {name: 'Unavailable'}})
      expect(result.error.message).toContain('no executor connected')
      return result.error.message
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

    it('names stale-resync-pending after a stale producer hello', () => {
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))
      staleProducerHello(b, new FakeConn('stale'))
      t += 4000

      const ctl = new FakeConn('ctl')
      helloController(b, ctl)
      const msg = denyMessage(b, ctl)
      // Wins over never-connected: no producer was ever accepted here.
      expect(msg).toContain('told to full-reload')
      expect(msg).toContain('4s ago')
    })

    it('records the stale hello even when the resync is rate-limited', () => {
      let t = 0
      const b = new BridgeBroker(base({now: () => t}))
      // 3/min resync cap: the 4th stale hello gets no reload frame but must
      // still be stamped for diagnosis.
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

    // Wrong token → eval forbidden, never forwarded, hash recorded (not raw expr).
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
      error: {name: 'Forbidden'}
    })
    expect(exec.sent.find((f) => f.type === 'command')).toBeUndefined()
    const rec = actions.records.at(-1)!
    expect(rec).toMatchObject({op: 'eval', ok: false, errorName: 'Forbidden'})
    expect(typeof rec.exprHash).toBe('string')
    expect(rec.expr).toBeUndefined() // raw source never written by default

    // Right token → eval forwarded to the executor.
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
      exec.sent.find((f: any) => f.type === 'command' && f.cmdId === 'e2')
    ).toBeDefined()
  })

  it('names the failing eval gate leg in the Forbidden message', () => {
    const evalDeny = (
      brokerOpts: Record<string, unknown>,
      helloToken?: string
    ): string => {
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
      const result = ctl.sent[0] as any
      expect(result).toMatchObject({ok: false, error: {name: 'Forbidden'}})
      return result.error.message
    }

    // --allow-eval not set: says so, even when a token is presented.
    expect(evalDeny({allowEval: false}, 'anything')).toContain('--allow-eval')

    // Enabled but the hello carried no token: points at the token file read.
    expect(evalDeny({allowEval: true, controlToken: 'secret'})).toContain(
      'token missing'
    )

    // Enabled with the wrong token: stale-token mismatch.
    expect(
      evalDeny({allowEval: true, controlToken: 'secret'}, 'WRONG')
    ).toContain('token mismatch')
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
    sched.fire(1) // fire the timeout
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
    expect(sched.pending()).toBe(0) // timer cleared
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
    // A controller (not the executor) sending a result must be ignored.
    b.onFrame(ctl, {type: 'result', cmdId: 'x1', ok: true})
    expect(b.pendingCount).toBe(1) // still pending
    expect(ctl.sent).toHaveLength(0)
  })
})

import net from 'node:net'
import vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  evaluateInConsole,
  evaluateTabDocument,
  evaluateThroughTab,
  pickTabDescriptor,
  readCompletionValue,
  readWholeString,
  statementBlock
} from '../run-firefox/rdp/evaluate-extension-document'
import {PageThrewError} from '../run-firefox/rdp/remote-firefox/evaluate'

const LONG_STRING_THRESHOLD = 10000
const TAB_URL = 'http://127.0.0.1:8791/csp.html'

class FakeConsole {
  requests: Array<Record<string, unknown>> = []
  evaluated: Array<{text: string; extra?: Record<string, unknown>}> = []
  tabs: Array<{actor: string; url: string}> = [
    {actor: 'tab-descriptor', url: TAB_URL}
  ]
  private context = vm.createContext({})
  private objects = new Map<string, unknown>()
  private strings = new Map<string, string>()

  private grip(value: unknown): unknown {
    if (typeof value === 'string') {
      if (value.length <= LONG_STRING_THRESHOLD) return value

      const actor = `long-${this.strings.size}`
      this.strings.set(actor, value)

      return {
        type: 'longString',
        actor,
        length: value.length,
        initial: value.slice(0, 1000)
      }
    }

    if (value === undefined) return {type: 'undefined'}
    if (value === null) return {type: 'null'}
    if (typeof value === 'bigint') return {type: 'BigInt', text: String(value)}
    if (typeof value === 'symbol') return {type: 'symbol'}

    if (typeof value === 'number') {
      if (Number.isNaN(value)) return {type: 'NaN'}
      if (Object.is(value, -0)) return {type: '-0'}

      return Number.isFinite(value)
        ? value
        : {type: value > 0 ? 'Infinity' : '-Infinity'}
    }

    if (typeof value === 'boolean') return value

    const actor = `obj-${this.objects.size}`
    this.objects.set(actor, value)

    return {type: 'object', actor}
  }

  async evaluate(
    _consoleActor: string,
    text: string,
    extra?: Record<string, unknown>
  ): Promise<unknown> {
    this.evaluated.push({text, extra})

    const bound = extra?.selectedObjectActor
    const realm = this.context as Record<string, unknown>

    if (typeof bound === 'string') realm._self = this.objects.get(bound)
    else delete realm._self

    try {
      return this.grip(vm.runInContext(text, this.context))
    } catch (error) {
      const thrown = error as {name?: string; message?: string}

      throw new PageThrewError(`${thrown.name}: ${thrown.message}`)
    }
  }

  async request(payload: Record<string, unknown>): Promise<unknown> {
    this.requests.push(payload)

    if (payload.type === 'substring') {
      return {
        substring: String(this.strings.get(String(payload.to))).slice(
          Number(payload.start),
          Number(payload.end)
        )
      }
    }

    if (payload.type === 'listTabs') return {tabs: this.tabs}

    if (payload.type === 'getTarget') {
      return {frame: {consoleActor: 'console-tab', url: TAB_URL}}
    }

    return {}
  }

  on(): void {}
  off(): void {}
}

const run = (client: FakeConsole, expression: string, timeoutMs = 2000) =>
  evaluateInConsole({
    client: client as never,
    consoleActor: 'console-background',
    expression,
    timeoutMs,
    where: 'the background document'
  })

describe('a result Firefox holds as a long string', () => {
  it('comes back whole, read from the grip with one substring request', async () => {
    const client = new FakeConsole()

    expect(await run(client, "'x'.repeat(11000)")).toEqual({
      ok: true,
      value: 'x'.repeat(11000)
    })

    const reads = client.requests.filter((r) => r.type === 'substring')

    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatchObject({start: 0, to: 'long-0'})
    expect(Number(reads[0].end)).toBeGreaterThan(11000)
  })

  it('carries an ordinary array of rows past the threshold', async () => {
    const outcome = await run(
      new FakeConsole(),
      "Array.from({length: 2000}, (_, i) => ({i: i, name: 'row-' + i}))"
    )

    expect(outcome.ok).toBe(true)

    const rows = (outcome as {value: Array<{i: number; name: string}>}).value

    expect(rows).toHaveLength(2000)
    expect(rows[1999]).toEqual({i: 1999, name: 'row-1999'})
  })

  it('answers the bridge shape for a result past the byte cap', async () => {
    const outcome = await run(new FakeConsole(), "'y'.repeat(300000)")

    expect(outcome).toMatchObject({
      ok: true,
      truncated: true,
      value: {__type: 'truncated'}
    })

    const {preview} = (outcome as {value: {preview: string}}).value

    expect(preview).toHaveLength(1024)
    expect(preview.startsWith('"yyyy')).toBe(true)
  })

  it('names the size when Firefox will not hand the rest over', async () => {
    await expect(
      readWholeString(
        {request: async () => ({})},
        {type: 'longString', actor: 'long-9', length: 54321, initial: 'ab'}
      )
    ).rejects.toThrow('54321-character')
  })

  it('leaves every other value as it came', async () => {
    const never = {
      request: async () => {
        throw new Error('no request expected')
      }
    }

    for (const value of ['short', 2, null, undefined, {type: 'object'}]) {
      expect(await readWholeString(never, value)).toBe(value)
    }
  })
})

describe('a statement list on a document that forbids eval', () => {
  it('answers the completion value of the last statement', async () => {
    const client = new FakeConsole()

    expect(await run(client, 'var a = 20; a + 1')).toEqual({
      ok: true,
      value: 21
    })

    expect(client.evaluated.map((entry) => entry.text)).toEqual([
      expect.stringContaining('Promise.resolve((var a = 20; a + 1))'),
      statementBlock('var a = 20; a + 1')
    ])
  })

  it('runs the statements once, and never while the wrapper fails to parse', async () => {
    const client = new FakeConsole()
    const source =
      'globalThis.runs = (globalThis.runs || 0) + 1; var seen = globalThis.runs; seen'

    expect(await run(client, source)).toEqual({ok: true, value: 1})
    expect(await run(client, source)).toEqual({ok: true, value: 2})
  })

  it('keeps let and const inside the run, so the same input runs twice', async () => {
    const client = new FakeConsole()

    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await run(client, 'let b = 2; const c = 3; b * c')).toEqual({
        ok: true,
        value: 6
      })
    }
  })

  it('serializes an object inside the document through its own grip', async () => {
    const client = new FakeConsole()

    expect(await run(client, 'const o = {k: [1, 2]}; o')).toEqual({
      ok: true,
      value: {k: [1, 2]}
    })

    const settle = client.evaluated[2]

    expect(settle.text).toContain('Promise.resolve((_self))')
    expect(settle.extra).toEqual({selectedObjectActor: 'obj-0'})
  })

  it('awaits a promise the statements end on', async () => {
    expect(
      await run(new FakeConsole(), 'const p = Promise.resolve({z: 9}); p')
    ).toEqual({ok: true, value: {z: 9}})
  })

  it('reads a long string the statements end on', async () => {
    expect(
      await run(new FakeConsole(), "const s = 'z'.repeat(11000); s")
    ).toEqual({ok: true, value: 'z'.repeat(11000)})
  })

  it('caps a string the statements end on at the byte cap', async () => {
    const client = new FakeConsole()
    const outcome = await run(client, "const s = 'z'.repeat(400000); s")

    expect(outcome).toMatchObject({ok: true, truncated: true})

    const read = client.requests.find((r) => r.type === 'substring')

    expect(Number(read?.end)).toBe(256 * 1024 + 1)
  })

  it('answers undefined when the last statement has no value', async () => {
    expect(await run(new FakeConsole(), 'var t = 1;')).toEqual({
      ok: true,
      value: undefined
    })
  })

  it('reports a throw among the statements as a guest error with its class', async () => {
    expect(await run(new FakeConsole(), 'var q = 1; nope.nope')).toEqual({
      ok: false,
      error: {
        name: 'EvalError',
        message: 'ReferenceError: nope is not defined',
        engine: 'firefox'
      }
    })
  })

  it('reports input that parses as neither form as a guest error, never a dead channel', async () => {
    const outcome = await run(new FakeConsole(), '1 +')

    expect(outcome).toMatchObject({ok: false, error: {name: 'EvalError'}})
    expect((outcome as {error: {message: string}}).error.message).toMatch(
      /^SyntaxError: /
    )
  })

  it('reads each completion grip as JSON.stringify would inside the document', () => {
    expect(readCompletionValue(21)).toEqual({ok: true, value: 21})
    expect(readCompletionValue('s')).toEqual({ok: true, value: 's'})
    expect(readCompletionValue(false)).toEqual({ok: true, value: false})
    expect(readCompletionValue({type: 'null'})).toEqual({ok: true, value: null})
    expect(readCompletionValue({type: 'NaN'})).toEqual({ok: true, value: null})
    expect(readCompletionValue({type: '-0'})).toEqual({ok: true, value: 0})

    expect(readCompletionValue({type: 'Infinity'})).toEqual({
      ok: true,
      value: null
    })

    expect(readCompletionValue({type: 'undefined'})).toEqual({
      ok: true,
      value: undefined
    })

    expect(readCompletionValue({type: 'symbol'})).toEqual({
      ok: true,
      value: undefined
    })

    expect(readCompletionValue({type: 'BigInt', text: '10'})).toEqual({
      ok: true,
      value: '10'
    })

    expect(readCompletionValue({type: 'object', actor: 'obj-3'})).toEqual({
      objectActor: 'obj-3'
    })

    expect(readCompletionValue({type: 'someFutureKind'})).toMatchObject({
      ok: false,
      error: {
        name: 'Unsupported',
        message: expect.stringContaining('someFutureKind')
      }
    })
  })
})

describe('what the wrapper does with a failure', () => {
  it('names the class of a thrown error in the message', async () => {
    const client = new FakeConsole()

    expect(await run(client, 'nope.nope')).toMatchObject({
      error: {name: 'EvalError', message: 'ReferenceError: nope is not defined'}
    })

    expect(
      await run(client, "Promise.reject(new TypeError('bad'))")
    ).toMatchObject({error: {name: 'EvalError', message: 'TypeError: bad'}})

    expect(await run(client, "(() => { throw 'plain' })()")).toMatchObject({
      error: {name: 'EvalError', message: 'plain'}
    })
  })

  it('reports a wrapper failure that is not a parse error without running anything else', async () => {
    const evaluated: string[] = []
    const client = {
      request: async () => ({}),
      evaluate: async (_actor: string, text: string) => {
        evaluated.push(text)

        throw new PageThrewError('InternalError: too much recursion')
      },
      on: () => {}
    }

    expect(
      await evaluateInConsole({
        client: client as never,
        consoleActor: 'console-background',
        expression: 'var a = 1; a',
        timeoutMs: 500,
        where: 'the background document'
      })
    ).toEqual({
      ok: false,
      error: {
        name: 'EvalError',
        message: 'InternalError: too much recursion',
        engine: 'firefox'
      }
    })

    expect(evaluated).toHaveLength(1)
  })

  it('lets a protocol failure through as a failure of the protocol', async () => {
    const client = {
      request: async () => ({}),
      evaluate: async () => {
        throw new Error('RDP request to "console" timed out after 30000ms')
      },
      on: () => {}
    }

    await expect(
      evaluateInConsole({
        client: client as never,
        consoleActor: 'console-background',
        expression: '1 + 1',
        timeoutMs: 500,
        where: 'the background document'
      })
    ).rejects.toThrow('timed out after 30000ms')
  })
})

describe('a web tab whose own policy forbids eval', () => {
  it('picks the one tab on the url and refuses to guess between two', () => {
    const tab = {actor: 'tab-descriptor', url: TAB_URL}

    expect(pickTabDescriptor([tab], TAB_URL)).toBe('tab-descriptor')
    expect(pickTabDescriptor([tab], 'http://127.0.0.1:8791/')).toBeUndefined()
    expect(pickTabDescriptor([], TAB_URL)).toBeUndefined()

    expect(
      pickTabDescriptor([tab, {actor: 'tab-other', url: TAB_URL}], TAB_URL)
    ).toBeUndefined()

    expect(pickTabDescriptor([{url: TAB_URL}], TAB_URL)).toBeUndefined()
  })

  it("evaluates through the tab's own console actor", async () => {
    const client = new FakeConsole()

    expect(
      await evaluateThroughTab({
        client: client as never,
        url: TAB_URL,
        expression: 'var a = 20; a + 1',
        timeoutMs: 2000
      })
    ).toEqual({ok: true, value: 21})

    expect(client.requests.map((r) => [r.to, r.type])).toEqual([
      ['root', 'listTabs'],
      ['tab-descriptor', 'getTarget']
    ])
  })

  it('answers nothing for a url two tabs share', async () => {
    const client = new FakeConsole()
    client.tabs.push({actor: 'tab-other', url: TAB_URL})

    expect(
      await evaluateThroughTab({
        client: client as never,
        url: TAB_URL,
        expression: '1 + 1',
        timeoutMs: 2000
      })
    ).toBeUndefined()

    expect(client.evaluated).toHaveLength(0)
  })

  it('answers nothing when the debugger cannot be reached', async () => {
    const server = net.createServer()

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

    const port = (server.address() as net.AddressInfo).port

    await new Promise<void>((resolve) => server.close(() => resolve()))

    expect(
      await evaluateTabDocument({
        rdpPort: port,
        url: TAB_URL,
        expression: '1 + 1',
        timeoutMs: 1000
      })
    ).toBeUndefined()
  })
})

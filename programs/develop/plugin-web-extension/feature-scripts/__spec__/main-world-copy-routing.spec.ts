import * as vm from 'node:vm'
import {describe, expect, it} from 'vitest'
import {
  buildMainWorldCopyRoutingSource,
  MAIN_WORLD_COPY_ROUTING_MARK
} from '../scripts-lib/main-world-copy-routing'

const COPY = 'scripts/hook.extjs-main-world.js'
const SOURCE = buildMainWorldCopyRoutingSource({'scripts/hook.js': COPY})

type Script = Record<string, unknown>

// A scripting namespace that keeps what it is handed, the way the browser's
// registry does, under both the promise and the callback form.
function browserWith(namespaces: Array<'chrome' | 'browser'> = ['chrome']) {
  const registered = new Map<string, Script>()
  const injected: Script[] = []

  const answer = <T>(value: T, done: unknown) => {
    if (typeof done === 'function') {
      done(value)

      return undefined
    }

    return Promise.resolve(value)
  }

  // The browser checks the shape of a call as it is made, and throws there.
  const shaped = (scripts: unknown) => {
    if (
      !Array.isArray(scripts) ||
      scripts.some((script) => typeof script?.id !== 'string')
    ) {
      throw new TypeError('shape')
    }
  }

  const updates: Script[][] = []

  const scripting = {
    registerContentScripts(scripts: Script[], done?: unknown) {
      shaped(scripts)

      for (const script of scripts) registered.set(String(script.id), script)

      return answer(undefined, done)
    },
    updateContentScripts(scripts: Script[], done?: unknown) {
      shaped(scripts)

      // An id no registration has refuses the whole call and changes nothing.
      if (scripts.some((script) => !registered.has(String(script.id)))) {
        if (typeof done !== 'function') {
          return Promise.reject(new Error('no such script'))
        }

        root.runtime.lastError = {message: 'no such script'}
        done()
        delete root.runtime.lastError

        return undefined
      }

      updates.push(scripts)

      for (const script of scripts) {
        registered.set(String(script.id), {
          ...registered.get(String(script.id)),
          ...script
        })
      }

      return answer(undefined, done)
    },
    getRegisteredContentScripts(filter?: unknown, done?: unknown) {
      const callback = typeof filter === 'function' ? filter : done
      const ids = (filter as {ids?: string[]} | undefined)?.ids
      const all = [...registered.values()].filter(
        (script) => !ids || ids.includes(String(script.id))
      )

      return answer(
        all.map((script) => ({...script})),
        callback
      )
    },
    executeScript(injection: Script, done?: unknown) {
      injected.push(injection)

      return answer([{result: null}], done)
    }
  } as Record<string, any>
  const root: {scripting: typeof scripting; runtime: {lastError?: object}} = {
    scripting,
    runtime: {}
  }
  const context: Record<string, unknown> = {}

  for (const name of namespaces) context[name] = root

  context.globalThis = context
  vm.runInNewContext(SOURCE, context)

  return {scripting, registered, injected, updates}
}

describe('the routing of a file both worlds run', () => {
  it('registers the copy in the MAIN world and the file itself elsewhere', async () => {
    const {scripting, registered} = browserWith()

    await scripting.registerContentScripts([
      {id: 'iso', js: ['scripts/hook.js'], world: 'ISOLATED'},
      {id: 'main', js: ['scripts/hook.js', 'scripts/other.js'], world: 'MAIN'},
      {id: 'plain', js: ['/scripts/hook.js']}
    ])

    expect(registered.get('iso')?.js).toEqual(['scripts/hook.js'])
    expect(registered.get('main')?.js).toEqual([COPY, 'scripts/other.js'])
    expect(registered.get('plain')?.js).toEqual(['/scripts/hook.js'])
  })

  it('keeps a leading slash or dot as the author wrote it', async () => {
    const {scripting, registered} = browserWith()

    await scripting.registerContentScripts([
      {id: 'root', js: ['/scripts/hook.js'], world: 'MAIN'},
      {id: 'dot', js: ['./scripts/hook.js'], world: 'MAIN'}
    ])

    expect(registered.get('root')?.js).toEqual([`/${COPY}`])
    expect(registered.get('dot')?.js).toEqual([`./${COPY}`])
  })

  it('does not change the list the author passed', async () => {
    const {scripting} = browserWith()
    const mine = [{id: 'main', js: ['scripts/hook.js'], world: 'MAIN'}]

    await scripting.registerContentScripts(mine)

    expect(mine[0].js).toEqual(['scripts/hook.js'])
  })

  it('answers the registry with the name the author wrote', async () => {
    const {scripting} = browserWith()

    await scripting.registerContentScripts([
      {id: 'main', js: ['scripts/hook.js'], world: 'MAIN'}
    ])

    const promised = await scripting.getRegisteredContentScripts()
    const called = await new Promise<Script[]>((resolve) =>
      scripting.getRegisteredContentScripts({ids: ['main']}, resolve)
    )
    const bare = await new Promise<Script[]>((resolve) =>
      scripting.getRegisteredContentScripts(resolve)
    )

    for (const list of [promised, called, bare]) {
      expect(list).toEqual([
        {id: 'main', js: ['scripts/hook.js'], world: 'MAIN'}
      ])
    }
  })

  it('injects the copy into the MAIN world alone', async () => {
    const {scripting, injected} = browserWith()

    await scripting.executeScript({
      target: {tabId: 1},
      files: ['scripts/hook.js'],
      world: 'MAIN'
    })

    await scripting.executeScript({
      target: {tabId: 1},
      files: ['scripts/hook.js']
    })

    await scripting.executeScript({
      target: {tabId: 1},
      func: () => 1,
      world: 'MAIN'
    })

    expect(injected[0].files).toEqual([COPY])
    expect(injected[1].files).toEqual(['scripts/hook.js'])
    expect(injected[2].files).toBeUndefined()
  })

  it('follows an update that names the world or the files alone', async () => {
    const {scripting, registered} = browserWith()

    await scripting.registerContentScripts([
      {id: 'a', js: ['scripts/hook.js'], world: 'MAIN'},
      {id: 'b', js: ['scripts/hook.js'], world: 'ISOLATED'}
    ])

    await scripting.updateContentScripts([
      {id: 'a', world: 'ISOLATED'},
      {id: 'b', world: 'MAIN'}
    ])

    expect(registered.get('a')?.js).toEqual(['scripts/hook.js'])
    expect(registered.get('b')?.js).toEqual([COPY])

    await scripting.updateContentScripts([{id: 'b', js: ['scripts/hook.js']}])
    await new Promise<void>((resolve) =>
      scripting.updateContentScripts(
        [{id: 'a', js: ['scripts/hook.js'], world: 'MAIN'}],
        resolve
      )
    )

    expect(registered.get('b')?.js).toEqual([COPY])
    expect(registered.get('a')?.js).toEqual([COPY])
  })

  it('leaves an update that names neither as it was written', async () => {
    const {scripting, registered} = browserWith()

    await scripting.registerContentScripts([
      {id: 'a', js: ['scripts/hook.js'], world: 'MAIN'}
    ])

    await scripting.updateContentScripts([{id: 'a', runAt: 'document_start'}])

    expect(registered.get('a')).toEqual({
      id: 'a',
      js: [COPY],
      world: 'MAIN',
      runAt: 'document_start'
    })
  })

  it('wraps a namespace once, however many names reach it', async () => {
    const {scripting, registered} = browserWith(['chrome', 'browser'])

    expect(scripting[MAIN_WORLD_COPY_ROUTING_MARK]).toBe(true)

    await scripting.registerContentScripts([
      {id: 'main', js: ['scripts/hook.js'], world: 'MAIN'}
    ])

    expect(registered.get('main')?.js).toEqual([COPY])
  })

  it('hands the browser a call it cannot read as it was made', () => {
    const {scripting, injected} = browserWith()

    scripting.executeScript(undefined)

    expect(injected).toEqual([undefined])
    expect(() => scripting.updateContentScripts('nothing')).toThrow('shape')
    expect(() => scripting.registerContentScripts('nothing')).toThrow('shape')
    expect(() => scripting.registerContentScripts([null])).toThrow('shape')
    expect(() => scripting.updateContentScripts([null])).toThrow('shape')
  })

  // An update that names the files or the world alone waits on a read of the
  // registry, and a call that waits cannot throw where the author made it.
  it('throws the shape check of an update it has to wait on', async () => {
    const {scripting, registered, updates} = browserWith()

    await scripting.registerContentScripts([
      {id: 'a', js: ['scripts/hook.js'], world: 'MAIN'}
    ])

    const malformed = [{id: 5, js: ['scripts/hook.js']}]
    let caught: unknown

    try {
      scripting.updateContentScripts(malformed)
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(TypeError)
    expect(() => scripting.updateContentScripts(malformed, () => {})).toThrow(
      'shape'
    )

    expect(() =>
      scripting.updateContentScripts([{id: 5, world: 'MAIN'}])
    ).toThrow('shape')

    expect(updates).toEqual([])

    await scripting.updateContentScripts([{id: 'a', js: ['scripts/hook.js']}])

    // The check changed nothing, and the update landed once.
    expect(updates).toEqual([[{id: 'a', js: [COPY]}]])
    expect([...registered.keys()]).toEqual(['a'])
  })

  it('still answers an update of an id no registration has as the browser does', async () => {
    const {scripting} = browserWith()

    await expect(
      scripting.updateContentScripts([{id: 'gone', js: ['scripts/hook.js']}])
    ).rejects.toThrow('no such script')
  })

  it('runs where no scripting namespace exists', () => {
    expect(() => vm.runInNewContext(SOURCE, {})).not.toThrow()
  })
})

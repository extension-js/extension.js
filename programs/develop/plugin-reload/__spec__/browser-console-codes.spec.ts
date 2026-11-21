import * as fs from 'node:fs'
import * as path from 'node:path'
import * as vm from 'node:vm'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {log} from '../../lib/dev-server-client-log'
import {CODES} from '../../lib/messaging'
import type {LoaderInterface} from '../../types'
import PageSocketClient from '../reload-lib/page-socket-client'
import ensureHMRForScripts from '../steps/ensure-hmr-for-scripts'

const DEVELOP = path.join(__dirname, '..', '..')

// Every file whose text ends up running in the browser and prints there.
const CLIENTS: Record<string, string[]> = {
  'plugin-reload/reload-lib/dev-content-scripts.ts': [
    CODES.W_CONTENT_SCRIPT_NOT_INJECTED,
    CODES.W_RELOAD_NOT_APPLIED
  ],
  'plugin-reload/reload-lib/producer-reload.ts': [CODES.W_RELOAD_NOT_APPLIED],
  'plugin-reload/reload-lib/page-socket-client.ts': [CODES.W_DEV_SERVER_SOCKET],
  'plugin-reload/steps/ensure-hmr-for-scripts.ts': [CODES.W_RELOAD_NOT_APPLIED],
  'plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/content-script-wrapper.ts':
    [CODES.W_CONTENT_SCRIPT_CLEANUP, CODES.W_CONTENT_SCRIPT_MOUNT],
  'plugin-reload/reload-lib/minimum-files/minimum-background-file-chromium.ts':
    [],
  'plugin-reload/reload-lib/minimum-files/minimum-background-file-firefox.ts':
    []
}

const read = (file: string) =>
  fs.readFileSync(path.join(DEVELOP, ...file.split('/')), 'utf8')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('the codes the browser side prints', () => {
  it.each(
    Object.entries(CLIENTS)
  )('%s names only declared warning codes', (file, codes) => {
    const named = [...read(file).matchAll(/\b[EW]_[A-Z][A-Z_]+\b/g)]
      .map((match) => match[0])
      .filter((code) => !code.startsWith('E_') || code in CODES)

    expect([...new Set(named)].sort()).toEqual(codes)

    for (const code of codes) {
      expect(CODES).toHaveProperty(code)
      expect(code.startsWith('W_')).toBe(true)
    }
  })

  it.each(
    Object.keys(CLIENTS)
  )('%s prints no failure under the bare brand', (file) => {
    expect(read(file)).not.toMatch(/Extension\.js: /)
  })
})

describe('the lines that only inform carry no code', () => {
  it('announces a reload in open tabs as plain text', () => {
    const source = read('plugin-reload/reload-lib/producer-reload.ts')
    const announced = source
      .split('\n')
      .filter((line) => line.includes('[Extension.js] Reloading'))

    expect(announced).toHaveLength(1)
    expect(announced[0]).not.toMatch(/[EW]_[A-Z]/)
  })

  it.each([
    'chromium',
    'firefox'
  ])('says the %s reload worker loaded as plain text', (engine) => {
    const logged = read(
      `plugin-reload/reload-lib/minimum-files/minimum-background-file-${engine}.ts`
    )
      .split('\n')
      .filter((line) => line.includes('console.'))

    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatch(/^console\.log\('Minimum \w+ file loaded/)
    expect(logged[0]).not.toMatch(/[EW]_[A-Z]/)
  })
})

describe('the hot update prelude of a page script', () => {
  const prelude = () => {
    let emitted = ''
    const returned = ensureHMRForScripts.call(
      {
        getOptions: () => ({manifestPath: '/m'}),
        resourcePath: '/proj/page.js',
        resourceQuery: '',
        _module: {type: 'javascript/dynamic'},
        callback: (_error: unknown, code: string) => {
          emitted = code
        }
      } as unknown as LoaderInterface,
      'var marker = 1;'
    )

    return emitted || String(returned ?? '')
  }

  function runPrelude(hot: Record<string, unknown>, document: unknown) {
    const warned: unknown[][] = []
    const errored: unknown[][] = []

    vm.runInNewContext(prelude(), {
      module: {hot},
      document,
      console: {
        warn: (...args: unknown[]) => warned.push(args),
        error: (...args: unknown[]) => errored.push(args)
      }
    })

    return {warned, errored}
  }

  it('names the code when the page cannot accept hot updates', () => {
    const refused = new Error('accept refused')
    const {warned, errored} = runPrelude(
      {
        accept: () => {
          throw refused
        }
      },
      {}
    )

    expect(errored).toEqual([])
    expect(warned).toEqual([
      [
        'Extension.js W_RELOAD_NOT_APPLIED: the page could not accept hot updates, so an edit shows after the page is reloaded.',
        refused
      ]
    ])
  })

  it('names the code when the page cannot be cleared', () => {
    let dispose: (() => void) | undefined
    const gone = new Error('no document')
    const {warned} = runPrelude(
      {
        accept: () => {},
        dispose: (run: () => void) => {
          dispose = run
        }
      },
      {
        getElementById: () => {
          throw gone
        }
      }
    )

    expect(warned).toEqual([])
    dispose?.()

    expect(warned).toEqual([
      [
        'Extension.js W_RELOAD_NOT_APPLIED: the page could not be cleared for the hot update, so the version before may stay under the new one.',
        gone
      ]
    ])
  })
})

describe('the page socket', () => {
  it('names the code when the socket fails', () => {
    class FailingSocket {
      onerror: ((event: unknown) => void) | null = null
    }

    const errors = vi.spyOn(log, 'error').mockImplementation(() => {})

    vi.stubGlobal('WebSocket', FailingSocket)
    vi.stubGlobal('location', {pathname: '/options/index.html'})

    const socket = new PageSocketClient('ws://127.0.0.1:8080/ws')
    const event = {type: 'error'}

    ;(socket.client as unknown as FailingSocket).onerror?.(event)

    expect(errors.mock.calls).toEqual([
      [
        'Extension.js W_DEV_SERVER_SOCKET: the page lost its dev server socket, so edits show after the page is reloaded.',
        event
      ]
    ])
  })
})

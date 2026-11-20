import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {pageSocketUrl} from '../../plugin-web-extension/feature-html/steps/page-socket-client'
import {
  attachHtmlRefresh,
  clientsShowing,
  emittedPages,
  htmlSourcesToRefresh,
  pageOfSocketRequest,
  pagesBuiltFrom
} from '../html-refresh'

const root = path.resolve('/proj')
const at = (...segments: string[]) => path.join(root, ...segments)

describe('htmlSourcesToRefresh', () => {
  it('names a saved page the compile depends on', () => {
    expect(
      htmlSourcesToRefresh(
        [at('options', 'index.html')],
        [at('options', 'index.html'), at('background.js')],
        at('dist', 'chrome')
      )
    ).toEqual([at('options', 'index.html')])
  })

  it('leaves out a saved html file the build never read', () => {
    expect(
      htmlSourcesToRefresh(
        [at('store', 'demo', 'chart.html'), root],
        [at('options', 'index.html')],
        at('dist', 'chrome')
      )
    ).toEqual([])
  })

  it('leaves out a dependency that is not a page and an emitted page', () => {
    expect(
      htmlSourcesToRefresh(
        [at('background.js'), at('dist', 'chrome', 'options', 'index.html')],
        [at('background.js'), at('dist', 'chrome', 'options', 'index.html')],
        at('dist', 'chrome')
      )
    ).toEqual([])
  })

  it('answers nothing when the compiler reports no modified files', () => {
    expect(
      htmlSourcesToRefresh(undefined, [at('options', 'index.html')], '')
    ).toEqual([])
  })
})

describe('pageOfSocketRequest', () => {
  it('reads the page a socket URL names, without its leading slash', () => {
    expect(pageOfSocketRequest('/ws?page=%2Foptions%2Findex.html')).toBe(
      'options/index.html'
    )
  })

  it('answers undefined for a socket URL that names no page', () => {
    expect(pageOfSocketRequest('/ws')).toBeUndefined()
    expect(pageOfSocketRequest(undefined)).toBeUndefined()
  })
})

describe('attachHtmlRefresh', () => {
  type Client = {id: string}

  function harness(errors: unknown[] = []) {
    let done: ((stats: unknown) => void) | undefined
    let watchRun: (() => void) | undefined
    let connect:
      | ((client: Client, request?: {url?: string}) => void)
      | undefined
    const compiler = {
      modifiedFiles: undefined as Set<string> | undefined,
      options: {context: root},
      hooks: {
        watchRun: {
          tap: (_name: string, fn: () => void) => {
            watchRun = fn
          }
        },
        done: {
          tap: (_name: string, fn: (stats: unknown) => void) => {
            done = fn
          }
        }
      }
    }
    const sendMessage = vi.fn()
    const clients: Client[] = []
    const server = {
      webSocketServer: {
        clients,
        implementation: {
          on: (_event: string, fn: typeof connect) => {
            connect = fn
          }
        }
      },
      sendMessage
    }
    attachHtmlRefresh(compiler as never, server as never)
    const stats = {
      compilation: {
        errors,
        fileDependencies: new Set([
          at('options', 'index.html'),
          at('popup.html')
        ]),
        options: {output: {path: at('dist', 'chrome')}},
        getAssets: () => [
          {
            name: 'options/index.html',
            info: {sourceFilename: 'options/index.html'}
          },
          {name: 'action/index.html', info: {sourceFilename: 'popup.html'}},
          {name: 'background/service_worker.js', info: {}}
        ]
      }
    }

    return {
      open: (id: string, url = '/ws') => {
        const client = {id}
        clients.push(client)
        connect?.(client, {url})

        return client
      },
      save: (...files: string[]) => {
        compiler.modifiedFiles = new Set(files)
        watchRun?.()
      },
      fire: () => done?.(stats),
      sendMessage
    }
  }

  it('reloads the options client and leaves a popup client untouched', () => {
    const {open, save, fire, sendMessage} = harness()
    open('popup', '/ws?page=%2Faction%2Findex.html')
    const options = open('options', '/ws?page=%2Foptions%2Findex.html')
    save(at('options', 'index.html'))
    fire()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      [options],
      'static-changed',
      at('options', 'index.html')
    )
  })

  it('still reloads a client that names no page', () => {
    const {open, save, fire, sendMessage} = harness()
    open('popup', '/ws?page=%2Faction%2Findex.html')
    const unnamed = open('unnamed')
    save(at('options', 'index.html'))
    fire()

    expect(sendMessage).toHaveBeenCalledWith(
      [unnamed],
      'static-changed',
      at('options', 'index.html')
    )
  })

  it('reloads a client whose path is no emitted page, a route it pushed', () => {
    const {open, save, fire, sendMessage} = harness()
    open('popup', '/ws?page=%2Faction%2Findex.html')
    const routed = open('routed', '/ws?page=%2Fsettings%2Fprofile')
    save(at('options', 'index.html'))
    fire()

    expect(sendMessage).toHaveBeenCalledTimes(1)
    expect(sendMessage).toHaveBeenCalledWith(
      [routed],
      'static-changed',
      at('options', 'index.html')
    )
  })

  it('keeps a page saved before a second watchRun inside one compile', () => {
    const {open, save, fire, sendMessage} = harness()
    const page = open('page')
    save(at('options', 'index.html'))
    save(at('background.js'))
    fire()

    expect(sendMessage).toHaveBeenCalledWith(
      [page],
      'static-changed',
      at('options', 'index.html')
    )
  })

  it('sends nothing for an unrelated html file', () => {
    const {open, save, fire, sendMessage} = harness()
    open('page')
    save(at('store', 'demo', 'chart.html'))
    fire()

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends nothing for a failed compile', () => {
    const {open, save, fire, sendMessage} = harness([new Error('x')])
    open('page')
    save(at('options', 'index.html'))
    fire()

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('forgets a page once a compile delivered it', () => {
    const {open, save, fire, sendMessage} = harness()
    open('page')
    save(at('options', 'index.html'))
    fire()
    save(at('background.js'))
    fire()

    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})

describe('a page as the browser names it and the build emitted it', () => {
  const assets = [
    {name: 'pages/x.html', info: {sourceFilename: 'pages/x.html'}},
    {name: 'pages/my page.html', info: {sourceFilename: 'pages/my page.html'}},
    {name: 'pages/página.html', info: {sourceFilename: 'pages/página.html'}},
    {name: 'options/index.html', info: {sourceFilename: 'options.html'}}
  ]

  // What the page client hands over: the decoded path of the tab.
  function reloaded(pathnameInBrowser: string, source: string) {
    const url = pageSocketUrl(
      'ws://127.0.0.1:8080/ws',
      decodeURIComponent(pathnameInBrowser)
    )
    const page = pageOfSocketRequest(url.replace('ws://127.0.0.1:8080', ''))
    const pages = pagesBuiltFrom(at(...source.split('/')), assets, root)

    return clientsShowing([{}], pages, () => page, emittedPages(assets)).length
  }

  it.each([
    ['a plain name', '/pages/x.html', 'pages/x.html', 1],
    [
      'a space in the name',
      new URL('chrome-extension://abc/pages/my page.html').pathname,
      'pages/my page.html',
      1
    ],
    [
      'a non-ASCII name',
      new URL('chrome-extension://abc/pages/página.html').pathname,
      'pages/página.html',
      1
    ],
    ['a route the page pushed', '/settings/profile', 'options.html', 1],
    ['another emitted page', '/pages/x.html', 'options.html', 0]
  ])('%s', (_name, pathname, source, count) => {
    expect(reloaded(pathname, source)).toBe(count)
  })
})

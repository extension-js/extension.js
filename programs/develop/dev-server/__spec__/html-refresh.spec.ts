import * as path from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {attachHtmlRefresh, htmlSourcesToRefresh} from '../html-refresh'

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

describe('attachHtmlRefresh', () => {
  function harness(modifiedFiles: string[], errors: unknown[] = []) {
    let done: ((stats: unknown) => void) | undefined
    const compiler = {
      modifiedFiles: new Set(modifiedFiles),
      hooks: {
        done: {
          tap: (_name: string, fn: (stats: unknown) => void) => {
            done = fn
          }
        }
      }
    }
    const sendMessage = vi.fn()
    const server = {
      webSocketServer: {clients: [{id: 'page'}]},
      sendMessage
    }
    attachHtmlRefresh(compiler as never, server)
    const stats = {
      compilation: {
        errors,
        fileDependencies: new Set([at('options', 'index.html')]),
        options: {output: {path: at('dist', 'chrome')}}
      }
    }

    return {fire: () => done?.(stats), sendMessage, server}
  }

  it('sends static-changed for a saved page to every connected client', () => {
    const {fire, sendMessage, server} = harness([at('options', 'index.html')])
    fire()

    expect(sendMessage).toHaveBeenCalledWith(
      server.webSocketServer.clients,
      'static-changed',
      at('options', 'index.html')
    )
  })

  it('sends nothing for an unrelated html file', () => {
    const {fire, sendMessage} = harness([at('store', 'demo', 'chart.html')])
    fire()

    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends nothing for a failed compile', () => {
    const {fire, sendMessage} = harness(
      [at('options', 'index.html')],
      [new Error('x')]
    )
    fire()

    expect(sendMessage).not.toHaveBeenCalled()
  })
})

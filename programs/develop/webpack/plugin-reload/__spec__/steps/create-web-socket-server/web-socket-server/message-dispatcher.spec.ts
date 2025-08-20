import {describe, it, expect, vi, beforeEach} from 'vitest'
import WebSocket from 'ws'

// Mock manifest fields resolver used by messageDispatcher
vi.mock('../../../../../plugin-extension/data/manifest-fields', () => {
  return {
    getManifestFieldsData: () => ({
      locales: ['_locales/en/messages.json'],
      scripts: {
        'background/service_worker': [['background/service_worker.js']],
        content_scripts: [['content/script.js']]
      },
      json: {
        declarative_net_request: ['rules.json']
      },
      html: {
        action: 'pages/popup.html',
        options_ui: 'pages/options.html'
      }
    })
  }
})

// Import after mocks
import {messageDispatcher} from '../../../../steps/create-web-socket-server/web-socket-server/message-dispatcher'

function makeFakeServer() {
  const sent: unknown[] = []
  const client = {
    readyState: WebSocket.OPEN,
    send: vi.fn((data: string) => {
      try {
        sent.push(JSON.parse(data))
      } catch {
        sent.push(data)
      }
    })
  }
  const server: any = {
    clients: new Set([client])
  }
  return {server, sent, client}
}

describe('messageDispatcher', () => {
  let server: any
  let sent: any[]

  beforeEach(() => {
    const fake = makeFakeServer()
    server = fake.server
    sent = fake.sent
  })

  it('dispatches manifest change notification', () => {
    messageDispatcher(server, '/path/to/manifest.json', 'manifest.json')
    expect(sent).toEqual([{changedFile: 'manifest.json'}])
  })

  it('dispatches locales change notification', () => {
    messageDispatcher(
      server,
      '/path/to/manifest.json',
      '_locales/en/messages.json'
    )
    expect(sent).toEqual([{changedFile: '_locales'}])
  })

  it('dispatches service_worker change when background SW file updates', () => {
    messageDispatcher(
      server,
      '/path/to/manifest.json',
      'background/service_worker.js'
    )
    expect(sent).toEqual([{changedFile: 'service_worker'}])
  })

  it('dispatches declarative_net_request change for JSON rules updates', () => {
    messageDispatcher(server, '/path/to/manifest.json', 'rules.json')
    expect(sent).toEqual([{changedFile: 'declarative_net_request'}])
  })

  it('dispatches entrypoint change for HTML page updates', () => {
    messageDispatcher(server, '/path/to/manifest.json', 'pages/popup.html')
    expect(sent).toEqual([{changedFile: 'entrypoint'}])
  })
})

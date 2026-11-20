import {afterEach, describe, expect, it, vi} from 'vitest'
import {pageOfSocketRequest} from '../../../../dev-server/html-refresh'
import PageSocketClient, {pageSocketUrl} from '../../steps/page-socket-client'

class FakeSocket {
  static opened: string[] = []
  onmessage: ((event: {data: unknown}) => void) | null = null

  constructor(url: string) {
    FakeSocket.opened.push(url)
  }
}

afterEach(() => {
  FakeSocket.opened = []
  vi.unstubAllGlobals()
})

describe('PageSocketClient', () => {
  it('opens the socket with ?page=<pathname> of the page it runs in', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('location', {pathname: '/options/index.html'})
    new PageSocketClient('ws://127.0.0.1:8080/ws')

    expect(FakeSocket.opened).toEqual([
      'ws://127.0.0.1:8080/ws?page=%2Foptions%2Findex.html'
    ])
  })

  it('names a page with a space or accent as the build emitted it', () => {
    vi.stubGlobal('WebSocket', FakeSocket)

    for (const [pathname, page] of [
      ['/pages/my%20page.html', 'pages/my page.html'],
      ['/pages/caf%C3%A9.html', 'pages/café.html'],
      ['/my%20options/index.html', 'my options/index.html']
    ]) {
      FakeSocket.opened = []
      vi.stubGlobal('location', {pathname})
      new PageSocketClient('ws://127.0.0.1:8080/ws')

      expect(pageOfSocketRequest(FakeSocket.opened[0])).toBe(page)
    }
  })

  it('keeps a path it cannot decode as the browser gave it', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('location', {pathname: '/pages/100%.html'})
    new PageSocketClient('ws://127.0.0.1:8080/ws')

    expect(FakeSocket.opened).toEqual([
      'ws://127.0.0.1:8080/ws?page=%2Fpages%2F100%25.html'
    ])
  })

  it('passes each message body on, like the stock client', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    vi.stubGlobal('location', {pathname: '/action/index.html'})
    const socket = new PageSocketClient('ws://127.0.0.1:8080/ws')
    const seen: unknown[] = []
    socket.onMessage((data) => seen.push(data))
    ;(socket.client as unknown as FakeSocket).onmessage?.({
      data: '{"type":"ok"}'
    })

    expect(seen).toEqual(['{"type":"ok"}'])
  })
})

describe('pageSocketUrl', () => {
  it('adds the page after a query the URL already has', () => {
    expect(pageSocketUrl('ws://h:1/ws?x=1', '/a.html')).toBe(
      'ws://h:1/ws?x=1&page=%2Fa.html'
    )
  })

  it('keeps the session socket path the dev client dials', () => {
    expect(
      pageSocketUrl('ws://127.0.0.1:8080/ws/session-1', '/options/index.html')
    ).toBe('ws://127.0.0.1:8080/ws/session-1?page=%2Foptions%2Findex.html')
  })

  it('keeps the URL as given when there is no page path', () => {
    expect(pageSocketUrl('ws://h:1/ws', undefined)).toBe('ws://h:1/ws')
  })
})

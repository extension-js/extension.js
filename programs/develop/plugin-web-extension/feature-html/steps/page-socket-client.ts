// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

export function pageSocketUrl(url: string, pathname: string | undefined) {
  if (!pathname) return url

  const joiner = url.includes('?') ? '&' : '?'

  return `${url}${joiner}page=${encodeURIComponent(pathname)}`
}

function currentPathname(): string | undefined {
  const location = (globalThis as {location?: {pathname?: unknown}}).location
  const pathname = location?.pathname

  return typeof pathname === 'string' ? pathname : undefined
}

// The same surface as the stock dev client socket, which this one replaces.
export default class PageSocketClient {
  client: WebSocket

  constructor(url: string) {
    this.client = new WebSocket(pageSocketUrl(url, currentPathname()))
  }

  onOpen(fn: (event: Event) => void) {
    this.client.onopen = fn
  }

  onClose(fn: (event: CloseEvent) => void) {
    this.client.onclose = fn
  }

  onMessage(fn: (data: unknown) => void) {
    this.client.onmessage = (event) => {
      fn(event.data)
    }
  }
}

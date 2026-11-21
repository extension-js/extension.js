import {EventEmitter} from 'node:events'
import {type Mock, vi} from 'vitest'
import type WebSocket from 'ws'
import type {CDPClient} from '../run-chromium/cdp/cdp-client'

// A socket with only the members the client reads: its state, send and close.
export type FakeSocket = EventEmitter & {
  readyState: number
  send: Mock<(data: string) => void>
  close: Mock<() => void>
}

export function fakeSocket(open: number = 1, closed: number = 3): FakeSocket {
  const socket = Object.assign(new EventEmitter(), {
    readyState: open,
    send: vi.fn<(data: string) => void>(),
    close: vi.fn<() => void>()
  })
  socket.close.mockImplementation(() => {
    socket.readyState = closed
  })

  return socket
}

// The private client members the specs drive the protocol through.
export interface CDPClientInternals {
  ws: WebSocket | FakeSocket | null
  pendingRequests: Map<number, unknown>
  handleMessage: (data: string) => void
  rejectAllPending: (reason: string) => void
}

export function clientInternals(client: CDPClient): CDPClientInternals {
  return client as unknown as CDPClientInternals
}

// Where a seam is typed for the real socket, the fake stands in for it.
export function asWebSocket(socket: FakeSocket): WebSocket {
  return socket as unknown as WebSocket
}

// A partial client for the helpers that take one: the fake keeps its own
// mock types so a row can still read the calls it made.
export function asCdpClient<T extends object>(fake: T): CDPClient & T {
  return fake as unknown as CDPClient & T
}

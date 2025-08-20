import {describe, it, expect} from 'vitest'
import {
  httpsServer,
  httpServer
} from '../../../../steps/create-web-socket-server/web-socket-server/servers'

describe('servers', () => {
  it('httpServer returns a running server', () => {
    const {server, port} = httpServer(0)
    expect(server).toBeTruthy()
    expect(typeof port).toBe('number')
    server.close()
  })

  it('httpsServer falls back to http when certs are missing', () => {
    const {server, port} = httpsServer(0)
    expect(server).toBeTruthy()
    expect(typeof port).toBe('number')
    server.close()
  })
})

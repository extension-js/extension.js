import {describe, it, expect} from 'vitest'
import DevServerConfigPlugin from '../webpack-target-webextension-fork/lib/webpack5/HMRDevServer'

describe('HMRDevServer config (websocket URL)', () => {
  it('propagates devServer host/port to client.webSocketURL', () => {
    const compiler: any = {
      options: {
        devServer: {
          host: '127.0.0.1',
          port: 18080,
          client: {
            webSocketURL: {protocol: 'ws'}
          }
        }
      }
    }

    new DevServerConfigPlugin().apply(compiler)

    expect(compiler.options.devServer.client.webSocketURL.protocol).toBe('ws')
    expect(compiler.options.devServer.client.webSocketURL.hostname).toBe('127.0.0.1')
    expect(compiler.options.devServer.client.webSocketURL.port).toBe(18080)
  })
})


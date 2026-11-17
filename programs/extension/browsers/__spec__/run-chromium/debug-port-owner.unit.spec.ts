import * as http from 'node:http'
import type * as net from 'node:net'
import {afterEach, describe, expect, it} from 'vitest'
import {debugPortOwner} from '../../run-chromium/cdp/debug-port-owner'

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve)))
  )
})

// Stands in for the HTTP side of a browser's debugging port.
function browserListing(ids: string[]): Promise<number> {
  return new Promise((resolve) => {
    const server = http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        request.url === '/json/list'
          ? JSON.stringify(ids.map((id) => ({id, type: 'page'})))
          : '{}'
      )
    })
    servers.push(server)
    server.listen(0, '127.0.0.1', () =>
      resolve((server.address() as net.AddressInfo).port)
    )
  })
}

const quick = {attempts: 6, intervalMs: 5}

describe('debugPortOwner', () => {
  it('names this browser when the port lists a target the pipe also has', async () => {
    const port = await browserListing(['AAA', 'BBB'])

    expect(await debugPortOwner(port, async () => ['BBB', 'CCC'], quick)).toBe(
      'this-browser'
    )
  })

  it('names another browser when the port lists none of the targets on the pipe', async () => {
    const port = await browserListing(['XXX', 'YYY'])

    expect(await debugPortOwner(port, async () => ['AAA', 'BBB'], quick)).toBe(
      'another-browser'
    )
  })

  it('says closed when nothing answers on the port', async () => {
    const port = await browserListing([])
    await new Promise((resolve) => servers.splice(0)[0].close(resolve))

    expect(await debugPortOwner(port, async () => ['AAA'], quick)).toBe(
      'closed'
    )
  })

  it('waits for a tab that opened between the two reads', async () => {
    const port = await browserListing(['NEW'])
    let asked = 0

    expect(
      await debugPortOwner(
        port,
        async () => (++asked < 3 ? ['OLD'] : ['OLD', 'NEW']),
        quick
      )
    ).toBe('this-browser')
  })
})

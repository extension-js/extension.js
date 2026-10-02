import net from 'node:net'
import {afterEach} from 'vitest'

// This package's suite is a required gate, so a spec that reaches a CDN turns a
// slow link into a red gate on a correct change. Only loopback is allowed, and
// EXTENSION_TEST_REMOTE lifts the rule for the *.remote.spec.ts files.
// The RFC 5737 documentation ranges are reserved as unroutable, so a spec that
// needs an address nothing can answer uses one and reaches no network.
const LOOPBACK =
  /^(?:localhost|127(?:\.\d{1,3}){3}|::1|\[::1\]|::ffff:127(?:\.\d{1,3}){3}|192\.0\.2\.\d{1,3}|198\.51\.100\.\d{1,3}|203\.0\.113\.\d{1,3})$/i

const reached: string[] = []

function connectHost(args: unknown[]): string {
  const first = args[0]

  if (typeof first === 'object' && first !== null) {
    const options = first as {host?: string; path?: string}
    if (options.path) return ''

    return String(options.host || '')
  }

  const second = args[1]

  return typeof second === 'string' ? second : ''
}

if (!process.env.EXTENSION_TEST_REMOTE) {
  const connect = net.Socket.prototype.connect

  net.Socket.prototype.connect = function patchedConnect(
    this: net.Socket,
    ...args: Parameters<typeof connect>
  ) {
    const host = connectHost(args)

    if (host && !LOOPBACK.test(host)) {
      reached.push(host)

      throw new Error(`this spec reached the network: ${host}`)
    }

    return connect.apply(this, args)
  } as typeof connect

  afterEach(() => {
    const hosts = reached.splice(0, reached.length)

    if (hosts.length > 0) {
      throw new Error(
        `a spec in a required gate reached the network: ${hosts.join(', ')}`
      )
    }
  })
}

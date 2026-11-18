import {describe, expect, it} from 'vitest'
import {
  devServerAccessConfig,
  isRequestFromSession,
  isSessionWebOrigin,
  isSocketFromSession,
  REFUSED_REQUEST_RESPONSE,
  refusedRequestOrigin
} from '../cors'
import {devServerOutsideRequestRefused} from '../messages'

const PORT = 51234
const EXTENSION = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop'
const FIREFOX_EXTENSION = 'moz-extension://0b0f1c7e-3c2a-4a54-9d0b-0d7f6a1c2b3d'
const VIEWER = 'https://viewer.example'

function session(
  overrides: Partial<Parameters<typeof devServerAccessConfig>[0]> = {}
) {
  return devServerAccessConfig({
    host: '127.0.0.1',
    port: PORT,
    connectableHost: '127.0.0.1',
    isSessionExtensionOrigin: (origin) =>
      origin === EXTENSION || origin === FIREFOX_EXTENSION,
    ...overrides
  }).requestSite
}

type Headers = Record<string, string>

const HOST = `127.0.0.1:${PORT}`
const OWN = `http://127.0.0.1:${PORT}`

function verdict(headers: Headers, overrides = {}) {
  return isRequestFromSession({host: HOST, ...headers}, session(overrides))
}

describe('whether a request belongs to the session', () => {
  it.each<[string, Headers]>([
    ['no fetch metadata at all', {}],
    ['no fetch metadata and an Origin', {origin: 'https://other.test'}],
    ['a value the header does not define', {'sec-fetch-site': 'elsewhere'}],
    [
      'an address typed in the browser',
      {'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate'}
    ],
    [
      'a page the server itself served',
      {'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'no-cors'}
    ],
    [
      'a same-origin request that carries its Origin',
      {'sec-fetch-site': 'same-origin', origin: OWN}
    ],
    [
      'the session extension from a page or its worker',
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        origin: EXTENSION
      }
    ],
    [
      'the session extension with host access in Chromium',
      {'sec-fetch-site': 'none', 'sec-fetch-mode': 'cors', origin: EXTENSION}
    ],
    [
      'the session extension with host access in Firefox',
      {'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors'}
    ],
    [
      'the session extension in Firefox',
      {'sec-fetch-site': 'cross-site', origin: FIREFOX_EXTENSION}
    ],
    [
      'the localhost spelling of the session address',
      {'sec-fetch-site': 'cross-site', origin: `http://localhost:${PORT}`}
    ],
    [
      'the IPv6 spelling of the session address',
      {'sec-fetch-site': 'cross-site', origin: `http://[::1]:${PORT}`}
    ],
    [
      'the session address with no Origin, by its referrer',
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'no-cors',
        referer: `http://localhost:${PORT}/page.html`
      }
    ]
  ])('passes %s', (_name, headers) => {
    expect(verdict(headers)).toBe(true)
  })

  it.each<[string, Headers]>([
    [
      'a script or image tag on another site',
      {'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors'}
    ],
    [
      'a fetch from another site',
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'cors',
        origin: 'https://other.test'
      }
    ],
    [
      'a link or frame on another site',
      {
        'sec-fetch-site': 'cross-site',
        'sec-fetch-mode': 'navigate',
        referer: 'https://other.test/'
      }
    ],
    [
      'another port on the same host, with its Origin',
      {'sec-fetch-site': 'same-site', origin: 'http://127.0.0.1:3000'}
    ],
    [
      'another port on the same host, with no Origin',
      {'sec-fetch-site': 'same-site', 'sec-fetch-mode': 'no-cors'}
    ],
    [
      'another port on the same host, by its referrer',
      {'sec-fetch-site': 'same-site', referer: 'http://127.0.0.1:3000/'}
    ],
    [
      'another port on localhost',
      {'sec-fetch-site': 'cross-site', origin: 'http://localhost:3000'}
    ],
    [
      'a name that only starts like the session host',
      {
        'sec-fetch-site': 'cross-site',
        origin: `http://127.0.0.1.other.test:${PORT}`
      }
    ],
    [
      'an extension that is not the session one',
      {
        'sec-fetch-site': 'cross-site',
        origin: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
      }
    ],
    [
      'another extension with host access in Chromium',
      {
        'sec-fetch-site': 'none',
        origin: 'chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'
      }
    ],
    [
      'a same-origin claim with an Origin from elsewhere',
      {'sec-fetch-site': 'same-origin', origin: 'https://other.test'}
    ],
    ['a sandboxed frame', {'sec-fetch-site': 'cross-site', origin: 'null'}],
    [
      'the viewer when the session has none',
      {'sec-fetch-site': 'cross-site', origin: VIEWER}
    ]
  ])('refuses %s', (_name, headers) => {
    expect(verdict(headers)).toBe(false)
  })

  it('trims the header values and ignores their case', () => {
    expect(
      verdict({'sec-fetch-site': ' Cross-Site ', origin: 'https://other.test'})
    ).toBe(false)

    expect(verdict({'sec-fetch-site': 'CROSS-SITE', origin: ` ${OWN} `})).toBe(
      true
    )
  })

  it('knows the 127.0.0.1 spelling when the request dialed localhost', () => {
    expect(
      isRequestFromSession(
        {
          host: `localhost:${PORT}`,
          'sec-fetch-site': 'cross-site',
          origin: OWN
        },
        session()
      )
    ).toBe(true)
  })

  it('reads the HTTP/2 authority in place of Host', () => {
    expect(
      isRequestFromSession(
        {
          ':authority': 'dev.example.test',
          'sec-fetch-site': 'cross-site',
          origin: 'https://dev.example.test'
        },
        session()
      )
    ).toBe(true)
  })
})

describe('the origins a session calls its own', () => {
  it('admits the emulator viewer by its exact origin', () => {
    const headers = {'sec-fetch-site': 'cross-site', origin: VIEWER}

    expect(verdict(headers, {emulatorOrigin: VIEWER})).toBe(true)
    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: 'https://viewer.example:8443'},
        {emulatorOrigin: VIEWER}
      )
    ).toBe(false)

    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', referer: `${VIEWER}/chromium/`},
        {emulatorOrigin: VIEWER}
      )
    ).toBe(true)
  })

  it('admits a host named with --allowed-hosts on any port', () => {
    const named = {allowedHosts: 'dev.example.test, .tunnel.test'}

    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: 'https://dev.example.test'},
        named
      )
    ).toBe(true)

    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: 'https://a.tunnel.test:8443'},
        named
      )
    ).toBe(true)

    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: 'https://tunnel.test'},
        named
      )
    ).toBe(true)

    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: 'https://nottunnel.test'},
        named
      )
    ).toBe(false)
  })

  it('admits the --public-host address on the session port alone', () => {
    const publicHost = {host: '0.0.0.0', connectableHost: 'devbox.local'}

    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: `http://devbox.local:${PORT}`},
        publicHost
      )
    ).toBe(true)

    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: 'http://devbox.local:3000'},
        publicHost
      )
    ).toBe(false)

    // A wildcard bind answers on loopback as well.
    expect(
      verdict(
        {'sec-fetch-site': 'cross-site', origin: `http://localhost:${PORT}`},
        publicHost
      )
    ).toBe(true)
  })

  it('leaves loopback out when the server is bound to another address', () => {
    const lan = {host: '192.168.1.5', connectableHost: '192.168.1.5'}
    const lanHost = `192.168.1.5:${PORT}`

    expect(
      isRequestFromSession(
        {
          host: lanHost,
          'sec-fetch-site': 'cross-site',
          origin: `http://localhost:${PORT}`
        },
        session(lan)
      )
    ).toBe(false)

    expect(
      isRequestFromSession(
        {
          host: 'proxy.internal',
          'sec-fetch-site': 'cross-site',
          origin: `http://192.168.1.5:${PORT}`
        },
        session(lan)
      )
    ).toBe(true)
  })

  it('takes the address the request dialed as the session origin', () => {
    const own = session()

    expect(
      isSessionWebOrigin('https://dev.example.test', 'dev.example.test', own)
    ).toBe(true)

    expect(
      isSessionWebOrigin(
        'https://dev.example.test',
        'dev.example.test:443',
        own
      )
    ).toBe(true)

    expect(
      isSessionWebOrigin(
        'https://dev.example.test',
        'dev.example.test:8443',
        own
      )
    ).toBe(false)

    expect(isSessionWebOrigin('https://dev.example.test', '', own)).toBe(false)
    expect(isSessionWebOrigin('https://dev.example.test', 'a b', own)).toBe(
      false
    )

    expect(isSessionWebOrigin('not an origin', HOST, own)).toBe(false)
    expect(isSessionWebOrigin('ftp://127.0.0.1', '127.0.0.1', own)).toBe(false)
  })
})

describe('whether the reload socket opens', () => {
  const socket = (origin?: string, overrides = {}) =>
    isSocketFromSession(
      origin === undefined ? {host: HOST} : {host: HOST, origin},
      session(overrides)
    )

  it.each([
    ['the session address', OWN],
    ['the localhost spelling of it', `http://localhost:${PORT}`],
    ['the IPv6 spelling of it', `http://[::1]:${PORT}`],
    ['the session extension', EXTENSION],
    ['an extension the session has not met', 'chrome-extension://zzzzzzzz'],
    ['a Firefox extension', FIREFOX_EXTENSION]
  ])('opens for %s', (_name, origin) => {
    expect(socket(origin)).toBe(true)
  })

  it.each([
    ['another site', 'https://other.test'],
    ['another port on the same address', 'http://127.0.0.1:3000'],
    ['another port on localhost', 'http://localhost:3000'],
    ['a name under localhost', `http://app.localhost:${PORT}`],
    ['a page opened from a file', 'null'],
    ['a file origin', 'file://'],
    ['the viewer when the session has none', VIEWER]
  ])('stays closed for %s', (_name, origin) => {
    expect(socket(origin)).toBe(false)
  })

  it('opens for the viewer and for a named host', () => {
    expect(socket(VIEWER, {emulatorOrigin: VIEWER})).toBe(true)
    expect(
      socket('https://dev.example.test', {allowedHosts: 'dev.example.test'})
    ).toBe(true)
  })

  it('leaves a client with no Origin to the stock check', () => {
    expect(socket()).toBe(true)
    expect(socket('')).toBe(true)
  })
})

describe('what a refused request is told', () => {
  it('names the origin a refused request carried, cleaned for a terminal', () => {
    expect(refusedRequestOrigin({origin: 'https://other.test'})).toBe(
      'https://other.test'
    )

    expect(refusedRequestOrigin({referer: 'https://other.test/a?b=c'})).toBe(
      'https://other.test'
    )

    expect(refusedRequestOrigin({origin: 'null'})).toBe('')
    expect(refusedRequestOrigin({})).toBe('')
    expect(refusedRequestOrigin({origin: 'https://a.test\u001b[31m x'})).toBe(
      'https://a.test?[31m?x'
    )

    expect(
      refusedRequestOrigin({origin: `https://${'a'.repeat(400)}`})
    ).toHaveLength(255)
  })

  it('answers with a short body and prints one plain line', () => {
    expect(REFUSED_REQUEST_RESPONSE).toBe(
      'Extension.js dev server refused a request from another site.\n' +
        'Open this address directly in the browser to load it.\n'
    )

    const line = devServerOutsideRequestRefused('https://other.test')

    expect(line).toContain('A page outside this session (')
    expect(line).toContain('https://other.test')
    expect(line).toContain(
      ') made a request to the dev server and was refused.\n' +
        "Your extension's own pages still load. This line prints once per session."
    )

    expect(devServerOutsideRequestRefused('')).toContain(
      'A page outside this session made a request to the dev server'
    )
  })
})

// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {describe, expect, it} from 'vitest'
import {
  earlierAppexRows,
  parsePluginkitRows,
  parseSafariExtensionRegistry,
  staleSignedRows
} from '../run-safari/safari-launch/registry'

const PROJECT = '/Users/me/app/dist/safari-xcode'
const APPEX = (app: string) =>
  `${PROJECT}/.derived/Build/Products/Release/${app}.app/Contents/PlugIns/${app} Extension.appex`

// Two rows as pluginkit -m -v prints them on macOS 26, one elected (+).
const LISTING = [
  `     dev.extensionjs.Hands-free.Extension(1.0)\t357049B0-4365-43EF-B7CC-874A49D2CEC9\t2026-11-05 22:24:03 +0000\t${APPEX('Hands-free')}`,
  `+    com.cezaraugusto.visionario.Extension(1.0)\tF69274F5-1BA3-413B-BF58-04F72DBB180B\t2026-11-06 20:20:17 +0000\t${APPEX('Visionario')}`,
  `     com.other.Extension(2.3)\tB1E43AE8-6840-4134-9920-A44A79BD2571\t2026-11-04 20:58:02 +0000\t/Users/me/other/dist/safari-xcode/.derived/Build/Products/Release/Other.app/Contents/PlugIns/Other Extension.appex`
].join('\n')

describe('parsePluginkitRows', () => {
  it('reads the mark, id, version, date and path of each row', () => {
    const rows = parsePluginkitRows(LISTING)

    expect(rows.map((row) => row.id)).toEqual([
      'dev.extensionjs.Hands-free.Extension',
      'com.cezaraugusto.visionario.Extension',
      'com.other.Extension'
    ])

    expect(rows[1]).toMatchObject({
      mark: '+',
      version: '1.0',
      registeredAt: '2026-11-06 20:20:17 +0000',
      path: APPEX('Visionario')
    })

    expect(rows[0].mark).toBeNull()
    expect(rows[2].version).toBe('2.3')
  })

  it('reads the bare id-only rows of pluginkit -m without a path', () => {
    const rows = parsePluginkitRows('dev.extensionjs.MyExt.Extension\n\n')

    expect(rows).toEqual([
      {
        id: 'dev.extensionjs.MyExt.Extension',
        version: null,
        registeredAt: null,
        path: null,
        mark: null
      }
    ])
  })
})

describe('earlierAppexRows', () => {
  it('keeps the rows built from this project under another id', () => {
    const earlier = earlierAppexRows(
      parsePluginkitRows(LISTING),
      PROJECT,
      'com.cezaraugusto.visionario.Extension'
    )

    expect(earlier.map((row) => row.id)).toEqual([
      'dev.extensionjs.Hands-free.Extension'
    ])
  })

  it('ignores rows with no path and rows from other projects', () => {
    const rows = parsePluginkitRows(
      `dev.extensionjs.Bare.Extension\n${LISTING}`
    )

    expect(
      earlierAppexRows(rows, '/Users/me/app/dist/safari-xcode-other', 'x').map(
        (row) => row.id
      )
    ).toEqual([])
  })
})

describe('parseSafariExtensionRegistry', () => {
  const json = JSON.stringify({
    'com.cezaraugusto.visionario.Extension (JU3XAJJQ2G)': {Enabled: true},
    'com.cezaraugusto.visionario.Extension (UNSIGNED)': {Enabled: false},
    'com.other.Extension (UNSIGNED)': {Enabled: 1},
    NotARow: {Enabled: true}
  })

  it('reads the appex id, team and switch of each row', () => {
    expect(parseSafariExtensionRegistry(json)).toEqual([
      {
        appexId: 'com.cezaraugusto.visionario.Extension',
        team: 'JU3XAJJQ2G',
        enabled: true
      },
      {
        appexId: 'com.cezaraugusto.visionario.Extension',
        team: 'UNSIGNED',
        enabled: false
      },
      {appexId: 'com.other.Extension', team: 'UNSIGNED', enabled: true}
    ])
  })

  it('answers nothing for an unreadable or malformed registry', () => {
    expect(parseSafariExtensionRegistry('')).toEqual([])
    expect(parseSafariExtensionRegistry('not json')).toEqual([])
    expect(parseSafariExtensionRegistry('[1,2]')).toEqual([])
  })

  it('names the same id enabled under another signing identity', () => {
    const rows = parseSafariExtensionRegistry(json)

    expect(
      staleSignedRows(rows, 'com.cezaraugusto.visionario.Extension', 'UNSIGNED')
    ).toEqual([
      {
        appexId: 'com.cezaraugusto.visionario.Extension',
        team: 'JU3XAJJQ2G',
        enabled: true
      }
    ])

    expect(
      staleSignedRows(
        rows,
        'com.cezaraugusto.visionario.Extension',
        'JU3XAJJQ2G'
      )
    ).toEqual([])

    expect(staleSignedRows(rows, 'com.other.Extension', 'UNSIGNED')).toEqual([])
  })
})

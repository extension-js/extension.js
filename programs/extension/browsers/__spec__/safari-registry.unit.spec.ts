// ███████╗ █████╗ ███████╗ █████╗ ██████╗ ██╗
// ██╔════╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║
// ███████╗███████║█████╗  ███████║██████╔╝██║
// ╚════██║██╔══██║██╔══╝  ██╔══██║██╔══██╗██║
// ███████║██║  ██║██║     ██║  ██║██║  ██║██║
// ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {describe, expect, it} from 'vitest'
import {reRegisterDroppedRow} from '../run-safari/safari-launch'
import {
  earlierAppexRows,
  parsePluginkitRows,
  parseSafariExtensionRegistry,
  rowDroppedBySafari,
  staleSignedRows
} from '../run-safari/safari-launch/registry'
import {fakeSafariTools} from './safari-fake-tools'

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

// The shape plutil -convert xml1 prints for Safari 27's Extensions.plist.
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>dev.extensionjs.Probe.Extension (UNSIGNED)</key>
	<dict>
		<key>AccessibleOrigins</key>
		<array>
			<string>http://127.0.0.1/*</string>
		</array>
		<key>AddedDate</key>
		<date>2026-11-12T16:55:16Z</date>
		<key>Enabled</key>
		<true/>
		<key>GrantedPermissions</key>
		<dict>
			<key>Enabled</key>
			<date>4001-01-01T00:00:00Z</date>
		</dict>
		<key>RemovedDate</key>
		<date>2026-11-12T17:00:03Z</date>
		<key>RevokedPermissions</key>
		<dict/>
	</dict>
	<key>com.a&amp;b.Extension (JU3XAJJQ2G)</key>
	<dict>
		<key>Enabled</key>
		<false/>
	</dict>
	<key>NotARow</key>
	<dict>
		<key>Enabled</key>
		<true/>
	</dict>
</dict>
</plist>`

describe('the registry as plutil prints it', () => {
  it('reads rows from XML, dates and nested dictionaries included', () => {
    expect(parseSafariExtensionRegistry(XML)).toEqual([
      {
        appexId: 'dev.extensionjs.Probe.Extension',
        team: 'UNSIGNED',
        enabled: true,
        removed: true
      },
      {appexId: 'com.a&b.Extension', team: 'JU3XAJJQ2G', enabled: false}
    ])
  })

  it('marks a JSON row Safari dropped the same way', () => {
    const rows = parseSafariExtensionRegistry(
      JSON.stringify({
        'x.Extension (UNSIGNED)': {Enabled: true, RemovedDate: 1}
      })
    )

    expect(rows[0].removed).toBe(true)
  })

  it('calls a row dropped when Safari removed it or never saw it', () => {
    const rows = parseSafariExtensionRegistry(XML)

    expect(
      rowDroppedBySafari(rows, 'dev.extensionjs.Probe.Extension', 'UNSIGNED')
    ).toBe(true)

    expect(rowDroppedBySafari(rows, 'never.Extension', 'UNSIGNED')).toBe(true)
    expect(rowDroppedBySafari(rows, 'com.a&b.Extension', 'JU3XAJJQ2G')).toBe(
      false
    )
  })
})

describe('reRegisterDroppedRow', () => {
  const appex = '/tmp/Probe.app/Contents/PlugIns/Probe Extension.appex'

  it('registers the appex again while Safari does not list the row', async () => {
    const tools = fakeSafariTools({extensionRegistry: XML})

    await expect(
      reRegisterDroppedRow(tools, appex, 'dev.extensionjs.Probe.Extension')
    ).resolves.toBe(false)

    expect(tools.calls.pluginkitAdd).toEqual([appex])
  })

  it('registers it when the registry cannot be read', async () => {
    const tools = fakeSafariTools({extensionRegistry: ''})

    await expect(
      reRegisterDroppedRow(tools, appex, 'dev.extensionjs.Probe.Extension')
    ).resolves.toBe(false)

    expect(tools.calls.pluginkitAdd).toEqual([appex])
  })

  it('stops once Safari lists the row', async () => {
    const tools = fakeSafariTools({
      extensionRegistry: XML.replace(
        /\t\t<key>RemovedDate<\/key>\n\t\t<date>[^<]*<\/date>\n/,
        ''
      )
    })

    await expect(
      reRegisterDroppedRow(tools, appex, 'dev.extensionjs.Probe.Extension')
    ).resolves.toBe(true)

    expect(tools.calls.pluginkitAdd).toEqual([])
  })
})

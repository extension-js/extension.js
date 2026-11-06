import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {resolveLocalizedManifestName} from '../localized-manifest-name'
import {card, MAX_CARD_ROWS} from '../messaging'

// The card is a glance, not output to read. These are the invariants that keep
// it one: a fixed ceiling on rows, and a head that borrows no color from the
// brand so the user's own palette carries it.
describe('card shape', () => {
  const rows = [
    {label: 'Browser', value: 'Chromium 146.0.7670.0'},
    {label: 'Extension', value: 'my-extension 1.0.0'},
    {label: 'Profile', value: '~/my-extension/dist/extension-profile-chromium'},
    {label: 'Extension ID', value: 'homdjffbninahljjngkeelaniofgnela'},
    {label: 'Run ID', value: 'moderate-brown-dragon'}
  ]

  it('caps the body at MAX_CARD_ROWS, keeping the first rows given', () => {
    expect(MAX_CARD_ROWS).toBe(3)
    const body = card({version: '4.0.35', rows}).split('\n').slice(1)
    expect(body).toHaveLength(MAX_CARD_ROWS)
    expect(body[0]).toContain('Browser')
    expect(body[1]).toContain('Extension ')
    expect(body[2]).toContain('Profile')
    expect(card({rows})).not.toContain('Run ID')
  })

  it('counts only rows that carry a value, so an empty row cannot take a slot', () => {
    const withHole = [
      rows[0],
      {label: 'Binary', value: ''},
      rows[1],
      rows[2],
      rows[3]
    ]
    const body = card({rows: withHole}).split('\n').slice(1)
    expect(body).toHaveLength(MAX_CARD_ROWS)
    expect(body.some((line) => line.includes('Binary'))).toBe(false)
    expect(body[2]).toContain('Profile')
  })

  it('names a localized extension by its default_locale value, not the key', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'card-shape-locale-'))

    try {
      fs.mkdirSync(path.join(root, '_locales', 'en'), {recursive: true})
      fs.writeFileSync(
        path.join(root, '_locales', 'en', 'messages.json'),
        JSON.stringify({extName: {message: 'Lance'}})
      )

      const name = resolveLocalizedManifestName(
        {name: '__MSG_extName__', default_locale: 'en'},
        [root]
      )
      const body = card({
        version: '4.1.39',
        rows: [rows[0], {label: 'Extension', value: `${name} 0.1.0`}, rows[2]]
      })
        .split('\n')
        .slice(1)
      expect(body[1]).toContain('Extension      Lance 0.1.0')
      expect(body[1]).not.toContain('__MSG_')
    } finally {
      fs.rmSync(root, {recursive: true, force: true})
    }
  })

  it('prints the product name in the default terminal color', () => {
    const head = card({version: '4.0.35', rows}).split('\n')[0]
    expect(head).toContain('Extension.js')
    // No SGR sequence may open before the name.
    const beforeName = head.slice(0, head.indexOf('Extension.js'))
    expect(/\[[0-9;]*m/.test(beforeName)).toBe(false)
  })

  // Color itself is not asserted: the colors library no-ops off a TTY, so a
  // spec that demanded an SGR code here would only be testing the test runner.
  // What must hold either way is the head's shape and order.
  it('keeps the head to the emoji, then the name, then the version', () => {
    const head = card({version: '4.0.35', rows}).split('\n')[0]
    expect(head).toContain('Extension.js')
    expect(head.indexOf('Extension.js')).toBeLessThan(head.indexOf('4.0.35'))
    expect(head.trimStart().startsWith('\u{1F9E9}')).toBe(true)
  })
})

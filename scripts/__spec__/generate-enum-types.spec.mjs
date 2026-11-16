import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {enumObjectsData} from '../capture-enum-objects.mjs'
import {chromeTypesFile, comparable} from '../generate-callback-types.mjs'
import {
  capturedEnumObjects,
  enumKey,
  enumObjects,
  OUTPUT_FILE,
  parseStringUnions,
  renderEnumTypes
} from '../generate-enum-types.mjs'

// The shapes chrome-types writes: a union of string literals per enum, with
// the values in a comment above it, and the same names again under chrome.
const source = `
declare namespace browser {
  export namespace runtime {
    /**
     * @chrome-enum "install" Not a "value" = "of"; the type.
     */
    export type OnInstalledReason = "install" | "update" | "chrome_update";
    export type PlatformArch = "arm" | "x86-32" | "x86-64";
    export type Mixed = "one" | number;
    export type Named = OnInstalledReason;
    export interface Port { name: string; }
  }

  export namespace _debugger {
    export type DetachReason = "target_closed" | "canceled_by_user";
  }

  export namespace devtools.panels {
    export type Theme = "default" | "dark";
  }

  export namespace downloads {
    export type DangerType =
      | "file"
      | "allowlistedByPolicy";
  }
}

declare namespace chrome {
  export namespace runtime {
    export import OnInstalledReason = browser.runtime.OnInstalledReason;
  }
}
`

test('names a key the way Chrome does', () => {
  assert.equal(enumKey('install'), 'INSTALL')
  assert.equal(enumKey('chrome_update'), 'CHROME_UPDATE')
  assert.equal(enumKey('per-origin'), 'PER_ORIGIN')
  assert.equal(enumKey('x86-64'), 'X86_64')
  assert.equal(enumKey('allowlistedByPolicy'), 'ALLOWLISTED_BY_POLICY')
  assert.equal(enumKey('favIconUrl'), 'FAV_ICON_URL')
  assert.equal(enumKey('DOM_PARSER'), 'DOM_PARSER')
  assert.equal(enumKey('main_frame'), 'MAIN_FRAME')
  assert.equal(enumKey('3d'), '_3D')
  assert.equal(enumKey(''), '')
})

test('the rule gives every key the live browser returned', () => {
  const {objects} = capturedEnumObjects()
  const entries = Object.entries(objects).flatMap(([name, object]) =>
    Object.entries(object).map(([key, value]) => ({name, key, value}))
  )

  assert.deepEqual(
    entries.filter(({key, value}) => enumKey(value) !== key),
    []
  )

  // The capture has to hold the hard cases for the check above to mean much.
  assert.ok(entries.length >= 600, `${entries.length} entries`)
  assert.ok(entries.filter(({value}) => /[a-z][A-Z]/.test(value)).length >= 50)
  assert.ok(entries.filter(({value}) => value.includes('-')).length >= 5)
  assert.ok(entries.filter(({value}) => value.includes('_')).length >= 50)
})

test('reads the unions of string literals alone, with their namespace', () => {
  const unions = parseStringUnions(source)

  assert.deepEqual(Array.from(unions.keys()), [
    'browser.runtime.OnInstalledReason',
    'browser.runtime.PlatformArch',
    'browser._debugger.DetachReason',
    'browser.devtools.panels.Theme',
    'browser.downloads.DangerType'
  ])

  assert.deepEqual(unions.get('browser.runtime.OnInstalledReason'), [
    'install',
    'update',
    'chrome_update'
  ])

  assert.deepEqual(unions.get('browser.downloads.DangerType'), [
    'file',
    'allowlistedByPolicy'
  ])
})

test('types an object only where the browser was seen to have one', () => {
  const captured = {
    browser: 'Chrome 1',
    objects: {
      'runtime.OnInstalledReason': {INSTALL: 'install', OLD: 'old'},
      'debugger.DetachReason': {TARGET_CLOSED: 'target_closed'},
      'downloads.DangerType': {FILE: 'file'},
      'clipboard.ImageType': {PNG: 'png'}
    }
  }
  const objects = enumObjects(source, captured)

  // PlatformArch and devtools.panels.Theme are unions the capture lacks,
  // and clipboard.ImageType is an object chrome-types has no union for.
  assert.deepEqual(Array.from(objects.keys()), [
    'browser.runtime',
    'browser._debugger',
    'browser.downloads'
  ])

  // The values are the ones chrome-types declares, not the captured ones.
  assert.deepEqual(objects.get('browser.runtime'), [
    {
      name: 'OnInstalledReason',
      entries: [
        ['INSTALL', 'install'],
        ['UPDATE', 'update'],
        ['CHROME_UPDATE', 'chrome_update']
      ]
    }
  ])

  const rendered = renderEnumTypes(source, captured)

  assert.ok(
    comparable(rendered).includes(
      comparable(`declare namespace browser.downloads {
  export const DangerType: {
    readonly FILE: 'file'
    readonly ALLOWLISTED_BY_POLICY: 'allowlistedByPolicy'
  }
}`)
    )
  )

  assert.ok(!rendered.includes('declare namespace chrome'))
  assert.ok(!rendered.includes('PlatformArch'))
})

test('writes the capture in a stable order', () => {
  const data = enumObjectsData({
    userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36',
    objects: {'tabs.B': {Z: 'z', A: 'a'}, 'alarms.A': {ONE: 'one'}}
  })

  assert.equal(
    JSON.stringify(data),
    '{"browser":"Chrome 151","objects":{"alarms.A":{"ONE":"one"},"tabs.B":{"A":"a","Z":"z"}}}'
  )
})

test('the published enums.d.ts matches the installed chrome-types', () => {
  const rendered = renderEnumTypes(
    fs.readFileSync(chromeTypesFile(), 'utf8'),
    capturedEnumObjects()
  )
  const published = fs.readFileSync(OUTPUT_FILE, 'utf8')

  assert.equal(
    comparable(published),
    comparable(rendered),
    'programs/extension/types/enums.d.ts is behind chrome-types. Run node scripts/generate-enum-types.mjs'
  )

  // A parser that stops reading the file would still match an empty output.
  const objects = published.match(/export const /g) || []

  assert.ok(objects.length >= 100, `${objects.length} objects`)
  assert.ok(published.includes("readonly INSTALL: 'install'"))
  assert.ok(published.includes("readonly DOM_PARSER: 'DOM_PARSER'"))
  assert.ok(published.includes("readonly ANY: 'ANY'"))
})

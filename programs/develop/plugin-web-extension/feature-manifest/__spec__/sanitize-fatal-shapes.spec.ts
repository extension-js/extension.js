import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import type {Manifest} from '../../../types'
import {sanitizeFatalManifestShapes} from '../manifest-lib/sanitize-fatal-shapes'

describe('sanitizeFatalManifestShapes', () => {
  it('coerces a numeric version to a string', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'x',
      version: 1
    } as unknown as Manifest)
    expect(manifest.version).toBe('1')
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('version')
  })

  it('repairs a missing, empty, or non-string name (fixtures 01/02/26, Chrome 150)', () => {
    const missing = sanitizeFatalManifestShapes({
      manifest_version: 3,
      version: '1.0'
    } as unknown as Manifest)
    expect(missing.manifest.name).toBe('Unnamed Extension')
    expect(missing.fixes.map((f) => f.field)).toEqual(['name'])

    const empty = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: '',
      version: '1.0'
    } as unknown as Manifest)
    expect(empty.manifest.name).toBe('Unnamed Extension')

    // scalars keep their intent, like the numeric-version coercion
    const numeric = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 42,
      version: '1.0'
    } as unknown as Manifest)
    expect(numeric.manifest.name).toBe('42')
  })

  it('injects "0.0.0" when the required version key is missing (wild: Ananyakk71/javscript)', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'x'
    } as unknown as Manifest)
    expect(manifest.version).toBe('0.0.0')
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('version')
  })

  it("strips 'unsafe-inline' from extension_pages script-src (wild: zenwerk/tonikakuyare)", () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'x',
      version: '1.0',
      content_security_policy: {
        extension_pages: "script-src 'self' 'unsafe-inline'; object-src 'self'"
      }
    } as unknown as Manifest)
    expect((manifest as any).content_security_policy.extension_pages).toBe(
      "script-src 'self'; object-src 'self'"
    )
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('content_security_policy.extension_pages')
  })

  it("falls back to 'self' when 'unsafe-inline' was the only script-src source", () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'x',
      version: '1.0',
      content_security_policy: {
        extension_pages: "script-src 'unsafe-inline'"
      }
    } as unknown as Manifest)
    expect((manifest as any).content_security_policy.extension_pages).toBe(
      "script-src 'self'"
    )
    expect(fixes).toHaveLength(1)
  })

  it("leaves CSPs without script-src 'unsafe-inline' byte-identical", () => {
    for (const extension_pages of [
      "script-src 'self'; object-src 'self'",
      // 'unsafe-inline' is legal in style-src, only script-src is refused
      "script-src 'self'; style-src 'unsafe-inline'"
    ]) {
      const {manifest, fixes} = sanitizeFatalManifestShapes({
        manifest_version: 3,
        name: 'x',
        version: '1.0',
        content_security_policy: {extension_pages}
      } as unknown as Manifest)
      expect(
        (manifest as any).content_security_policy.extension_pages,
        extension_pages
      ).toBe(extension_pages)
      expect(fixes, extension_pages).toHaveLength(0)
    }
  })

  it('removes an empty-string default_icon from action', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'x',
      version: '1.0',
      action: {default_popup: 'index.html', default_icon: ''}
    } as unknown as Manifest)
    expect((manifest as any).action.default_icon).toBeUndefined()
    expect((manifest as any).action.default_popup).toBe('index.html')
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('action.default_icon')
  })

  it('removes an empty-object default_icon from browser_action (MV2)', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 2,
      name: 'x',
      version: '1.0',
      browser_action: {default_icon: {}}
    } as unknown as Manifest)
    expect((manifest as any).browser_action.default_icon).toBeUndefined()
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('browser_action.default_icon')
  })

  it('keeps a valid default_icon and string version untouched', () => {
    const input = {
      manifest_version: 3,
      name: 'x',
      version: '2.3.4',
      action: {default_icon: {'16': 'icon16.png'}}
    } as unknown as Manifest
    const {manifest, fixes} = sanitizeFatalManifestShapes(input)
    expect(fixes).toHaveLength(0)
    expect(manifest.version).toBe('2.3.4')
    expect((manifest as any).action.default_icon).toEqual({'16': 'icon16.png'})
  })

  it('repairs a non-numeric version string Chrome refuses (wild: MelonTranslate "x.y.z")', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'MelonTranslate',
      version: 'x.y.z'
    } as unknown as Manifest)
    expect(manifest.version).toBe('0.0.0')
    expect(fixes).toHaveLength(1)
    expect(fixes[0].field).toBe('version')
  })

  it('salvages the numeric parts of an almost-valid version', () => {
    for (const [from, to] of [
      ['1.0-beta', '1.0'],
      ['v2.3', '2.3'],
      ['1.2.3.4.5', '1.2.3.4'],
      ['99999', '65535']
    ]) {
      const {manifest, fixes} = sanitizeFatalManifestShapes({
        manifest_version: 3,
        name: 'x',
        version: from
      } as unknown as Manifest)
      expect(manifest.version, `${from} -> ${to}`).toBe(to)
      expect(fixes).toHaveLength(1)
    }
  })

  it('keeps valid edge-case versions untouched', () => {
    for (const version of ['0', '0.0.0', '65535.65535.65535.65535', '1']) {
      const {fixes} = sanitizeFatalManifestShapes({
        manifest_version: 3,
        name: 'x',
        version
      } as unknown as Manifest)
      expect(fixes, version).toHaveLength(0)
    }
  })

  it('fixes both shapes in one pass (wild subject shape)', () => {
    const {manifest, fixes} = sanitizeFatalManifestShapes({
      manifest_version: 3,
      name: 'Leads tracker',
      version: 1,
      action: {default_popup: 'index.html', default_icon: ''}
    } as unknown as Manifest)
    expect(manifest.version).toBe('1')
    expect((manifest as any).action.default_icon).toBeUndefined()
    expect(fixes).toHaveLength(2)
  })

  describe('0-byte icon files (wild: Speak2Type)', () => {
    let dir: string

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-icons-'))
      fs.mkdirSync(path.join(dir, 'icons'), {recursive: true})
      fs.writeFileSync(path.join(dir, 'icons/empty.png'), '')
      fs.writeFileSync(path.join(dir, 'icons/real.png'), 'png-bytes')
    })

    afterEach(() => {
      fs.rmSync(dir, {recursive: true, force: true})
    })

    it('drops icons entries whose file is empty; removes icons when none survive', () => {
      const {manifest, fixes} = sanitizeFatalManifestShapes(
        {
          manifest_version: 3,
          name: 'x',
          version: '1.0.0',
          icons: {'16': 'icons/empty.png', '128': 'icons/empty.png'}
        } as unknown as Manifest,
        dir
      )
      expect((manifest as any).icons).toBeUndefined()
      expect(fixes.map((f) => f.field)).toEqual(['icons.16', 'icons.128'])
    })

    it('keeps non-empty and missing icon files untouched', () => {
      const {manifest, fixes} = sanitizeFatalManifestShapes(
        {
          manifest_version: 3,
          name: 'x',
          version: '1.0.0',
          icons: {
            '16': 'icons/real.png',
            '48': 'icons/does-not-exist.png',
            '128': 'icons/empty.png'
          }
        } as unknown as Manifest,
        dir
      )
      expect((manifest as any).icons).toEqual({
        '16': 'icons/real.png',
        '48': 'icons/does-not-exist.png'
      })
      expect(fixes.map((f) => f.field)).toEqual(['icons.128'])
    })

    it('drops an empty-file default_icon, string and per-size forms', () => {
      const {manifest, fixes} = sanitizeFatalManifestShapes(
        {
          manifest_version: 3,
          name: 'x',
          version: '1.0.0',
          action: {
            default_popup: 'index.html',
            default_icon: {'16': 'icons/empty.png', '32': 'icons/real.png'}
          },
          browser_action: {default_icon: '/icons/empty.png'}
        } as unknown as Manifest,
        dir
      )
      expect((manifest as any).action.default_icon).toEqual({
        '32': 'icons/real.png'
      })
      expect((manifest as any).browser_action.default_icon).toBeUndefined()
      expect(fixes.map((f) => f.field)).toEqual([
        'action.default_icon.16',
        'browser_action.default_icon'
      ])
    })

    it('does not touch icon entries when no manifestDir is given', () => {
      const {manifest, fixes} = sanitizeFatalManifestShapes({
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        icons: {'128': 'icons/empty.png'}
      } as unknown as Manifest)
      expect((manifest as any).icons).toEqual({'128': 'icons/empty.png'})
      expect(fixes).toHaveLength(0)
    })
  })

  describe('named commands without a description (Chrome: "Invalid value for commands[N].description")', () => {
    it('backfills missing, empty, and non-string descriptions with the command name', () => {
      const {manifest, fixes} = sanitizeFatalManifestShapes({
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        commands: {
          'toggle-feature': {suggested_key: {default: 'Ctrl+Shift+Y'}},
          annotate: {description: '', suggested_key: {default: 'Ctrl+Shift+U'}},
          highlight: {description: 42}
        }
      } as unknown as Manifest)
      const commands = (manifest as any).commands
      expect(commands['toggle-feature'].description).toBe('toggle-feature')
      expect(commands.annotate.description).toBe('annotate')
      expect(commands.highlight.description).toBe('highlight')
      expect(fixes.map((f) => f.field)).toEqual([
        'commands.toggle-feature.description',
        'commands.annotate.description',
        'commands.highlight.description'
      ])
    })

    it('leaves _execute_* commands and valid descriptions untouched', () => {
      const {manifest, fixes} = sanitizeFatalManifestShapes({
        manifest_version: 3,
        name: 'x',
        version: '1.0.0',
        commands: {
          _execute_action: {suggested_key: {default: 'Ctrl+Shift+E'}},
          annotate: {
            description: 'Annotate the page',
            suggested_key: {default: 'Ctrl+Shift+U'}
          }
        }
      } as unknown as Manifest)
      const commands = (manifest as any).commands
      expect(commands._execute_action.description).toBeUndefined()
      expect(commands.annotate.description).toBe('Annotate the page')
      expect(fixes).toHaveLength(0)
    })
  })
})

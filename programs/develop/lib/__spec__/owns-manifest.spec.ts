import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {ownsManifest} from '../project'

describe('ownsManifest', () => {
  let root = ''

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-owns-manifest-'))
  })

  afterEach(() => {
    fs.rmSync(root, {recursive: true, force: true})
  })

  function write(relative: string, body: string): string {
    const target = path.join(root, relative)
    fs.mkdirSync(path.dirname(target), {recursive: true})
    fs.writeFileSync(target, body)

    return target
  }

  it('owns a manifest sitting beside it', () => {
    const projectManifest = write('package.json', '{"name":"a"}')
    const manifest = write('manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(true)
  })

  it('owns the documented src layout', () => {
    const projectManifest = write('package.json', '{"name":"a"}')
    const manifest = write('src/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(true)
  })

  it('does not own a bare manifest in some other folder', () => {
    const projectManifest = write('package.json', '{"name":"a"}')
    const manifest = write('inner/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(false)
  })

  // A src folder deeper than one level is not the documented layout, so it
  // gets the same treatment as any other nested folder.
  it('does not own a src folder further down', () => {
    const projectManifest = write('package.json', '{"name":"a"}')
    const manifest = write('nested/src/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(false)
  })

  it.each([
    ['dependencies', '{"dependencies":{"extension":"^4.1.30"}}'],
    ['devDependencies', '{"devDependencies":{"extension":"^4.1.30"}}'],
    ['extension-develop', '{"devDependencies":{"extension-develop":"1.0.0"}}'],
    ['extension-create', '{"dependencies":{"extension-create":"1.0.0"}}']
  ])('owns it when the project declares Extension.js in %s', (_label, body) => {
    const projectManifest = write('package.json', body)
    const manifest = write('inner/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(true)
  })

  it.each([
    'extension.config.js',
    'extension.config.mjs',
    'extension.config.cjs'
  ])('owns it when %s sits beside the project manifest', (filename) => {
    const projectManifest = write('package.json', '{"name":"a"}')
    write(filename, 'module.exports = {}')
    const manifest = write('inner/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(true)
  })

  it('owns it when a deno.json imports Extension.js from npm', () => {
    const projectManifest = write(
      'deno.json',
      '{"imports":{"extension":"npm:extension@4.1.30"}}'
    )

    const manifest = write('inner/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(true)
  })

  it('does not own it when a deno.json imports something else', () => {
    const projectManifest = write(
      'deno.json',
      '{"imports":{"lodash":"npm:lodash@4"}}'
    )

    const manifest = write('inner/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(false)
  })

  it('does not own it when the project manifest is unreadable', () => {
    const projectManifest = write('package.json', 'not json at all')
    const manifest = write('inner/manifest.json', '{}')

    expect(ownsManifest(projectManifest, manifest)).toBe(false)
  })
})

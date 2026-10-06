import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {ConfigHookContext, FileConfig} from '../config-types'

const pkgRoot = path.resolve(__dirname, '..')
const pkg = JSON.parse(
  fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
)

describe('public config types (extension package)', () => {
  it('the root types entry exists and is consistent across fields', () => {
    const rootTypes = pkg.exports['.'].types
    expect(rootTypes).toBe(pkg.types)
    expect(fs.existsSync(path.join(pkgRoot, rootTypes))).toBe(true)
  })

  it('the root declaration re-exports FileConfig with an explicit extension', () => {
    const rootTypes = pkg.exports['.'].types
    const dts = fs.readFileSync(path.join(pkgRoot, rootTypes), 'utf8')

    expect(dts).toContain('FileConfig')
    expect(dts).toMatch(/from\s+['"]\.\/config-types\.js['"]/)
  })

  it('the re-export target declares FileConfig', () => {
    const rootTypes = pkg.exports['.'].types
    const targetDts = path
      .join(pkgRoot, path.dirname(rootTypes), 'config-types.js')
      .replace(/\.js$/, '.d.ts')

    expect(fs.existsSync(targetDts)).toBe(true)
    expect(fs.readFileSync(targetDts, 'utf8')).toMatch(
      /export\s+(interface|type)\s+FileConfig\b/
    )
  })

  it('the source module exports FileConfig from config-types', () => {
    const configTypes = fs.readFileSync(
      path.join(pkgRoot, 'config-types.ts'),
      'utf8'
    )
    expect(configTypes).toMatch(/export\s+interface\s+FileConfig\b/)
  })

  // The published type is hand-kept, so an option the loader honors but the
  // type omits fails tsc on a working config. This compares the two sources.
  it('declares every top-level key the internal FileConfig declares', () => {
    const publicSource = fs.readFileSync(
      path.join(pkgRoot, 'config-types.ts'),
      'utf8'
    )
    const internalSource = fs.readFileSync(
      path.resolve(pkgRoot, '..', 'develop', 'types.ts'),
      'utf8'
    )

    const topLevelKeys = (source: string): string[] => {
      const start = source.indexOf('export interface FileConfig {')
      expect(start).toBeGreaterThan(-1)

      const body = source.slice(start)
      const end = body.indexOf('\n}')
      const keys = new Set<string>()

      for (const line of body.slice(0, end).split('\n')) {
        const match = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\??:/.exec(line)
        if (match) keys.add(match[1])
      }

      return Array.from(keys).sort()
    }

    const internalKeys = topLevelKeys(internalSource)
    const publicKeys = topLevelKeys(publicSource)

    expect(internalKeys.length).toBeGreaterThan(5)
    expect(publicKeys).toEqual(internalKeys)
  })

  it('accepts config and configResolved hooks that read the second argument', () => {
    const seen: ConfigHookContext[] = []
    const config: FileConfig = {
      config: (bundler, context) => {
        seen.push(context)

        return context.browser === 'edge' ? bundler : bundler
      },
      configResolved: (bundler, context) => {
        seen.push({
          browser: context.browser,
          mode: context.mode,
          command: context.command
        })

        return bundler
      }
    }
    const legacy: FileConfig = {
      config: (bundler) => bundler,
      configResolved: (bundler) => bundler
    }
    const context: ConfigHookContext = {
      browser: 'edge',
      mode: 'production',
      command: 'build'
    }

    config.config?.({}, context)
    config.configResolved?.({}, context)
    legacy.config?.({}, context)
    expect(seen).toEqual([context, context])

    const dts = fs.readFileSync(
      path.join(pkgRoot, path.dirname(pkg.types), 'config-types.d.ts'),
      'utf8'
    )
    expect(dts).toMatch(/export interface ConfigHookContext \{/)
    expect(dts).toMatch(
      /config\?: \(config: any, context: ConfigHookContext\) => any;/
    )

    expect(dts).toMatch(
      /configResolved\?: \(config: any, context: ConfigHookContext\) => any;/
    )

    const rootDts = fs.readFileSync(path.join(pkgRoot, pkg.types), 'utf8')
    expect(rootDts).toContain('ConfigHookContext')
  })

  // The typecheck gate compiles this fixture, so it stops building the day a
  // command loses a key the loader reads. The emitted declaration is what a
  // project annotating its config with the package type gets.
  it('accepts folders under every command, in the same shape as the top level', () => {
    const config: FileConfig = {
      folders: {scripts: 'src/scripts'},
      commands: {
        dev: {folders: {scripts: false}},
        start: {folders: {pages: 'src/pages'}},
        preview: {folders: {public: false}},
        build: {folders: {scripts: false, pages: false, public: 'static'}}
      }
    }
    expect(Object.keys(config.commands || {})).toHaveLength(4)

    const dts = fs.readFileSync(
      path.join(pkgRoot, path.dirname(pkg.types), 'config-types.d.ts'),
      'utf8'
    )

    for (const name of [
      'DevCommandConfig',
      'ServeCommandConfig',
      'BuildCommandConfig'
    ]) {
      const start = dts.indexOf(`interface ${name} `)
      expect(start).toBeGreaterThan(-1)

      const body = dts.slice(start, dts.indexOf('\n}', start))
      expect(body).toMatch(/\n\s+folders\?: SpecialFoldersConfig;/)
    }
  })

  it('declares every BrowserType member the internal union declares', () => {
    const publicSource = fs
      .readFileSync(path.join(pkgRoot, 'config-types.ts'), 'utf8')
      .replace(/\r\n/g, '\n')
    const internalSource = fs
      .readFileSync(path.resolve(pkgRoot, '..', 'develop', 'types.ts'), 'utf8')
      .replace(/\r\n/g, '\n')

    const unionMembers = (source: string): string[] => {
      const start = source.indexOf('export type BrowserType =')
      expect(start).toBeGreaterThan(-1)

      const body = source.slice(start)
      const end = body.indexOf('\n\n')
      const members: string[] = []

      for (const line of body.slice(0, end).split('\n')) {
        const match = /^\s+\| '([a-z-]+)'$/.exec(line)
        if (match) members.push(match[1])
      }

      return members.sort()
    }

    const internalMembers = unionMembers(internalSource)
    const publicMembers = unionMembers(publicSource)

    expect(internalMembers).toContain('chromium-emulator')
    expect(publicMembers).toEqual(internalMembers)
  })
})

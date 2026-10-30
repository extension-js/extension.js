import {readFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {getBuildToolchain} from '../lib/build-toolchain'
import * as messages from '../lib/messages'
import packageJson from '../package.json'

const EXTENSION_JS = packageJson.version

const HERE = dirname(fileURLToPath(import.meta.url))

function stripAnsi(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/\u001b\[[0-9;]*m/g, '')
}

describe('build toolchain line', () => {
  it('reads the package manager and its version off the script user agent', () => {
    expect(
      getBuildToolchain(
        {
          npm_config_user_agent:
            'npm/12.0.2 node/v24.18.1 darwin arm64 workspaces/false'
        },
        'v24.18.1'
      )
    ).toEqual({
      node: 'v24.18.1',
      extension_js: EXTENSION_JS,
      package_manager: {name: 'npm', version: '12.0.2'}
    })

    expect(
      getBuildToolchain(
        {
          npm_config_user_agent: 'pnpm/10.28.0 npm/? node/v22.23.1 darwin arm64'
        },
        'v22.23.1'
      ).package_manager
    ).toEqual({name: 'pnpm', version: '10.28.0'})

    expect(
      getBuildToolchain(
        {npm_config_user_agent: 'yarn/1.22.22 npm/? node/v22.23.1 linux x64'},
        'v22.23.1'
      ).package_manager
    ).toEqual({name: 'yarn', version: '1.22.22'})
  })

  it('records Node alone when no package manager script started the build', () => {
    const nodeAlone = {node: 'v22.23.1', extension_js: EXTENSION_JS}
    expect(getBuildToolchain({}, 'v22.23.1')).toEqual(nodeAlone)
    expect(
      getBuildToolchain({npm_config_user_agent: '   '}, 'v22.23.1')
    ).toEqual(nodeAlone)

    expect(
      getBuildToolchain({npm_config_user_agent: 'bun/? node/v22'}, 'v22.23.1')
    ).toEqual(nodeAlone)
  })

  it('reads the versions off the process by default', () => {
    expect(getBuildToolchain().node).toBe(process.version)
    expect(getBuildToolchain().extension_js).toBe(EXTENSION_JS)
  })

  it('prints every version on one line and says what to do with them', () => {
    const line = stripAnsi(
      messages.buildToolchain({
        node: 'v22.23.1',
        extension_js: '4.1.36',
        package_manager: {name: 'npm', version: '10.9.8'}
      })
    )

    expect(line).toContain(
      'Built with Node v22.23.1, npm 10.9.8 and Extension.js 4.1.36.'
    )

    expect(line).not.toContain('\n')
    // The sentence names what the reader copies and where it goes, so no
    // pronoun is left pointing at nothing.
    expect(line).toContain("Name these versions in the store's reviewer note")
    expect(line).not.toMatch(/\bthem\b/)
  })

  it('prints Node and Extension.js when the package manager is unknown', () => {
    const line = stripAnsi(
      messages.buildToolchain({node: 'v22.23.1', extension_js: '4.1.36'})
    )

    expect(line).toContain('Built with Node v22.23.1 and Extension.js 4.1.36.')
    expect(line).not.toContain('undefined')
  })

  it('is printed on every production build and recorded in the summary', () => {
    const source = readFileSync(resolve(HERE, '../command-build.ts'), 'utf8')

    expect(source).toContain('toolchain: getBuildToolchain()')
    expect(source).toContain(
      "if (resolvedMode === 'production' && summary.toolchain) {"
    )

    expect(source).toContain(
      'humanLine(messages.buildToolchain(summary.toolchain))'
    )
  })
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const packageRoot = path.resolve(__dirname, '..')

// The string members of `type <name> =` in a TypeScript source, in order.
function unionMembers(file: string, name: string): string[] {
  const source = fs.readFileSync(file, 'utf8')
  const match = source.match(
    new RegExp(`type ${name} =\\s*((?:\\s*\\|\\s*'[^']+')+)`)
  )
  expect(match, `${name} in ${file}`).not.toBeNull()

  return [...String(match?.[1]).matchAll(/'([^']+)'/g)].map((m) => m[1])
}

describe('the published ExtensionBrowser type', () => {
  it('lists every target the CLI accepts for --browser, in the same order', () => {
    const published = unionMembers(
      path.join(packageRoot, 'types', 'index.d.ts'),
      'ExtensionBrowser'
    )
    const launcher = unionMembers(
      path.join(packageRoot, 'browsers', 'browsers-types.ts'),
      'BrowserType'
    )
    const config = unionMembers(
      path.join(packageRoot, 'config-types.ts'),
      'BrowserType'
    )

    expect(published).toContain('safari')
    expect(published).toContain('firefox')
    expect(published).toEqual(launcher)
    expect(published).toEqual(config)
  })
})

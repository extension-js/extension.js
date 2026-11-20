import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

const pkgRoot = path.resolve(__dirname, '..')

// Every file of this package that is not a spec, a build config or output.
function productionSources(dir: string): string[] {
  const found: string[] = []

  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const file = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (['node_modules', 'dist', '__spec__'].includes(entry.name)) continue

      found.push(...productionSources(file))
    } else if (
      /\.(c|m)?(j|t)sx?$/.test(entry.name) &&
      !/\.spec\./.test(entry.name) &&
      !/\.config\.(c|m)?(j|t)s$/.test(entry.name)
    ) {
      found.push(file)
    }
  }

  return found
}

// Listed on purpose although no production file names them, each with why.
const KEPT_UNNAMED: Record<string, string> = {}

// A listed dependency that no production file names is installed for nothing.
describe('the CLI dependencies', () => {
  it('are each named by a production file or kept on purpose', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')
    ) as {dependencies: Record<string, string>}
    const sources = productionSources(pkgRoot).map((file) =>
      fs.readFileSync(file, 'utf8')
    )
    const unnamed = Object.keys(pkg.dependencies)
      // Type packages are read by the compiler, never by a specifier.
      .filter((name) => !name.startsWith('@types/'))
      .filter((name) => !(name in KEPT_UNNAMED))
      .filter((name) => {
        const specifier = new RegExp(
          `['"]${name.replace(/[/.]/g, '\\$&')}(/[^'"]*)?['"]`
        )

        return !sources.some((text) => specifier.test(text))
      })

    expect(unnamed).toEqual([])
    // A kept name that leaves package.json leaves this list too.
    expect(
      Object.keys(KEPT_UNNAMED).filter((name) => !(name in pkg.dependencies))
    ).toEqual([])
  })
})

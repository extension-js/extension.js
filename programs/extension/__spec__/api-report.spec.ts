import * as path from 'node:path'
import {beforeAll, describe, expect, it} from 'vitest'
import {
  publishedEntries,
  signatureReports
} from '../../../scripts/lib/api-signatures.mjs'

const packageDir = path.resolve(__dirname, '..')

// A caller compiles against these declarations. A parameter, a return type
// or a field that changes is a line of this diff.
describe('the signatures of the CLI package, entry by entry', () => {
  const entries = publishedEntries(packageDir).map((entry) => entry.subpath)
  let reports: Record<string, string> = {}

  // The declarations are emitted from source once for every entry.
  beforeAll(() => {
    reports = signatureReports(packageDir)
  }, 120_000)

  it('reads at least one typed entry from the exports map', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('pins what %s declares', (entry) => {
    expect(reports[entry].length).toBeGreaterThan(0)
    expect(reports[entry]).toMatchSnapshot(entry)
  })
})

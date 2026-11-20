import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  BUDGET_CATEGORIES,
  type BudgetCategory
} from '../../develop/plugin-perf-budgets/categorize'
import type {PerfBudgetCategory} from '../config-types'

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false

// The public type is a hand-written mirror of the categories that take a
// budget. This line is the type half: the typecheck gate fails on it.
const publicMatchesPlugin: Equals<PerfBudgetCategory, BudgetCategory> = true

void publicMatchesPlugin

const configTypesPath = path.resolve(__dirname, '..', 'config-types.ts')

// A Windows checkout carries CRLF endings, so normalize before matching or
// the blank line that closes the union is never found.
function categoriesFromSource(text: string): string[] {
  const source = text.replace(/\r\n/g, '\n')
  const union = source.match(
    /export\s+type\s+PerfBudgetCategory\s*=([\s\S]*?)\n\n/
  )?.[1]

  expect(union).toBeTruthy()

  return Array.from(String(union).matchAll(/'([^']+)'/g), (m) => m[1])
}

function publicCategoriesFromFile(filePath = configTypesPath): string[] {
  return categoriesFromSource(fs.readFileSync(filePath, 'utf8'))
}

describe('perf budget categories', () => {
  it('the public PerfBudgetCategory union lists exactly the categories that take a budget', () => {
    expect(publicCategoriesFromFile()).toEqual([...BUDGET_CATEGORIES])
  })

  it('never offers ignored, which is a label for a file and not a budget', () => {
    expect(publicCategoriesFromFile()).not.toContain('ignored')
  })

  it('a typed config can budget the runtime category', () => {
    expect(BUDGET_CATEGORIES).toContain('runtime')
    expect(publicCategoriesFromFile()).toContain('runtime')
  })

  it('extracts the union from CRLF source the same as from LF source', () => {
    const lf = fs.readFileSync(configTypesPath, 'utf8').replace(/\r\n/g, '\n')
    const crlf = lf.replace(/\n/g, '\r\n')

    expect(crlf).toContain('\r\n')
    expect(categoriesFromSource(crlf)).toEqual(categoriesFromSource(lf))
    expect(categoriesFromSource(crlf)).toEqual([...BUDGET_CATEGORIES])
  })

  it('reads a CRLF copy of config-types.ts from disk', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-crlf-'))
    const copy = path.join(dir, 'config-types.ts')

    try {
      const lf = fs.readFileSync(configTypesPath, 'utf8').replace(/\r\n/g, '\n')
      fs.writeFileSync(copy, lf.replace(/\n/g, '\r\n'), 'utf8')

      const written = fs.readFileSync(copy, 'utf8')

      expect(written).toContain('\r\n')
      expect(written.split(/\r?\n/).length).toBe(lf.split('\n').length)

      expect(publicCategoriesFromFile(copy)).toEqual([...BUDGET_CATEGORIES])
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  })
})

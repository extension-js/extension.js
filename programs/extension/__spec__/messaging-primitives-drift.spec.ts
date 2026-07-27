import {createHash} from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const programsDir = path.resolve(here, '../..')

const CANONICAL = 'develop/lib/messaging.ts'

const COPIES = [
  'extension/helpers/messaging.ts',
  'create/lib/messaging.ts',
  'install/lib/messaging.ts'
]

const WHY =
  'Copy programs/develop/lib/messaging.ts over it. These four files are ' +
  'duplicated on purpose: do not edit a copy, and do not replace the ' +
  'duplication with a shared package or a cross-program import.'

function read(relative: string): Buffer {
  return fs.readFileSync(path.join(programsDir, relative))
}

function findMessagingFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules') continue
    if (entry.name === 'dist') continue
    if (entry.name === '.rslib') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) findMessagingFiles(full, found)
    else if (entry.name === 'messaging.ts')
      found.push(path.relative(programsDir, full))
  }
  return found
}

describe('messaging primitives are duplicated without drift', () => {
  it('keeps every copy byte-identical to programs/develop/lib/messaging.ts', () => {
    const canonical = read(CANONICAL)

    for (const copy of COPIES) {
      // String compare first: vitest renders a readable diff for it.
      expect(
        read(copy).toString('utf8'),
        `programs/${copy} drifted from programs/${CANONICAL}. ${WHY}`
      ).toBe(canonical.toString('utf8'))

      // Hash second: catches a BOM or a lone carriage return.
      expect(
        createHash('sha256').update(read(copy)).digest('hex'),
        `programs/${copy} is not byte-identical to programs/${CANONICAL}. ${WHY}`
      ).toBe(createHash('sha256').update(canonical).digest('hex'))
    }
  })

  it('knows about every messaging.ts in the workspace', () => {
    expect(
      findMessagingFiles(programsDir).sort(),
      'A messaging.ts appeared outside the tracked set. Add it to this spec ' +
        `and make it byte-identical to programs/${CANONICAL}. ${WHY}`
    ).toEqual([CANONICAL, ...COPIES].sort())
  })
})

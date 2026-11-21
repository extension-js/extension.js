import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import * as standIns from './helpers/contract'

// The stand-ins are found by name in the launcher's stamp module, so a
// renamed or removed stamp fails here instead of leaving a stand-in behind.
describe('the launcher stamp stand-ins', () => {
  const source = fs.readFileSync(
    path.resolve(
      __dirname,
      '../../../extension/browsers/browsers-lib/ready-stamp.ts'
    ),
    'utf8'
  )
  const names = Object.keys(standIns).filter((name) =>
    name.startsWith('stampReady')
  )

  it('covers more than one stamp', () => {
    expect(names.length).toBeGreaterThan(1)
  })

  it.each(names)('%s names a stamp the launcher exports', (name) => {
    expect(source).toMatch(new RegExp(`export function ${name}\\(`))
  })
})

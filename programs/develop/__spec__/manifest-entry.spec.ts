import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

describe('the removed manifest entry', () => {
  it('is no longer published under ./manifest', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    )

    expect(Object.keys(pkg.exports)).not.toContain('./manifest')
  })
})

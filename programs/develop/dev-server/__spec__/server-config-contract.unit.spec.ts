import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'

describe('dev-server config contract', () => {
  it('keeps liveReload: true and hot: true on the RspackDevServer config', () => {
    const indexPath = path.resolve(__dirname, '..', 'index.ts')
    const source = fs.readFileSync(indexPath, 'utf8')

    const serverConfigBlock = source.match(
      /const serverConfig: Configuration = \{[\s\S]*?\n {2}\}/
    )
    expect(
      serverConfigBlock,
      'expected to find serverConfig declaration in dev-server/index.ts'
    ).not.toBeNull()
    const block = serverConfigBlock![0]
    expect(block).toMatch(/\bliveReload:\s*true\b/)
    expect(block).toMatch(/\bhot:\s*true\b/)
  })
})

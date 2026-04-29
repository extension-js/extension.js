import {describe, it, expect} from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Locks in the dev-server config contract that landed with the rspack 2.x
 * upgrade. Two values were silently regressed by an earlier refactor and
 * surfaced as a `dev-reload-chromium` CI timeout where every template's
 * `updates html UI on change` test waited 60s, failed, and retried.
 *
 * - `liveReload: true` — required so RspackDevServer's `watchFiles` change
 *   listener is registered. With `liveReload: false` the server never
 *   broadcasts `static-changed`, and rspack 2.x stopped bumping
 *   `stats.hash` on asset-only rebuilds, so HTML edits in already-open
 *   extension pages stay frozen forever.
 * - `hot: true` — keeps `module.hot` injected so `webpack/hot/dev-server`
 *   (prepended to HTML entry chains) does not throw at module evaluation.
 *
 * If you change either value, the entire `dev-live` Playwright project will
 * silently break before this assertion fires — keep them locked here.
 */
describe('dev-server config contract', () => {
  it('keeps liveReload: true and hot: true on the RspackDevServer config', () => {
    const indexPath = path.resolve(__dirname, '..', 'index.ts')
    const source = fs.readFileSync(indexPath, 'utf8')

    const serverConfigBlock = source.match(
      /const serverConfig: Configuration = \{[\s\S]*?\n  \}/
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

import * as fs from 'node:fs'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {describe, expect, it} from 'vitest'
import {SESSION_ARTIFACTS} from '../session-paths'

const developRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
)

describe('session-state layout', () => {
  it('keys every non-legacy artifact per project+browser', () => {
    // A per-project single slot gets clobbered the moment a second browser
    // session starts on the same project (the control.token defect). Every
    // artifact must vary with the browser AND carry the browser name
    // visibly in its path.
    for (const artifact of SESSION_ARTIFACTS) {
      if (artifact.keying !== 'per-browser') continue
      const chrome = artifact.build('/proj', 'chrome')
      const firefox = artifact.build('/proj', 'firefox')
      expect(chrome, artifact.name).not.toBe(firefox)

      const segments = chrome.split(path.sep)
      const carriesBrowserKey = segments.some(
        (segment) => segment === 'chrome' || segment.includes('-chrome')
      )
      expect(carriesBrowserKey, `${artifact.name}: ${chrome}`).toBe(true)
    }
  })

  it('allows exactly the known legacy slots and no new ones', () => {
    // Adding a shared-slot (or dist-lifetime) session file is a design
    // decision with a field-report-shaped failure mode, force the edit to
    // happen here, in review, not silently in a path join.
    const legacy = SESSION_ARTIFACTS.filter(
      (artifact) => artifact.keying !== 'per-browser'
    ).map((artifact) => artifact.name)
    expect(legacy.sort()).toEqual([
      'legacy-control-port',
      'legacy-control-token'
    ])
  })

  it('has no session path joins outside session-paths', () => {
    // Path builders that bypass the module dodge both assertions above.
    // Scan every source line for path.join/resolve calls that mention the
    // session-state roots. The facades re-export from session-paths, so
    // after the refactor this allowlist is just the module itself.
    const allowed = new Set([path.join('lib', 'session-paths.ts')])
    const offenders: string[] = []

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        if (entry.name === '__spec__' || entry.name === '__tests__') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!entry.name.endsWith('.ts')) continue

        const rel = path.relative(developRoot, full)
        if (allowed.has(rel)) continue

        // Collapse whitespace so multi-line join(...) argument lists can't
        // slip past a line-based scan; match within the call's paren span.
        const flat = fs.readFileSync(full, 'utf-8').replace(/\s+/g, ' ')
        const calls = flat.match(/path\.(join|resolve)\([^)]*\)/g) ?? []
        for (const call of calls) {
          const mentionsStateRoot =
            call.includes("'.extension-js'") ||
            (call.includes("'extension-js'") && call.includes("'dist'"))
          if (mentionsStateRoot) {
            offenders.push(`${rel}: ${call}`)
          }
        }
      }
    }
    walk(developRoot)

    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

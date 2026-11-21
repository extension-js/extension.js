import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import type {BrowserType} from '../types'
import {buildProject} from './helpers/build-project'
import {writeProjectFiles} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const makeTempFolder = trackTempFolders()

// The manifest three of four agents wrote for a side panel: the prefix on the
// item, where it used to ship as written and grant nothing.
function project() {
  const root = makeTempFolder('extjs-prefixed-permission-')

  writeProjectFiles(root, {
    'package.json': JSON.stringify({
      private: true,
      name: 'prefixed-permission',
      version: '0.0.0'
    }),
    'manifest.json': JSON.stringify({
      manifest_version: 3,
      name: 'Repro',
      version: '0.0.1',
      permissions: ['storage', 'chromium:sidePanel'],
      'chromium:side_panel': {default_path: 'sidebar.html'},
      background: {
        'chromium:service_worker': 'bg.js',
        'firefox:scripts': ['bg.js']
      }
    }),
    'sidebar.html': '<!doctype html><html><body><p>panel</p></body></html>',
    'bg.js': 'console.log("bg")\n'
  })

  return root
}

const builtManifest = (root: string, browser: string) =>
  JSON.parse(
    fs.readFileSync(path.join(root, 'dist', browser, 'manifest.json'), 'utf8')
  )

describe('a browser prefix on a permission item, on a real build', () => {
  it.each<[BrowserType, string[]]>([
    ['chrome', ['storage', 'sidePanel']],
    ['firefox', ['storage']]
  ])(
    'builds for %s with the permission resolved and one coded warning',
    async (browser, permissions) => {
      const root = project()
      const summary = await buildProject(root, {
        browser,
        mode: 'production',
        exitOnError: false
      })

      expect(summary.errors_count).toBe(0)
      expect(builtManifest(root, browser).permissions).toEqual(permissions)

      const warnings = (summary.warnings || []).filter((warning: string) =>
        warning.includes('browser prefix on a permission item')
      )

      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain('W_MANIFEST_COMPAT')
      expect(warnings[0]).toContain('chromium:sidePanel')
    },
    180_000
  )
})

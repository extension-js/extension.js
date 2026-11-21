import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {buildProject} from './helpers/build-project'
import {writeExtensionProject} from './helpers/extension-project'
import {trackTempFolders} from './helpers/temp-folders'

const tempFolder = trackTempFolders()

function project(matches: string[]) {
  const root = tempFolder('extjs-loopback-')
  writeExtensionProject(root, {
    name: 'loopback',
    manifest: {content_scripts: [{matches, js: ['content.js']}]}
  })

  fs.writeFileSync(path.join(root, 'content.js'), 'console.log(1)\n')

  return root
}

async function build(root: string, mode: 'production' | 'development') {
  return buildProject(root, {
    mode
  })
}

const loopbackWarnings = (summary: {warnings?: string[]}) =>
  (summary.warnings || []).filter((text) =>
    text.startsWith('W_PROD_LOOPBACK_ORIGIN:')
  )

describe('a production build that reaches the local machine', () => {
  it('ships the match as written and warns with a code naming where it sits', async () => {
    const root = project(['https://example.com/*', 'http://localhost:4322/*'])
    const summary = await build(root, 'production')

    expect(summary.errors_count).toBe(0)
    const warnings = loopbackWarnings(summary)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain(
      'http://localhost:4322/* in content_scripts[0].matches'
    )

    expect(warnings[0]).toContain('.env.development')

    const shipped = JSON.parse(
      fs.readFileSync(
        path.join(root, 'dist', 'chrome', 'manifest.json'),
        'utf-8'
      )
    )
    expect(shipped.content_scripts[0].matches).toContain(
      'http://localhost:4322/*'
    )
  })

  it('stays quiet for a clean production manifest', async () => {
    const summary = await build(
      project(['https://example.com/*']),
      'production'
    )

    expect(summary.errors_count).toBe(0)
    expect(loopbackWarnings(summary)).toEqual([])
  })

  it('stays quiet for a development build', async () => {
    const summary = await build(
      project(['http://localhost:4322/*']),
      'development'
    )

    expect(loopbackWarnings(summary)).toEqual([])
  })
})

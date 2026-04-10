import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {prettyPuppeteerInstallGuidance} from '../browsers-lib/messages'

describe('prettyPuppeteerInstallGuidance', () => {
  const prevCwd = process.cwd()
  const prevEnv = {...process.env}

  afterEach(() => {
    process.chdir(prevCwd)
    process.env = {...prevEnv}
  })

  it('prefers the active package manager command and preserves colored output', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-guidance-'))
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify(
        {
          scripts: {
            extension: 'extension'
          }
        },
        null,
        2
      )
    )

    process.chdir(root)
    process.env.npm_config_user_agent = 'pnpm/10.28.0 npm/? node/v23.8.0'

    const msg = prettyPuppeteerInstallGuidance(
      'chrome' as any,
      'npx extension install chrome',
      '/tmp/extension.js/browsers'
    )

    expect(msg).toContain('pnpm extension install chrome')
    expect(msg).toContain('Browser setup required')
    expect(msg).toContain(
      'Install Chrome for Testing into the managed browser cache:'
    )
    expect(msg).toContain('  pnpm extension install chrome')
    expect(msg).toContain('Chrome for Testing is not available')
    expect(msg).toContain('INSTALL PATH')
  })
})

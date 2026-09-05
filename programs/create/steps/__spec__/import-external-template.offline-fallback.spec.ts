import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('go-git-it', () => ({default: vi.fn(async () => {})}))
vi.mock('axios', () => ({
  default: {
    get: vi.fn(async () => {
      throw new Error('network is disabled in this test')
    })
  }
}))

import axios from 'axios'
import {
  DEFAULT_TEMPLATE_NAME,
  importExternalTemplate,
  OFFLINE_FALLBACK_TEMPLATE,
  TemplateDownloadError
} from '../import-external-template'

function makeLogger() {
  const lines: string[] = []
  return {
    lines,
    log: (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '))
    },
    error: (...args: unknown[]) => {
      lines.push(args.map((arg) => String(arg)).join(' '))
    }
  }
}

describe('the scaffold default template name', () => {
  it('stays pinned to typescript', () => {
    expect(DEFAULT_TEMPLATE_NAME).toBe('typescript')
  })
})

describe('the default template falls back to the bundled template when offline', () => {
  const prevEnv = process.env.EXTENSION_ENV
  let workDir: string

  beforeEach(async () => {
    process.env.EXTENSION_ENV = 'test'
    vi.mocked(axios.get).mockClear()
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'offline-fallback-'))
  })

  afterEach(async () => {
    process.env.EXTENSION_ENV = prevEnv
    await fsp.rm(workDir, {recursive: true, force: true})
  })

  it('scaffolds the bundled template and names the network failure', async () => {
    const projectPath = path.join(workDir, 'my-extension')
    const logger = makeLogger()

    const provenance = await importExternalTemplate(
      projectPath,
      'my-extension',
      'typescript',
      logger,
      {ownsProjectDir: true, allowOfflineFallback: true}
    )

    expect(provenance.template).toBe(OFFLINE_FALLBACK_TEMPLATE)
    expect(provenance.source).toBe('bundled')
    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true)

    const output = logger.lines.join('\n')
    expect(output).toContain('typescript')
    expect(output).toContain('offline')
    expect(output).toContain('network is disabled in this test')
  })

  it('fails loudly instead of swapping when the template is explicit', async () => {
    const projectPath = path.join(workDir, 'explicit-extension')
    const logger = makeLogger()

    await expect(
      importExternalTemplate(
        projectPath,
        'explicit-extension',
        'typescript',
        logger,
        {
          ownsProjectDir: true,
          allowOfflineFallback: false
        }
      )
    ).rejects.toBeInstanceOf(TemplateDownloadError)

    expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(false)
  })
})

import {spawn} from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  fixtureExtensionFiles,
  serveExamplesCatalog
} from '../../../create/__spec__/examples-catalog-fixture'

const ANSI = /\x1b\[[0-9;]*m/g
const STACK_FRAME = /^\s+at /m
const emptyArchive = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.alloc(18)
])

function cliRoot(): string {
  return path.resolve(__dirname, '../..')
}

function cliBin(): string {
  const cjs = path.join(cliRoot(), 'dist', 'cli.cjs')
  if (fs.existsSync(cjs)) return cjs

  return path.join(cliRoot(), 'dist', 'cli.js')
}

function serveArchive(status: number): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const server = http.createServer((_req, res) => {
    res.writeHead(status, {'content-type': 'application/zip'})
    res.end(status === 200 ? emptyArchive : 'nope')
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        url: `http://127.0.0.1:${port}/examples.zip`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          })
      })
    })
  })
}

function runCreate(
  args: string[],
  env: NodeJS.ProcessEnv,
  prepare?: (work: string) => void
): Promise<{status: number | null; stderr: string}> {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-create-stderr-'))
  prepare?.(work)
  const configHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-config-'))
  const cacheHome = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-cache-'))

  return new Promise((resolve) => {
    let stderr = ''
    const child = spawn(process.execPath, [cliBin(), ...args], {
      cwd: work,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        ...env,
        EXTENSION_ENV: 'test',
        EXTENSION_TELEMETRY: '0',
        XDG_CONFIG_HOME: configHome,
        XDG_CACHE_HOME: cacheHome
      }
    })
    child.stderr.setEncoding('utf8')

    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('close', (status) => {
      fs.rmSync(work, {recursive: true, force: true})
      resolve({status, stderr: stderr.replace(ANSI, '')})
    })
  })
}

describe('a known create refusal prints its frame and nothing else', () => {
  let close: (() => Promise<void>) | undefined

  afterEach(async () => {
    if (close) await close()

    close = undefined
  })

  it('when the template name is not in the catalog', async () => {
    const server = await serveArchive(200)
    close = server.close

    const result = await runCreate(['create', './proof', '-t', 'nope-xyz'], {
      EXTENSION_CREATE_TEMPLATE_URL: server.url,
      EXTENSION_ALLOW_HTTP_TEMPLATE: 'true'
    })

    expect(result.status).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr).not.toContain('TemplateNotFoundError')
    expect(
      result.stderr.match(/is not in the extension-js\/examples catalog/g)
    ).toHaveLength(1)
  }, 60000)

  it('when the catalog download fails', async () => {
    const server = await serveArchive(404)
    close = server.close

    const result = await runCreate(['create', './proof', '-t', 'react'], {
      EXTENSION_CREATE_TEMPLATE_URL: server.url,
      EXTENSION_ALLOW_HTTP_TEMPLATE: 'true'
    })

    expect(result.status).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr).not.toContain('TemplateDownloadError')
    expect(
      result.stderr.match(/Couldn't download the template react/g)
    ).toHaveLength(1)
  }, 60000)

  it('when the template URL is plain http', async () => {
    const result = await runCreate(
      ['create', './proof', '-t', 'http://example.com/template.zip'],
      {}
    )

    expect(result.status).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr).not.toContain('InsecureTemplateUrlError')
    expect(
      result.stderr.match(/Can't download a template over plain HTTP/g)
    ).toHaveLength(1)
  }, 60000)

  // chmod does not deny directory writes on Windows and root ignores the mode,
  // so only a non-root posix user can produce the condition under test.
  const canDenyWrites = process.platform !== 'win32' && process.getuid?.() !== 0
  const itWritable = canDenyWrites ? it : it.skip

  itWritable(
    'when the destination parent is read-only',
    async () => {
      const result = await runCreate(
        ['create', 'ro/proof', '-t', 'javascript'],
        {},
        (work) => {
          fs.mkdirSync(path.join(work, 'ro'))
          fs.chmodSync(path.join(work, 'ro'), 0o555)
        }
      )

      expect(result.status).toBe(1)
      expect(result.stderr).not.toMatch(STACK_FRAME)
      expect(result.stderr.match(/⏵⏵⏵/g)).toHaveLength(1)
      expect(result.stderr).toContain('EACCES')
      // The unwritable path, not the basename of the requested folder.
      expect(result.stderr).toMatch(/ro\/proof/)
    },
    60000
  )

  // An unreachable registry does not make an install fail: a lane where the
  // override never reached the manager resolved the real one and succeeded.
  it('when the dependency install fails', async () => {
    const template = 'broken-local-dependency'
    const files = fixtureExtensionFiles(template)
    const catalog = await serveExamplesCatalog({
      [template]: {
        ...files,
        'package.json': `${JSON.stringify(
          {
            private: true,
            name: template,
            version: '1.0.0',
            type: 'module',
            dependencies: {'missing-local-package': 'file:./not-here'}
          },
          null,
          2
        )}\n`
      }
    })
    close = catalog.close
    const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-pm-store-'))
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-pm-cache-'))

    const result = await runCreate(
      ['create', './proof', '-t', template, '--install'],
      {
        EXTENSION_CREATE_TEMPLATE_URL: catalog.url,
        EXTENSION_ALLOW_HTTP_TEMPLATE: 'true',
        npm_config_registry: 'http://127.0.0.1:9/',
        npm_config_offline: 'true',
        npm_config_cache: cacheDir,
        npm_config_store_dir: storeDir,
        npm_config_fetch_retries: '0',
        npm_config_audit: 'false',
        npm_config_fund: 'false'
      }
    )

    fs.rmSync(storeDir, {recursive: true, force: true})
    fs.rmSync(cacheDir, {recursive: true, force: true})

    expect(result.status).toBe(1)
    expect(result.stderr).not.toMatch(STACK_FRAME)
    expect(result.stderr.match(/⏵⏵⏵/g)).toHaveLength(1)

    // Which cause it is depends on the manager, so assert the rows are there
    // and that REASON carries real text, not one manager's wording.
    expect(result.stderr).toMatch(/COMMAND \S/)
    expect(result.stderr).toMatch(/EXIT 1/)
    expect(result.stderr).not.toMatch(
      /NO_MATURE_MATCHING_VERSION|minimum[-_ ]?release[-_ ]?age/i
    )

    const reason = /REASON ([^\n]*)/.exec(result.stderr)?.[1]?.trim() ?? ''
    expect(reason.length).toBeGreaterThan(8)
  }, 120000)
})

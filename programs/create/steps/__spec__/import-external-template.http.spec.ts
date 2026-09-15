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
import goGitIt from 'go-git-it'
import {
  InsecureTemplateUrlError,
  importExternalTemplate,
  refuseHttpRedirect
} from '../import-external-template'

describe('importExternalTemplate refuses plain HTTP template URLs', () => {
  const prevAllow = process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
  const tempDirs: string[] = []

  beforeEach(() => {
    delete process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
    vi.mocked(axios.get).mockReset()
    vi.mocked(axios.get).mockRejectedValue(
      new Error('network is disabled in this test')
    )
    vi.mocked(goGitIt).mockClear()
  })

  afterEach(async () => {
    if (prevAllow === undefined)
      delete process.env.EXTENSION_ALLOW_HTTP_TEMPLATE
    else process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = prevAllow
    while (tempDirs.length > 0) {
      await fsp.rm(tempDirs.pop()!, {recursive: true, force: true})
    }
  })

  async function makeProjectPath() {
    const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'extjs-http-'))
    tempDirs.push(tmpRoot)
    return path.join(tmpRoot, 'my-ext')
  }

  it.each([
    'http://example.com/template.zip',
    'HTTP://example.com/template.zip',
    'http://github.com/extension-js/examples/tree/main/examples/content'
  ])('refuses %s before any network request', async (url) => {
    const projectPath = await makeProjectPath()
    const errors: string[] = []

    await expect(
      importExternalTemplate(
        projectPath,
        'my-ext',
        url,
        {log: () => {}, error: (...args) => errors.push(args.join(' '))},
        {ownsProjectDir: true}
      )
    ).rejects.toBeInstanceOf(InsecureTemplateUrlError)

    expect(axios.get).not.toHaveBeenCalled()
    expect(goGitIt).not.toHaveBeenCalled()
    expect(fs.existsSync(projectPath)).toBe(false)
    expect(errors.join('\n')).toContain('plain HTTP')
    expect(errors.join('\n')).toContain('EXTENSION_ALLOW_HTTP_TEMPLATE=true')
  })

  it('downloads an http URL when EXTENSION_ALLOW_HTTP_TEMPLATE=true', async () => {
    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    const projectPath = await makeProjectPath()

    await expect(
      importExternalTemplate(
        projectPath,
        'my-ext',
        'http://example.com/template.zip',
        {log: () => {}, error: () => {}},
        {ownsProjectDir: true}
      )
    ).rejects.toThrow('network is disabled in this test')

    expect(axios.get).toHaveBeenCalledTimes(1)
  })

  it('passes a redirect guard with every https download', async () => {
    const projectPath = await makeProjectPath()

    await expect(
      importExternalTemplate(
        projectPath,
        'my-ext',
        'https://example.com/template.zip',
        {log: () => {}, error: () => {}},
        {ownsProjectDir: true}
      )
    ).rejects.toThrow('network is disabled in this test')

    const [, config] = vi.mocked(axios.get).mock.calls[0]
    expect(
      (config as {beforeRedirect?: unknown} | undefined)?.beforeRedirect
    ).toBe(refuseHttpRedirect)
  })

  it('names the refusal when the redirect guard fires mid-download', async () => {
    vi.mocked(axios.get).mockImplementation(async () => {
      refuseHttpRedirect({
        protocol: 'http:',
        href: 'http://mirror.example.com/t.zip'
      })
      return {data: new ArrayBuffer(0), headers: {}}
    })
    const projectPath = await makeProjectPath()
    const errors: string[] = []

    await expect(
      importExternalTemplate(
        projectPath,
        'my-ext',
        'https://example.com/template.zip',
        {log: () => {}, error: (...args) => errors.push(args.join(' '))},
        {ownsProjectDir: true}
      )
    ).rejects.toBeInstanceOf(InsecureTemplateUrlError)

    expect(errors.join('\n')).toContain('http://mirror.example.com/t.zip')
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('refuses an http EXTENSION_CREATE_TEMPLATE_URL without the offline fallback', async () => {
    const prevUrl = process.env.EXTENSION_CREATE_TEMPLATE_URL
    process.env.EXTENSION_CREATE_TEMPLATE_URL =
      'http://mirror.example.com/x.zip'
    try {
      const projectPath = await makeProjectPath()
      const errors: string[] = []

      await expect(
        importExternalTemplate(
          projectPath,
          'my-ext',
          'typescript',
          {log: () => {}, error: (...args) => errors.push(args.join(' '))},
          {ownsProjectDir: true, allowOfflineFallback: true}
        )
      ).rejects.toBeInstanceOf(InsecureTemplateUrlError)

      expect(axios.get).not.toHaveBeenCalled()
      expect(errors.join('\n')).toContain('http://mirror.example.com/x.zip')
      expect(fs.existsSync(projectPath)).toBe(false)
    } finally {
      if (prevUrl === undefined)
        delete process.env.EXTENSION_CREATE_TEMPLATE_URL
      else process.env.EXTENSION_CREATE_TEMPLATE_URL = prevUrl
    }
  })

  it('stops a catalog download that redirects to http, with no retry or fallback', async () => {
    vi.mocked(axios.get).mockImplementation(async () => {
      refuseHttpRedirect({href: 'http://mirror.example.com/x.zip'})
      return {data: new ArrayBuffer(0), headers: {}}
    })
    const projectPath = await makeProjectPath()

    await expect(
      importExternalTemplate(
        projectPath,
        'my-ext',
        'typescript',
        {log: () => {}, error: () => {}},
        {ownsProjectDir: true, allowOfflineFallback: true}
      )
    ).rejects.toBeInstanceOf(InsecureTemplateUrlError)

    expect(axios.get).toHaveBeenCalledTimes(1)
    const [, config] = vi.mocked(axios.get).mock.calls[0]
    expect(
      (config as {beforeRedirect?: unknown} | undefined)?.beforeRedirect
    ).toBe(refuseHttpRedirect)
    expect(fs.existsSync(projectPath)).toBe(false)
  })

  it('lets an https redirect through and holds an http one', () => {
    expect(() =>
      refuseHttpRedirect({
        protocol: 'https:',
        href: 'https://cdn.example/t.zip'
      })
    ).not.toThrow()
    expect(() =>
      refuseHttpRedirect({protocol: 'http:', href: 'http://cdn.example/t.zip'})
    ).toThrow(InsecureTemplateUrlError)
    expect(() => refuseHttpRedirect({protocol: 'http:'})).toThrow(
      InsecureTemplateUrlError
    )

    process.env.EXTENSION_ALLOW_HTTP_TEMPLATE = 'true'
    expect(() =>
      refuseHttpRedirect({protocol: 'http:', href: 'http://cdn.example/t.zip'})
    ).not.toThrow()
  })
})

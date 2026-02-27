import {describe, it, expect} from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {overridePackageJson} from '../write-package-json'

async function withTempDir<T>(fn: (dir: string) => Promise<T>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'extjs-create-pkg-'))
  try {
    return await fn(dir)
  } finally {
    await fs.rm(dir, {recursive: true, force: true})
  }
}

describe('overridePackageJson template-aware scripts', () => {
  it('uses local CLI binary when create provides a local develop root', async () => {
    await withTempDir(async (projectPath) => {
      const prevDevelopRoot = process.env.EXTENSION_CREATE_DEVELOP_ROOT
      const developRoot = path.join(projectPath, 'programs', 'develop')
      const localCliPath = path.join(
        projectPath,
        'programs',
        'cli',
        'dist',
        'cli.cjs'
      )

      await fs.mkdir(path.dirname(localCliPath), {recursive: true})
      await fs.writeFile(localCliPath, 'module.exports = {}')

      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {}
        })
      )

      process.env.EXTENSION_CREATE_DEVELOP_ROOT = developRoot

      try {
        await overridePackageJson(projectPath, 'dev-local-cli', {
          template: 'init',
          cliVersion: '0.0.1'
        })
      } finally {
        if (typeof prevDevelopRoot === 'undefined') {
          delete process.env.EXTENSION_CREATE_DEVELOP_ROOT
        } else {
          process.env.EXTENSION_CREATE_DEVELOP_ROOT = prevDevelopRoot
        }
      }

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.scripts.dev).toContain(localCliPath)
      expect(pkg.scripts.start).toContain(localCliPath)
      expect(pkg.scripts.build).toContain(localCliPath)
      expect(pkg.scripts.preview).toContain(localCliPath)
    })
  })

  it('targets packages/extension for any monorepo template name', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {}
        })
      )

      await overridePackageJson(projectPath, 'custom-monorepo-template', {
        template: 'custom-monorepo-template',
        cliVersion: '0.0.1'
      })

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.scripts['build:chrome']).toContain('packages/extension')
      expect(pkg.scripts.dev).toContain('packages/extension')
      expect(pkg.scripts.start).toContain('packages/extension')
      expect(pkg.scripts.build).toContain('packages/extension')
      expect(pkg.scripts.preview).toContain('packages/extension')
      expect(pkg.scripts['build:firefox']).toContain('packages/extension')
      expect(pkg.scripts['build:edge']).toContain('packages/extension')
    })
  })

  it('does not override existing dev/build/start/preview scripts', async () => {
    await withTempDir(async (projectPath) => {
      await fs.writeFile(
        path.join(projectPath, 'package.json'),
        JSON.stringify({
          name: 'seed',
          private: true,
          scripts: {
            dev: 'custom dev',
            start: 'custom start',
            build: 'custom build',
            preview: 'custom preview'
          }
        })
      )

      await overridePackageJson(projectPath, 'seed', {
        template: 'custom-monorepo-template',
        cliVersion: '0.0.1'
      })

      const pkg = JSON.parse(
        await fs.readFile(path.join(projectPath, 'package.json'), 'utf8')
      )

      expect(pkg.scripts.dev).toBe('custom dev')
      expect(pkg.scripts.start).toBe('custom start')
      expect(pkg.scripts.build).toBe('custom build')
      expect(pkg.scripts.preview).toBe('custom preview')
    })
  })
})

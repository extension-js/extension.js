import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const spawnMock = vi.hoisted(() => vi.fn())
vi.mock('cross-spawn', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args)
}))

import {
  invokingNpmrcReleaseAge,
  runInstall,
  withoutInheritedReleaseAge
} from '../install-runner'

describe('install-runner runInstall', () => {
  beforeEach(() => {
    spawnMock.mockReset()
    spawnMock.mockImplementation(() => ({
      stdout: {on: () => undefined},
      stderr: {on: () => undefined},
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0))
      }
    }))
  })

  it('passes the command and args to cross-spawn with no shell option', async () => {
    // A shell would join these into one cmd.exe string, so the project path
    // must reach the package manager as a single untouched argument.
    const cwd = 'C:\\Users\\me & echo pwned\\my ext'
    const args = ['install', '--ignore-scripts']

    const result = await runInstall('pnpm.cmd', args, {cwd, stdio: 'pipe'})

    expect(result.code).toBe(0)
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, spawnArgs, options] = spawnMock.mock.calls[0]
    expect(command).toBe('pnpm.cmd')
    expect(spawnArgs).toEqual(args)
    expect(options).not.toHaveProperty('shell')
    expect(options.cwd).toBe(cwd)
    expect(options.stdio).toBe('pipe')
  })

  describe('release-age rule in the child env', () => {
    const tmpRoots: string[] = []
    const saved = {
      age: process.env.npm_config_minimum_release_age,
      initCwd: process.env.INIT_CWD
    }

    afterEach(() => {
      for (const dir of tmpRoots.splice(0)) {
        fs.rmSync(dir, {recursive: true, force: true})
      }

      if (saved.age === undefined) {
        delete process.env.npm_config_minimum_release_age
      } else {
        process.env.npm_config_minimum_release_age = saved.age
      }

      if (saved.initCwd === undefined) {
        delete process.env.INIT_CWD
      } else {
        process.env.INIT_CWD = saved.initCwd
      }
    })

    // Windows keeps whatever casing the variable was first set with, so the
    // spawned env is read by name ignoring case, the way the child reads it.
    function spawnedReleaseAge(): string | undefined {
      const env = spawnMock.mock.calls[0][2].env as Record<string, string>
      const key = Object.keys(env).find(
        (name) => name.toLowerCase() === 'npm_config_minimum_release_age'
      )

      return key === undefined ? undefined : env[key]
    }

    function checkoutWithNpmrc(age: string | null) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-npmrc-'))
      tmpRoots.push(root)
      const nested = path.join(root, 'programs', 'create')
      fs.mkdirSync(nested, {recursive: true})

      if (age !== null) {
        fs.writeFileSync(
          path.join(root, '.npmrc'),
          `auto-install-peers=true\nminimum-release-age=${age}\n`
        )
      }

      return nested
    }

    it('reads the rule from the .npmrc above where the package manager ran', () => {
      const nested = checkoutWithNpmrc('4320')

      expect(invokingNpmrcReleaseAge({INIT_CWD: nested}, os.tmpdir())).toBe(
        '4320'
      )

      expect(invokingNpmrcReleaseAge({}, nested)).toBe('4320')
      expect(invokingNpmrcReleaseAge({}, checkoutWithNpmrc(null))).toBeNull()
    })

    it('drops the value the checkout .npmrc exported and its exclusions', () => {
      const env = withoutInheritedReleaseAge(
        {
          npm_config_minimum_release_age: '4320',
          npm_config_minimum_release_age_exclude: 'image-size',
          npm_config_user_agent: 'pnpm/10'
        },
        '4320'
      )

      expect(env).toEqual({npm_config_user_agent: 'pnpm/10'})
    })

    it('keeps a rule the user exported on purpose', () => {
      const exported = {
        npm_config_minimum_release_age: '10080',
        pnpm_config_minimum_release_age: '10080'
      }

      expect(withoutInheritedReleaseAge(exported, '4320')).toEqual(exported)
      expect(withoutInheritedReleaseAge(exported, null)).toEqual(exported)
    })

    it('hands the user rule to the package manager it spawns', async () => {
      process.env.INIT_CWD = checkoutWithNpmrc('4320')
      process.env.npm_config_minimum_release_age = '10080'

      await runInstall('npm', ['install'], {cwd: os.tmpdir(), stdio: 'pipe'})
      expect(spawnedReleaseAge()).toBe('10080')

      // The negative control: the checkout value is the one that goes.
      spawnMock.mockClear()
      process.env.npm_config_minimum_release_age = '4320'
      await runInstall('npm', ['install'], {cwd: os.tmpdir(), stdio: 'pipe'})
      expect(spawnedReleaseAge()).toBeUndefined()
    })
  })
})

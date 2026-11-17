import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {missingBinary} from '../../__spec__/fake-spawn'
import {resolvePackageManagerSpec, type VersionProbe} from '../package-manager'

// Stands in for the binary through the probe seam, so no manager starts.
function recordingProbe(answer: ReturnType<VersionProbe> | Error) {
  const calls: Parameters<VersionProbe>[] = []

  const probe: VersionProbe = (...call) => {
    calls.push(call)
    if (answer instanceof Error) throw answer

    return answer
  }

  return {probe, calls}
}

const REGISTRY_NAMES = ['npm_config_registry', 'corepack_npm_registry']
const tmpRoots: string[] = []
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.stubEnv('npm_config_user_agent', '')
  saved = {}

  for (const key of Object.keys(process.env)) {
    if (REGISTRY_NAMES.includes(key.toLowerCase())) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  }
})

afterEach(() => {
  vi.unstubAllEnvs()

  for (const key of Object.keys(process.env)) {
    if (REGISTRY_NAMES.includes(key.toLowerCase())) delete process.env[key]
  }

  Object.assign(process.env, saved)

  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

function unpinnedProject(npmrc: string | null): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-corepack-probe-'))
  tmpRoots.push(dir)
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"unpinned"}\n')

  if (npmrc !== null) fs.writeFileSync(path.join(dir, '.npmrc'), npmrc)

  return dir
}

describe('the package manager version probe', () => {
  it('points Corepack at the registry the project .npmrc pins', () => {
    const dir = unpinnedProject('registry=http://127.0.0.1:4882/\n')
    const {probe, calls} = recordingProbe({status: 0, stdout: '9.9.9\n'})

    expect(resolvePackageManagerSpec(dir, 'pnpm', probe)).toBe('pnpm@9.9.9')
    expect(calls).toHaveLength(1)

    const [command, args, options] = calls[0]
    expect(command).toBe('pnpm')
    expect(args).toEqual(['--version'])
    expect(options.env?.COREPACK_NPM_REGISTRY).toBe('http://127.0.0.1:4882')
    expect(options.env?.PATH).toBe(process.env.PATH)
    // A probe that hangs or prompts must not hold the create.
    expect(options.timeout).toBe(5000)
    expect(options.stdio).toEqual(['ignore', 'pipe', 'ignore'])
  })

  it('sets no Corepack registry for a project that pins none', () => {
    const {probe, calls} = recordingProbe({status: 0, stdout: '9.9.9\n'})

    expect(
      resolvePackageManagerSpec(unpinnedProject(null), 'pnpm', probe)
    ).toBe('pnpm@9.9.9')

    expect(calls[0][2].env).not.toHaveProperty('COREPACK_NPM_REGISTRY')
  })

  it('reads the version past a leading v', () => {
    const {probe} = recordingProbe({status: 0, stdout: 'v1.2.3\n'})

    expect(resolvePackageManagerSpec(unpinnedProject(null), 'bun', probe)).toBe(
      'bun@1.2.3'
    )
  })

  it.each([
    ['exits non-zero', {status: 1, stdout: '9.9.9\n'}],
    ['is killed by the probe timeout', {status: null, stdout: ''}],
    ['prints no version', {status: 0, stdout: 'Usage: pnpm [command]\n'}],
    ['is not on PATH', missingBinary('pnpm')]
  ])('declares no manager when the binary %s', (_label, answer) => {
    const {probe, calls} = recordingProbe(answer)

    expect(
      resolvePackageManagerSpec(unpinnedProject(null), 'pnpm', probe)
    ).toBeUndefined()

    expect(calls).toHaveLength(1)
  })

  it('never probes for Deno, which declares no packageManager', () => {
    const {probe, calls} = recordingProbe({status: 0, stdout: '2.0.0\n'})

    expect(
      resolvePackageManagerSpec(unpinnedProject(null), 'deno', probe)
    ).toBeUndefined()

    expect(calls).toEqual([])
  })
})

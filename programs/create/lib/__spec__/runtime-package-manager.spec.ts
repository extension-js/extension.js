import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  isBunRuntime,
  isDenoRuntime,
  resolveProjectPackageManager,
  resolveScaffoldPackageManager
} from '../package-manager'

function withBunGlobal<T>(body: () => T): T {
  const hadBun = 'Bun' in globalThis
  ;(globalThis as {Bun?: unknown}).Bun = {version: 'test'}

  try {
    return body()
  } finally {
    if (!hadBun) delete (globalThis as {Bun?: unknown}).Bun
  }
}

function withDenoGlobal<T>(body: () => T): T {
  const hadDeno = 'Deno' in globalThis
  ;(globalThis as {Deno?: unknown}).Deno = {version: {deno: 'test'}}

  try {
    return body()
  } finally {
    if (!hadDeno) delete (globalThis as {Deno?: unknown}).Deno
  }
}

const tempDirs: string[] = []

function makeProject(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-rt-pm-'))
  tempDirs.push(dir)

  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), contents)
  }

  return dir
}

afterEach(() => {
  while (tempDirs.length) {
    fs.rmSync(tempDirs.pop() as string, {recursive: true, force: true})
  }
})

describe('isBunRuntime', () => {
  it('is true when the Bun global is present', () => {
    expect(withBunGlobal(() => isBunRuntime())).toBe(true)
  })

  it('is false on a plain Node process', () => {
    expect(isBunRuntime()).toBe(false)
  })

  it('does not confuse Bun with Deno', () => {
    expect(withBunGlobal(() => isDenoRuntime())).toBe(false)
  })
})

describe('resolveScaffoldPackageManager', () => {
  // Bun executing a file sets no npm_config_user_agent, so without the runtime
  // check a scaffold created ON Bun was pinned to npm.
  it('scaffolds for Bun when the CLI runs on Bun', () => {
    expect(withBunGlobal(() => resolveScaffoldPackageManager())).toBe('bun')
  })

  it('still puts Deno first when both globals somehow exist', () => {
    expect(
      withDenoGlobal(() => withBunGlobal(() => resolveScaffoldPackageManager()))
    ).toBe('deno')
  })
})

describe('resolveProjectPackageManager', () => {
  // Bun sits below the pin on purpose. A Deno project has no package.json to
  // read, so there the runtime is the only answer, but a project that declares
  // pnpm stays a pnpm project whatever runtime the CLI happens to be on.
  it('keeps a pinned manager when the CLI runs on Bun', () => {
    const projectPath = makeProject({
      'package.json': JSON.stringify({packageManager: 'pnpm@10.28.0'})
    })

    expect(withBunGlobal(() => resolveProjectPackageManager(projectPath))).toBe(
      'pnpm'
    )
  })

  it('keeps a pnpm workspace when the CLI runs on Bun', () => {
    const projectPath = makeProject({'pnpm-workspace.yaml': 'packages:\n'})

    expect(withBunGlobal(() => resolveProjectPackageManager(projectPath))).toBe(
      'pnpm'
    )
  })

  it('falls back to Bun when the project declares nothing', () => {
    const projectPath = makeProject()

    expect(withBunGlobal(() => resolveProjectPackageManager(projectPath))).toBe(
      'bun'
    )
  })

  it('puts Deno above the pin, because a Deno project has no package.json', () => {
    const projectPath = makeProject({
      'package.json': JSON.stringify({packageManager: 'pnpm@10.28.0'})
    })

    expect(
      withDenoGlobal(() => resolveProjectPackageManager(projectPath))
    ).toBe('deno')
  })
})

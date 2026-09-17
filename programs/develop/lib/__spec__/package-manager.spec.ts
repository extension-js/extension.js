import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const originalPlatform = process.platform

const setPlatform = (value: NodeJS.Platform) => {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true
  })
}

const fakeChild = {
  on: (ev: string, fn: (...a: any[]) => void) => {
    if (ev === 'close') setImmediate(() => fn(0))

    return fakeChild
  }
}
const spawnMock = vi.fn(() => fakeChild)

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
  spawn: (...args: any[]) => spawnMock(...args),
  spawnSync: vi.fn(() => ({status: 0}))
}))

// Installs go through cross-spawn, which requires child_process natively and
// so never sees the mock above. Intercept it at its own seam instead.
vi.mock('cross-spawn', () => ({
  spawn: (...args: any[]) => spawnMock(...args),
  sync: vi.fn(() => ({status: 0}))
}))

import {
  buildInstallCommand,
  execInstallCommand,
  findPnpmWorkspaceMember,
  findPnpmWorkspaceRoot,
  installScriptSuppression,
  isPnpmWorkspaceMemberDir,
  projectInstallArgs,
  projectInstallTarget,
  readPnpmWorkspacePackages,
  resolvePackageManager
} from '../package-manager'

describe('package-manager resolution', () => {
  afterEach(() => setPlatform(originalPlatform))

  it('hydrates npm executable path when package-lock selects npm on Windows', async () => {
    vi.resetModules()
    vi.clearAllMocks()
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-pm-spec-'))

    try {
      setPlatform('win32')
      fs.writeFileSync(path.join(tempDir, 'package-lock.json'), '{}', 'utf8')

      const {execFileSync} = (await import('node:child_process')) as any
      execFileSync.mockReturnValue('C:\\nvm4w\\nodejs\\npm.cmd\r\n')

      const {resolvePackageManager, buildInstallCommand} = await import(
        '../package-manager'
      )

      const pm = resolvePackageManager({cwd: tempDir})
      const command = buildInstallCommand(pm, ['install'])

      expect(pm).toMatchObject({
        name: 'npm',
        execPath: 'C:\\nvm4w\\nodejs\\npm.cmd'
      })

      expect(command).toMatchObject({
        command: 'C:\\nvm4w\\nodejs\\npm.cmd',
        args: ['install']
      })
    } finally {
      fs.rmSync(tempDir, {recursive: true, force: true})
    }
  })
})

describe('package-manager buildInstallCommand', () => {
  it('executes native package manager binaries directly', () => {
    const execPath =
      process.platform === 'win32'
        ? 'C:\\tools\\pnpm\\pnpm.exe'
        : '/usr/local/bin/pnpm'
    const args = ['install', '--silent']

    const invocation = buildInstallCommand({name: 'pnpm', execPath}, args)

    expect(invocation).toEqual({
      command: execPath,
      args
    })
  })

  it('runs JS CLI entrypoints with node', () => {
    const execPath =
      process.platform === 'win32'
        ? 'C:\\node\\npm\\bin\\npm-cli.js'
        : '/tmp/npm-cli.js'
    const args = ['install', '--silent']

    const invocation = buildInstallCommand({name: 'npm', execPath}, args)

    expect(invocation).toEqual({
      command: process.execPath,
      args: [execPath, ...args]
    })
  })

  it('preserves npm_execpath when env user agent identifies pnpm', () => {
    const originalUserAgent = process.env.npm_config_user_agent
    const originalExecPath = process.env.npm_execpath

    process.env.npm_config_user_agent = 'pnpm/10.24.0 npm/? node/v23.8.0 darwin'
    process.env.npm_execpath = '/tmp/pnpm.cjs'

    try {
      const resolution = resolvePackageManager()
      expect(resolution).toEqual({
        name: 'pnpm',
        execPath: '/tmp/pnpm.cjs'
      })
    } finally {
      if (originalUserAgent === undefined) {
        delete process.env.npm_config_user_agent
      } else {
        process.env.npm_config_user_agent = originalUserAgent
      }

      if (originalExecPath === undefined) {
        delete process.env.npm_execpath
      } else {
        process.env.npm_execpath = originalExecPath
      }
    }
  })

  it('reuses npm_execpath when override only specifies manager name', () => {
    const originalOverride = process.env.EXTENSION_JS_PACKAGE_MANAGER
    const originalOverrideExecPath = process.env.EXTENSION_JS_PM_EXEC_PATH
    const originalExecPath = process.env.npm_execpath

    process.env.EXTENSION_JS_PACKAGE_MANAGER = 'pnpm'
    delete process.env.EXTENSION_JS_PM_EXEC_PATH
    process.env.npm_execpath = '/tmp/pnpm.cjs'

    try {
      const resolution = resolvePackageManager()
      expect(resolution).toEqual({
        name: 'pnpm',
        execPath: '/tmp/pnpm.cjs'
      })
    } finally {
      if (originalOverride === undefined) {
        delete process.env.EXTENSION_JS_PACKAGE_MANAGER
      } else {
        process.env.EXTENSION_JS_PACKAGE_MANAGER = originalOverride
      }

      if (originalOverrideExecPath === undefined) {
        delete process.env.EXTENSION_JS_PM_EXEC_PATH
      } else {
        process.env.EXTENSION_JS_PM_EXEC_PATH = originalOverrideExecPath
      }

      if (originalExecPath === undefined) {
        delete process.env.npm_execpath
      } else {
        process.env.npm_execpath = originalExecPath
      }
    }
  })
})

describe('package-manager projectInstallArgs', () => {
  const writeProject = (dir: string, pkg: Record<string, any>) => {
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg))
  }

  const withTempProject = (
    pkg: Record<string, any>,
    fn: (dir: string) => void
  ) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-pm-args-'))

    try {
      writeProject(dir, pkg)
      fn(dir)
    } finally {
      fs.rmSync(dir, {recursive: true, force: true})
    }
  }

  it('confines pnpm installs to the project dir (G28: no walking up to a foreign workspace)', () => {
    withTempProject({name: 'p', dependencies: {vue: '^3.0.0'}}, (dir) => {
      expect(projectInstallArgs({name: 'pnpm'}, dir)).toEqual([
        '--ignore-workspace'
      ])
    })
  })

  it('does not confine when the project is itself a pnpm workspace root', () => {
    withTempProject({name: 'p'}, (dir) => {
      fs.writeFileSync(
        path.join(dir, 'pnpm-workspace.yaml'),
        'packages:\n  - "packages/*"\n'
      )

      expect(projectInstallArgs({name: 'pnpm'}, dir)).toEqual([])
    })
  })

  it('does not confine when the project uses workspace: specifiers (needs its real workspace)', () => {
    withTempProject(
      {name: 'p', devDependencies: {shared: 'workspace:*'}},
      (dir) => {
        expect(projectInstallArgs({name: 'pnpm'}, dir)).toEqual([])
      }
    )
  })

  it('adds nothing for other package managers', () => {
    withTempProject({name: 'p'}, (dir) => {
      expect(projectInstallArgs({name: 'npm'}, dir)).toEqual([])
      expect(projectInstallArgs({name: 'yarn'}, dir)).toEqual([])
      expect(projectInstallArgs({name: 'bun'}, dir)).toEqual([])
    })
  })
})

describe('package-manager pnpm workspace membership', () => {
  const created: string[] = []

  // The temp root also gets a .git dir so the walk never leaves it, whatever
  // sits above the OS temp folder on the machine running the suite.
  const makeWorkspace = (
    workspaceYaml: string | null,
    memberRel = 'apps/ext'
  ) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-pm-ws-'))
    created.push(root)
    fs.mkdirSync(path.join(root, '.git'))

    if (workspaceYaml !== null) {
      fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), workspaceYaml)
    }

    const member = path.join(root, memberRel)
    fs.mkdirSync(member, {recursive: true})
    fs.writeFileSync(
      path.join(member, 'package.json'),
      JSON.stringify({name: 'ext', dependencies: {vue: '^3.0.0'}})
    )

    return {root, member}
  }

  afterEach(() => {
    for (const dir of created) fs.rmSync(dir, {recursive: true, force: true})
    created.length = 0
  })

  it('finds the workspace root above a member and names the member dir', () => {
    const {root, member} = makeWorkspace('packages: ["apps/*"]\n')
    expect(findPnpmWorkspaceRoot(member)).toBe(root)
    expect(findPnpmWorkspaceMember(member)).toEqual({
      root,
      relativeDir: 'apps/ext'
    })
  })

  it('treats a project holding pnpm-workspace.yaml itself as the root, not a member', () => {
    const {root} = makeWorkspace('packages:\n  - "apps/*"\n')
    expect(findPnpmWorkspaceRoot(root)).toBe(root)
    expect(findPnpmWorkspaceMember(root)).toBeUndefined()
  })

  it('returns nothing when no workspace file exists up to the repo boundary', () => {
    const {member} = makeWorkspace(null)
    expect(findPnpmWorkspaceRoot(member)).toBeUndefined()
    expect(findPnpmWorkspaceMember(member)).toBeUndefined()
  })

  it('stops at a nested .git boundary: a workspace above the repo is foreign', () => {
    const {root} = makeWorkspace('packages: ["**"]\n', 'repo/ext')
    fs.mkdirSync(path.join(root, 'repo', '.git'))
    const project = path.join(root, 'repo', 'ext')
    expect(findPnpmWorkspaceRoot(project)).toBeUndefined()
    expect(findPnpmWorkspaceMember(project)).toBeUndefined()
  })

  it('ignores an ancestor workspace whose package list does not name the project', () => {
    const {root, member} = makeWorkspace('packages: ["packages/*"]\n')
    expect(findPnpmWorkspaceRoot(member)).toBe(root)
    expect(findPnpmWorkspaceMember(member)).toBeUndefined()
  })

  it('reads block-style package lists past other keys, comments and negations', () => {
    const {root} = makeWorkspace(
      'catalog:\n  vue: ^3.0.0\npackages:\n  # apps\n  - "apps/*"\n' +
        '  - \'packages/**\' # libs\n  - "!apps/skip"\nonlyBuiltDependencies: []\n'
    )
    expect(readPnpmWorkspacePackages(root)).toEqual([
      'apps/*',
      'packages/**',
      '!apps/skip'
    ])
  })

  it('detects a member from a zero indent packages list', () => {
    const {root, member} = makeWorkspace('packages:\n- apps/*\n')
    expect(readPnpmWorkspacePackages(root)).toEqual(['apps/*'])
    expect(findPnpmWorkspaceMember(member)).toEqual({
      root,
      relativeDir: 'apps/ext'
    })
  })

  it('unquotes zero indent items in either quote style', () => {
    const {root, member} = makeWorkspace(
      'packages:\n- \'apps/*\'\n- "packages/**"\n'
    )
    expect(readPnpmWorkspacePackages(root)).toEqual(['apps/*', 'packages/**'])
    expect(findPnpmWorkspaceMember(member)?.relativeDir).toBe('apps/ext')
  })

  it('ends a zero indent list at the next top-level key', () => {
    const {root} = makeWorkspace(
      'packages:\n- apps/*\n\ncatalog:\n  vue: ^3.0.0\nonlyBuiltDependencies:\n- esbuild\n'
    )
    expect(readPnpmWorkspacePackages(root)).toEqual(['apps/*'])
  })

  it('skips comment lines inside a zero indent list', () => {
    const {root} = makeWorkspace(
      'packages:\n# apps\n- apps/*\n  # libs\n- packages/* # trailing\n'
    )
    expect(readPnpmWorkspacePackages(root)).toEqual(['apps/*', 'packages/*'])
  })

  it('does not name a dir outside a zero indent list as a member', () => {
    const {root, member} = makeWorkspace('packages:\n- packages/*\n')
    expect(readPnpmWorkspacePackages(root)).toEqual(['packages/*'])
    expect(findPnpmWorkspaceMember(member)).toBeUndefined()
  })

  it('agrees with pnpm about the members of a zero indent list', async (ctx) => {
    // This spec mocks child_process for the install seam, so the real pnpm
    // probe needs the actual module. A missing or slow pnpm skips the case.
    const {spawnSync} =
      await vi.importActual<typeof import('node:child_process')>(
        'node:child_process'
      )
    const {root, member} = makeWorkspace('packages:\n- apps/*\n')
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({name: 'ws-root', private: true})
    )

    fs.mkdirSync(path.join(root, 'packages', 'lib'), {recursive: true})
    fs.writeFileSync(
      path.join(root, 'packages', 'lib', 'package.json'),
      JSON.stringify({name: 'lib'})
    )

    const probe = spawnSync('pnpm', ['ls', '-r', '--depth', '-1', '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000
    })

    if (probe.error || probe.status !== 0) {
      ctx.skip()

      return
    }

    const realRoot = fs.realpathSync(root)
    const listed = (JSON.parse(probe.stdout) as Array<{path: string}>)
      .map((entry) => path.relative(realRoot, fs.realpathSync(entry.path)))
      .map((rel) => rel.split(path.sep).join('/'))
      .filter(Boolean)
      .sort()
    expect(listed).toEqual(['apps/ext'])

    const patterns = readPnpmWorkspacePackages(root)
    expect(isPnpmWorkspaceMemberDir(patterns, 'apps/ext')).toBe(true)
    expect(isPnpmWorkspaceMemberDir(patterns, 'packages/lib')).toBe(false)
    expect(findPnpmWorkspaceMember(member)?.relativeDir).toBe('apps/ext')
  })

  it('matches member dirs the way pnpm globs do', () => {
    const patterns = ['apps/*', 'packages/**', '!apps/skip']
    expect(isPnpmWorkspaceMemberDir(patterns, 'apps/ext')).toBe(true)
    expect(isPnpmWorkspaceMemberDir(patterns, 'apps/ext/nested')).toBe(false)
    expect(isPnpmWorkspaceMemberDir(patterns, 'packages/a/b')).toBe(true)
    expect(isPnpmWorkspaceMemberDir(patterns, 'apps/skip')).toBe(false)
    expect(isPnpmWorkspaceMemberDir(patterns, 'tools/x')).toBe(false)
    expect(isPnpmWorkspaceMemberDir(['./apps/'], 'apps')).toBe(true)
  })

  it('installs a member from the workspace root, filtered to the member', () => {
    const {root, member} = makeWorkspace('packages: ["apps/*"]\n')
    const found = findPnpmWorkspaceMember(member)
    expect(projectInstallTarget({name: 'pnpm'}, member, found)).toEqual({
      cwd: root,
      args: ['--filter', '{apps/ext}...']
    })
  })

  it('keeps confining a non-member pnpm project to its own dir', () => {
    const {member} = makeWorkspace('packages: ["packages/*"]\n')
    const found = findPnpmWorkspaceMember(member)
    expect(projectInstallTarget({name: 'pnpm'}, member, found)).toEqual({
      cwd: member,
      args: ['--ignore-workspace']
    })
  })

  it('leaves other package managers installing in the project dir', () => {
    const {root, member} = makeWorkspace('packages: ["apps/*"]\n')
    const found = {root, relativeDir: 'apps/ext'}
    expect(projectInstallTarget({name: 'npm'}, member, found)).toEqual({
      cwd: member,
      args: []
    })
  })
})

describe('package-manager execInstallCommand', () => {
  beforeEach(() => spawnMock.mockClear())

  it('passes a .cmd command and its args to cross-spawn with no shell option', async () => {
    // A shell would join these into one cmd.exe string, so a member path
    // with metacharacters must stay a single argument.
    const args = ['install', '--filter', '{apps/a b & c}...']
    await execInstallCommand('C:\\path\\to\\pnpm.cmd', args, {
      cwd: process.cwd()
    })

    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [command, spawnArgs, options] = (spawnMock.mock.calls as any)[0]
    expect(command).toBe('C:\\path\\to\\pnpm.cmd')
    expect(spawnArgs).toEqual(args)
    expect(options).not.toHaveProperty('shell')
    expect(options.cwd).toBe(process.cwd())
  })
})

describe('installScriptSuppression: auto-install must not run wild lifecycle scripts', () => {
  afterEach(() => {
    delete process.env.EXTENSION_ALLOW_INSTALL_SCRIPTS
  })

  it.each([
    'npm',
    'pnpm',
    'bun'
  ] as const)('passes --ignore-scripts to %s', (name) => {
    expect(installScriptSuppression({name})).toEqual({
      args: ['--ignore-scripts'],
      env: {}
    })
  })

  it('uses env for yarn (Berry rejects the flag, yarn 1 reads npm_config_*)', () => {
    expect(installScriptSuppression({name: 'yarn'})).toEqual({
      args: [],
      env: {YARN_ENABLE_SCRIPTS: 'false', npm_config_ignore_scripts: 'true'}
    })
  })

  it('adds nothing for deno (deno install already refuses npm lifecycle scripts)', () => {
    expect(installScriptSuppression({name: 'deno'})).toEqual({
      args: [],
      env: {}
    })
  })

  it('suppresses nothing when EXTENSION_ALLOW_INSTALL_SCRIPTS=true', () => {
    process.env.EXTENSION_ALLOW_INSTALL_SCRIPTS = 'true'
    expect(installScriptSuppression({name: 'pnpm'})).toEqual({
      args: [],
      env: {}
    })
  })
})

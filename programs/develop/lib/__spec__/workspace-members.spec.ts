import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  findWorkspaceMember,
  projectInstallTarget,
  resolvePackageManager,
  workspaceManagerOverride
} from '../package-manager'

const created: string[] = []

const makeWorkspace = (
  rootPkg: Record<string, unknown>,
  lockfile?: string,
  memberRel = 'apps/ext'
) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-ws-member-'))
  )
  created.push(root)
  fs.mkdirSync(path.join(root, '.git'))
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({name: 'root', ...rootPkg})
  )

  if (lockfile) fs.writeFileSync(path.join(root, lockfile), '')

  const member = path.join(root, ...memberRel.split('/'))
  fs.mkdirSync(member, {recursive: true})
  fs.writeFileSync(
    path.join(member, 'package.json'),
    JSON.stringify({name: 'ext', dependencies: {react: '^19.0.0'}})
  )

  return {root, member}
}

afterEach(() => {
  for (const dir of created) fs.rmSync(dir, {recursive: true, force: true})
  created.length = 0
})

describe('findWorkspaceMember for package.json workspaces', () => {
  it.each([
    ['npm', 'package-lock.json'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lock']
  ])('names %s from the root lockfile', (manager, lockfile) => {
    const {root, member} = makeWorkspace({workspaces: ['apps/*']}, lockfile)

    expect(findWorkspaceMember(member)).toEqual({
      root,
      relativeDir: 'apps/ext',
      manager
    })
  })

  it('reads the yarn classic object form and the packageManager pin', () => {
    const {root, member} = makeWorkspace({
      workspaces: {packages: ['apps/*'], nohoist: []},
      packageManager: 'yarn@4.5.0'
    })

    expect(findWorkspaceMember(member)).toEqual({
      root,
      relativeDir: 'apps/ext',
      manager: 'yarn'
    })
  })

  it('falls back to npm when the root has no lockfile and no pin', () => {
    const {member} = makeWorkspace({workspaces: ['apps/*']})

    expect(findWorkspaceMember(member)?.manager).toBe('npm')
  })

  it('ignores a package.json list that pnpm would never read', () => {
    const {member} = makeWorkspace({workspaces: ['apps/*']}, 'pnpm-lock.yaml')

    expect(findWorkspaceMember(member)).toBeUndefined()
  })

  it('treats the workspace root itself as a standalone project', () => {
    const {root} = makeWorkspace({workspaces: ['apps/*']}, 'package-lock.json')

    expect(findWorkspaceMember(root)).toBeUndefined()
  })

  it('skips a project the workspace list does not name', () => {
    const {member} = makeWorkspace(
      {workspaces: ['packages/*']},
      'package-lock.json'
    )

    expect(findWorkspaceMember(member)).toBeUndefined()
  })

  it('stops at the project repository boundary', () => {
    const {root} = makeWorkspace(
      {workspaces: ['**']},
      'package-lock.json',
      'repo/ext'
    )
    fs.mkdirSync(path.join(root, 'repo', 'ext', '.git'))

    expect(findWorkspaceMember(path.join(root, 'repo', 'ext'))).toBeUndefined()
  })

  it('keeps the pnpm member answer when pnpm-workspace.yaml exists', () => {
    const {root, member} = makeWorkspace({}, 'pnpm-lock.yaml')
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages: ["apps/*"]\n'
    )

    expect(findWorkspaceMember(member)).toEqual({
      root,
      relativeDir: 'apps/ext',
      manager: 'pnpm'
    })
  })
})

describe('installing a package.json workspace member', () => {
  it.each([
    ['npm', 'package-lock.json'],
    ['yarn', 'yarn.lock'],
    ['bun', 'bun.lock']
  ])('runs %s from the workspace root', (manager, lockfile) => {
    const {root, member} = makeWorkspace({workspaces: ['apps/*']}, lockfile)
    const found = findWorkspaceMember(member)
    const pm =
      workspaceManagerOverride(found as NonNullable<typeof found>) ||
      resolvePackageManager({cwd: root})

    expect(pm.name).toBe(manager)
    expect(projectInstallTarget(pm, member, found)).toEqual({
      cwd: root,
      args: []
    })
  })

  it('uses the workspace manager when the root has no lockfile', () => {
    const {member} = makeWorkspace({workspaces: ['apps/*']})
    const found = findWorkspaceMember(member)

    expect(
      workspaceManagerOverride(found as NonNullable<typeof found>)?.name
    ).toBe('npm')
  })
})

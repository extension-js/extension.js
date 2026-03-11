import fs from 'node:fs'
import path from 'node:path'
import type {ManifestSummary} from './manifest-summary'

type PackageJson = {
  packageManager?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  workspaces?: unknown
}

export type PackageManagerName = 'pnpm' | 'yarn' | 'npm' | 'bun' | 'unknown'
export type FrameworkPrimary =
  | 'react'
  | 'preact'
  | 'vue'
  | 'svelte'
  | 'solid'
  | 'angular'
  | 'unknown'
export type PermissionBucket = '0' | '1_3' | '4_10' | '11_plus'
export type ManifestSurface =
  | 'background_only'
  | 'content_scripts'
  | 'action_popup'
  | 'devtools'
  | 'multi_surface'
  | 'other'
  | 'unknown'

export type ProjectProfile = {
  package_manager: PackageManagerName
  framework_primary: FrameworkPrimary
  has_typescript: boolean
  is_monorepo: boolean
  has_next_dependency: boolean
  has_turbo_dependency: boolean
  manifest_surface: ManifestSurface
  permissions_bucket: PermissionBucket
  host_permissions_bucket: PermissionBucket
}

function safeReadJson(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

function findNearestPackageJson(startPath: string): string | null {
  let current = path.resolve(startPath)

  for (let i = 0; i < 6; i += 1) {
    const candidate = path.join(current, 'package.json')
    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(current)
    if (parent === current) break

    current = parent
  }

  return null
}

function getDependencies(pkg: PackageJson): Record<string, string> {
  return {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
    ...(pkg.peerDependencies || {})
  }
}

function hasDependency(pkg: PackageJson, dependencyId: string): boolean {
  const deps = getDependencies(pkg)
  return Boolean(deps[dependencyId])
}

function detectPackageManager(
  projectRoot: string,
  pkg: PackageJson
): PackageManagerName {
  const declared = String(pkg.packageManager || '')
    .trim()
    .toLowerCase()

  if (declared.startsWith('pnpm@')) return 'pnpm'
  if (declared.startsWith('yarn@')) return 'yarn'
  if (declared.startsWith('npm@')) return 'npm'
  if (declared.startsWith('bun@')) return 'bun'

  if (fs.existsSync(path.join(projectRoot, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(projectRoot, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(projectRoot, 'package-lock.json'))) return 'npm'
  if (fs.existsSync(path.join(projectRoot, 'bun.lockb'))) return 'bun'
  if (fs.existsSync(path.join(projectRoot, 'bun.lock'))) return 'bun'

  const userAgent = String(
    process.env.npm_config_user_agent || ''
  ).toLowerCase()
  if (userAgent.includes('pnpm')) return 'pnpm'
  if (userAgent.includes('yarn')) return 'yarn'
  if (userAgent.includes('bun')) return 'bun'
  if (userAgent.includes('npm')) return 'npm'

  return 'unknown'
}

function detectFrameworkPrimary(pkg: PackageJson): FrameworkPrimary {
  if (hasDependency(pkg, 'preact')) return 'preact'
  if (hasDependency(pkg, 'react')) return 'react'
  if (hasDependency(pkg, 'vue')) return 'vue'
  if (hasDependency(pkg, 'svelte')) return 'svelte'
  if (hasDependency(pkg, 'solid-js')) return 'solid'
  if (hasDependency(pkg, '@angular/core')) return 'angular'
  return 'unknown'
}

function detectMonorepo(projectRoot: string, pkg: PackageJson): boolean {
  return Boolean(
    pkg.workspaces ||
      fs.existsSync(path.join(projectRoot, 'pnpm-workspace.yaml')) ||
      fs.existsSync(path.join(projectRoot, 'turbo.json'))
  )
}

function toPermissionBucket(count: number): PermissionBucket {
  if (count <= 0) return '0'
  if (count <= 3) return '1_3'
  if (count <= 10) return '4_10'
  return '11_plus'
}

function toManifestSurface(summary?: ManifestSummary | null): ManifestSurface {
  if (!summary) return 'unknown'

  const surfaces = [
    summary.has_action_popup,
    summary.has_devtools_page,
    summary.content_scripts_count > 0,
    summary.background_type !== 'none'
  ].filter(Boolean).length

  if (surfaces > 1) return 'multi_surface'
  if (summary.has_action_popup) return 'action_popup'
  if (summary.has_devtools_page) return 'devtools'
  if (summary.content_scripts_count > 0) return 'content_scripts'
  if (summary.background_type !== 'none') return 'background_only'
  return 'other'
}

export function collectProjectProfile(
  projectRoot: string,
  summary?: ManifestSummary | null
): ProjectProfile | null {
  const packageJsonPath = findNearestPackageJson(projectRoot)
  const pkg = (packageJsonPath
    ? (safeReadJson(packageJsonPath) as PackageJson | null)
    : null) || {
    dependencies: {},
    devDependencies: {},
    peerDependencies: {}
  }

  const resolvedRoot = packageJsonPath
    ? path.dirname(packageJsonPath)
    : projectRoot
  const hasPackageSignals = Boolean(packageJsonPath)
  const hasManifestSignals = Boolean(summary)

  if (!hasPackageSignals && !hasManifestSignals) return null

  return {
    package_manager: detectPackageManager(resolvedRoot, pkg),
    framework_primary: detectFrameworkPrimary(pkg),
    has_typescript:
      hasDependency(pkg, 'typescript') ||
      fs.existsSync(path.join(resolvedRoot, 'tsconfig.json')),
    is_monorepo: detectMonorepo(resolvedRoot, pkg),
    has_next_dependency: hasDependency(pkg, 'next'),
    has_turbo_dependency:
      hasDependency(pkg, 'turbo') ||
      fs.existsSync(path.join(resolvedRoot, 'turbo.json')),
    manifest_surface: toManifestSurface(summary),
    permissions_bucket: toPermissionBucket(summary?.permissions_count || 0),
    host_permissions_bucket: toPermissionBucket(
      summary?.host_permissions_count || 0
    )
  }
}

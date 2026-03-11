import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {collectProjectProfile} from '../project-profile'

it('collects a coarse privacy-safe project profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-'))

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        packageManager: 'pnpm@10.19.0',
        workspaces: ['packages/*'],
        dependencies: {
          next: '16.0.0',
          react: '19.0.0',
          turbo: '2.0.0'
        },
        devDependencies: {
          typescript: '5.9.0'
        }
      },
      null,
      2
    )
  )
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0')
  fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}')

  const profile = collectProjectProfile(root, {
    mv: 3,
    permissions_count: 2,
    optional_permissions_count: 0,
    host_permissions_count: 1,
    uses_all_urls: false,
    uses_declarative_net_request: false,
    background_type: 'service_worker',
    content_scripts_count: 2,
    has_devtools_page: false,
    has_action_popup: true
  })

  expect(profile).toEqual({
    package_manager: 'pnpm',
    framework_primary: 'react',
    has_typescript: true,
    is_monorepo: true,
    has_next_dependency: true,
    has_turbo_dependency: true,
    manifest_surface: 'multi_surface',
    permissions_bucket: '1_3',
    host_permissions_bucket: '1_3'
  })
})

it('returns null when no package or manifest signals are available', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extjs-profile-empty-'))
  expect(collectProjectProfile(root)).toBeNull()
})

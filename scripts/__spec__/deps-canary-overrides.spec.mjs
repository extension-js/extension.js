import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyOverrides,
  compareVersions,
  LEGS,
  planOverrides,
  readLockedVersions,
  renderTable
} from '../deps-canary-overrides.mjs'

test('compareVersions orders releases and prereleases by semver precedence', () => {
  assert.equal(compareVersions('2.2.3', '2.2.3'), 0)
  assert.ok(compareVersions('2.2.4', '2.2.3') > 0)
  assert.ok(
    compareVersions('2.2.4-canary-1e09fb1f-20260913172312', '2.2.3') > 0
  )

  assert.ok(
    compareVersions('2.2.4-canary-1e09fb1f-20260913172312', '2.2.4') < 0
  )

  assert.ok(compareVersions('2.2.0-rc.0', '2.2.3') < 0)
  assert.ok(compareVersions('11.0.0-rc.2', '10.27.3') > 0)
  assert.ok(compareVersions('7.1.0-dev.20260913.1', '7.0.2') > 0)
  assert.ok(compareVersions('1.0.0-rc.2', '1.0.0-beta.3') > 0)
  assert.ok(compareVersions('1.0.0-rc.10', '1.0.0-rc.9') > 0)
  assert.ok(compareVersions('5.0.0-next.272', '5.55.9') < 0)
})

test('readLockedVersions keeps the highest pin per package', () => {
  const lock = [
    "lockfileVersion: '9.0'",
    '',
    'overrides:',
    '  postcss-selector-parser@7: 7.1.5',
    '  typescript@5: 5.9.3',
    '',
    'importers:',
    '',
    '  .:',
    '    devDependencies:',
    '      typescript:',
    '        specifier: 7.0.2',
    '        version: 7.0.2',
    '',
    'packages:',
    '',
    "  '@rspack/core@2.2.3':",
    '    resolution: {integrity: sha512-x}',
    "  '@rspack/core@2.2.3(@swc/helpers@0.5.23)':",
    '  typescript@7.0.2:',
    '  typescript@5.9.3:',
    '  react@19.2.3:',
    '  react-dom@19.2.3(react@19.2.3):',
    "  '@vue/compiler-sfc@3.5.26':"
  ].join('\n')
  const locked = readLockedVersions(lock)
  assert.equal(locked.get('@rspack/core'), '2.2.3')
  assert.equal(locked.get('typescript'), '7.0.2')
  assert.equal(locked.get('react'), '19.2.3')
  assert.equal(locked.get('react-dom'), '19.2.3')
  assert.equal(locked.get('@vue/compiler-sfc'), '3.5.26')
  assert.equal(locked.get('missing'), undefined)
})

test('planOverrides only overrides tags that are newer than the lock', () => {
  const locked = new Map([
    ['@rspack/core', '2.2.3'],
    ['@rspack/dev-server', '2.1.0'],
    ['typescript', '7.0.2'],
    ['preact', '10.27.3'],
    ['react', '19.2.3']
  ])
  const distTags = {
    '@rspack-canary/core': {latest: '2.2.4-canary-1e09fb1f-20260913172312'},
    '@rspack/dev-server': {rc: '2.0.0-rc.3', latest: '2.2.1'},
    typescript: {next: '7.1.0-dev.20260913.1', rc: '7.0.1-rc'},
    preact: {rc: '11.0.0-rc.2', beta: '11.0.0-beta.2'},
    react: {
      next: '19.3.0-canary-d5736f09-20260507',
      canary: '19.3.0-canary-019019be-20260911'
    }
  }
  const rows = planOverrides(
    [
      {name: '@rspack/core', from: '@rspack-canary/core', tags: ['latest']},
      {name: '@rspack/dev-server', tags: ['rc', 'beta']},
      {name: 'typescript', tags: ['rc', 'next']},
      {name: 'preact', tags: ['rc', 'beta']},
      {name: 'react', tags: ['canary', 'next']},
      {name: 'solid-js', tags: ['next']}
    ],
    locked,
    (name) => {
      if (!distTags[name]) throw new Error('E404')

      return distTags[name]
    }
  )

  const byName = Object.fromEntries(rows.map((row) => [row.name, row]))
  assert.equal(byName['@rspack/core'].status, 'override')
  assert.equal(
    byName['@rspack/core'].spec,
    'npm:@rspack-canary/core@2.2.4-canary-1e09fb1f-20260913172312'
  )

  assert.equal(byName['@rspack/dev-server'].status, 'skip')
  assert.match(byName['@rspack/dev-server'].reason, /rc=2\.0\.0-rc\.3/)
  assert.equal(byName.typescript.status, 'override')
  assert.equal(byName.typescript.tag, 'next')
  assert.equal(byName.typescript.spec, '7.1.0-dev.20260913.1')
  assert.equal(byName.preact.status, 'override')
  assert.equal(byName.preact.tag, 'rc')
  // Tag order is the preference, the rc that fell behind the pin is skipped.
  assert.equal(byName.react.tag, 'canary')
  assert.equal(byName.react.spec, '19.3.0-canary-019019be-20260911')
  assert.equal(byName['solid-js'].status, 'skip')
  assert.equal(byName['solid-js'].reason, 'not in the lockfile')
})

test('applyOverrides merges into the existing pnpm.overrides block', () => {
  const before = {
    name: 'x',
    pnpm: {overrides: {postcss: '^8.5.23'}}
  }
  const rows = [
    {name: 'typescript', status: 'override', spec: '7.1.0-dev.1'},
    {name: 'react', status: 'skip'}
  ]
  const after = applyOverrides(before, rows)
  assert.deepEqual(after.pnpm.overrides, {
    postcss: '^8.5.23',
    typescript: '7.1.0-dev.1'
  })

  assert.deepEqual(before.pnpm.overrides, {postcss: '^8.5.23'})
})

test('every leg is non-empty and renders a table', () => {
  for (const [leg, candidates] of Object.entries(LEGS)) {
    assert.ok(candidates.length > 0, `${leg} has candidates`)
    const rows = candidates.map((candidate) => ({
      ...candidate,
      source: candidate.from || candidate.name,
      status: 'skip',
      reason: 'test'
    }))
    const table = renderTable(leg, rows)
    assert.match(table, new RegExp(`### Dependency canary: ${leg}`))
    assert.equal(table.split('\n').length, 4 + candidates.length)
  }
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {SUPPORTED_BROWSERS, SUPPORTED_PACKAGE_MANAGERS} from '../constants'
import {OPTIONAL_DEPENDENCY_CONTRACTS} from '../optional-deps-contracts'

const ROOT_README = path.join(__dirname, '..', '..', '..', '..', 'README.md')

// The runtimes the CLI itself executes on, which is a different question from
// the package manager that installs it.
const SUPPORTED_RUNTIMES = ['node', 'deno', 'bun'] as const
const SUPPORTED_UI_FRAMEWORKS = ['react', 'preact', 'vue', 'svelte'] as const

describe('supported surface', () => {
  it('pins the supported package managers', () => {
    expect(SUPPORTED_PACKAGE_MANAGERS).toEqual([
      'npm',
      'pnpm',
      'yarn',
      'bun',
      'deno'
    ])
  })

  it('backs every supported framework and preprocessor with an optional-deps contract', () => {
    // Preact compiles with the project's own preact and no tooling package,
    // so it has nothing for a contract to verify.
    const frameworkContracts: Record<string, string | undefined> = {
      react: 'react-refresh',
      preact: undefined,
      vue: 'vue',
      svelte: 'svelte'
    }

    for (const framework of SUPPORTED_UI_FRAMEWORKS) {
      const contract = frameworkContracts[framework]
      if (!contract) continue

      expect(
        OPTIONAL_DEPENDENCY_CONTRACTS,
        `framework '${framework}' has no optional-deps contract`
      ).toHaveProperty(contract)
    }

    expect(OPTIONAL_DEPENDENCY_CONTRACTS).not.toHaveProperty('preact-refresh')

    for (const contractId of ['sass', 'less', 'postcss']) {
      expect(OPTIONAL_DEPENDENCY_CONTRACTS).toHaveProperty(contractId)
    }
  })

  it('README enumerates every supported package manager', () => {
    const readme = fs.readFileSync(ROOT_README, 'utf-8')
    const worksWithLine = readme
      .split('\n')
      .find((line) => line.startsWith('Works with'))
    expect(worksWithLine, 'README lost its "Works with" line').toBeTruthy()

    for (const pm of SUPPORTED_PACKAGE_MANAGERS) {
      expect(worksWithLine).toContain(`\`${pm}\``)
    }
  })

  // A package manager that installs the CLI is not a runtime that executes it,
  // and the README claimed all five as one undifferentiated list until 2026-09.
  it('README separates the runtimes from the package managers', () => {
    const readme = fs.readFileSync(ROOT_README, 'utf-8')

    expect(readme, 'README lost its "## Runtimes" section').toContain(
      '## Runtimes'
    )

    const runtimeLabels: Record<(typeof SUPPORTED_RUNTIMES)[number], string> = {
      node: 'Node.js',
      deno: 'Deno',
      bun: 'Bun'
    }

    for (const runtime of SUPPORTED_RUNTIMES) {
      expect(readme, `README never lists the ${runtime} runtime`).toContain(
        runtimeLabels[runtime]
      )
    }

    expect(
      readme,
      'README must keep the package manager table separate from the runtime ' +
        'table, because installing the CLI and executing it are two claims'
    ).toContain('Which runtime the CLI then executes on is a separate question')
  })

  it('README enumerates every supported UI framework', () => {
    const readme = fs.readFileSync(ROOT_README, 'utf-8').toLowerCase()

    for (const framework of SUPPORTED_UI_FRAMEWORKS) {
      expect(readme, `README never mentions ${framework}`).toContain(framework)
    }
  })

  it('README browser table covers the flagship browsers and engine families', () => {
    const readme = fs.readFileSync(ROOT_README, 'utf-8')

    for (const label of [
      'Google Chrome',
      'Microsoft Edge',
      'Mozilla Firefox',
      'Apple Safari',
      'Chromium-based',
      'Gecko-based'
    ]) {
      expect(readme).toContain(label)
    }

    for (const flagship of ['chrome', 'edge', 'firefox']) {
      expect(SUPPORTED_BROWSERS).toContain(flagship)
    }
  })
})

import * as fs from 'node:fs'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  SUPPORTED_BROWSERS,
  SUPPORTED_CSS_TECH,
  SUPPORTED_PACKAGE_MANAGERS,
  SUPPORTED_UI_FRAMEWORKS
} from '../constants'
import {OPTIONAL_DEPENDENCY_CONTRACTS} from '../optional-deps-contracts'

const ROOT_README = path.join(__dirname, '..', '..', '..', '..', 'README.md')

describe('supported surface', () => {
  it('pins the canonical supported lists', () => {
    expect(SUPPORTED_PACKAGE_MANAGERS).toEqual([
      'npm',
      'pnpm',
      'yarn',
      'bun',
      'deno'
    ])
    expect(SUPPORTED_UI_FRAMEWORKS).toEqual([
      'react',
      'preact',
      'vue',
      'svelte'
    ])
    expect(SUPPORTED_CSS_TECH).toEqual([
      'css',
      'css-modules',
      'sass',
      'less',
      'postcss',
      'tailwind'
    ])
  })

  it('backs every supported framework and preprocessor with an optional-deps contract', () => {
    const frameworkContracts: Record<string, string> = {
      react: 'react-refresh',
      preact: 'preact-refresh',
      vue: 'vue',
      svelte: 'svelte'
    }
    for (const framework of SUPPORTED_UI_FRAMEWORKS) {
      expect(
        OPTIONAL_DEPENDENCY_CONTRACTS,
        `framework '${framework}' has no optional-deps contract`
      ).toHaveProperty(frameworkContracts[framework])
    }
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

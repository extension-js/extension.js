import * as path from 'node:path'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {isUsingLess} from '../../css-tools/less'
import {isUsingPostCss} from '../../css-tools/postcss'
import {isUsingSass} from '../../css-tools/sass'
import {getTailwindConfigFile, isUsingTailwind} from '../../css-tools/tailwind'
import {cssProjects} from '../helpers/css-project'

const makeProject = cssProjects()

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function project(devDependencies: Record<string, string>) {
  return makeProject({
    'package.json': JSON.stringify({name: 'css-fixture', devDependencies})
  })
}

// Each detector says once per process that the build uses its tool, and only
// in author mode. This file is the first caller of each one in its worker.
describe('the integration debug line', () => {
  it.each([
    ['Tailwind', isUsingTailwind, {tailwindcss: '^4.0.0'}],
    ['SASS', isUsingSass, {sass: '^1.0.0'}],
    ['LESS', isUsingLess, {less: '^4.0.0'}],
    ['PostCSS', isUsingPostCss, {postcss: '^8.0.0'}]
  ] as Array<
    [string, (root: string) => boolean, Record<string, string>]
  >)('is printed once for %s', (name, detect, deps) => {
    vi.stubEnv('EXTENSION_AUTHOR_MODE', 'true')
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const root = project(deps)

    expect([detect(root), detect(root), detect(project({}))]).toEqual([
      true,
      true,
      false
    ])

    expect(log.mock.calls).toEqual([[`··· integration use=${name}`]])
  })
})

describe('getTailwindConfigFile', () => {
  it.each([
    [['tailwind.config.js'], 'tailwind.config.js'],
    [['tailwind.config.js', 'tailwind.config.ts'], 'tailwind.config.ts'],
    [['tailwind.config.cjs', 'tailwind.config.mjs'], 'tailwind.config.mjs'],
    [[], undefined]
  ])('finds %j as %s', (files, expected) => {
    const root = makeProject(
      Object.fromEntries(files.map((file) => [file, 'module.exports = {}']))
    )

    expect(getTailwindConfigFile(root)).toBe(
      expected === undefined ? undefined : path.join(root, expected)
    )
  })
})

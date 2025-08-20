import * as fs from 'fs'
import * as path from 'path'
import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest'

// Mock external plugins/loaders that may not be installed in the test env
vi.mock('@rspack/plugin-react-refresh', () => ({default: class {}}))
vi.mock('vue-loader', () => ({VueLoaderPlugin: class {}}))
vi.mock('@rspack/plugin-preact-refresh', () => ({default: class {}}))

describe('framework detectors', () => {
  const tmp = path.join(__dirname, '.tmp-detectors')

  beforeEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
    fs.mkdirSync(tmp, {recursive: true})
  })

  afterEach(() => {
    fs.rmSync(tmp, {recursive: true, force: true})
  })

  it('detects React via dependencies and sets aliases/plugins', async () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({dependencies: {react: '18.0.0'}})
    )

    // Silence process.exit paths in maybeUseReact if they try to install deps
    vi.spyOn(process, 'exit').mockImplementationOnce((() => {
      throw new Error('exit')
    }) as any)

    const {isUsingReact, maybeUseReact} = await import('../js-tools/react')

    expect(isUsingReact(tmp)).toBe(true)

    // Mock require.resolve to not throw (pretend deps exist)
    const reqResolve = vi
      .spyOn(require, 'resolve' as any)
      .mockImplementation((id: string) => id)

    const cfg = await maybeUseReact(tmp)
    expect(cfg?.plugins?.length).toBeGreaterThan(0)
    expect(typeof cfg?.alias).toBe('object')

    reqResolve.mockRestore()
  })

  it('detects Vue via dependencies and yields loader + plugin', async () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({devDependencies: {vue: '3.0.0'}})
    )

    // Stub require.resolve for vue-loader
    const reqResolve = vi
      .spyOn(require, 'resolve' as any)
      .mockImplementation((id: string) => id)

    const {isUsingVue, maybeUseVue} = await import('../js-tools/vue')
    expect(isUsingVue(tmp)).toBe(true)
    const cfg = await maybeUseVue(tmp)
    expect(Array.isArray(cfg?.loaders)).toBe(true)
    expect(Array.isArray(cfg?.plugins)).toBe(true)

    reqResolve.mockRestore()
  })

  it('detects Svelte via dependencies and yields loader', async () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({dependencies: {svelte: '4.0.0'}})
    )

    // Stub require.resolve for svelte-loader
    const reqResolve = vi
      .spyOn(require, 'resolve' as any)
      .mockImplementation((id: string) => id)

    const {isUsingSvelte, maybeUseSvelte} = await import('../js-tools/svelte')
    expect(isUsingSvelte(tmp)).toBe(true)
    const cfg = await maybeUseSvelte(tmp, 'development' as any)
    expect(Array.isArray(cfg?.loaders)).toBe(true)

    reqResolve.mockRestore()
  })

  it('detects Preact via dependencies and yields plugin + aliases', async () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({dependencies: {preact: '10.0.0'}})
    )

    // Stub require.resolve for preact refresh plugin
    const reqResolve = vi
      .spyOn(require, 'resolve' as any)
      .mockImplementation((id: string) => id)

    const {isUsingPreact, maybeUsePreact} = await import('../js-tools/preact')
    expect(isUsingPreact(tmp)).toBe(true)
    const cfg = await maybeUsePreact(tmp)
    expect(cfg?.plugins?.length).toBeGreaterThan(0)
    expect(cfg?.alias?.react).toBe('preact/compat')

    reqResolve.mockRestore()
  })

  it('detects TypeScript and returns proper tsconfig defaults and flags', async () => {
    fs.writeFileSync(
      path.join(tmp, 'package.json'),
      JSON.stringify({devDependencies: {typescript: '5.0.0'}})
    )
    fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({}))

    const {
      isUsingTypeScript,
      defaultTypeScriptConfig,
      getUserTypeScriptConfigFile,
      getTypeScriptConfigOverrides
    } = await import('../js-tools/typescript')

    expect(isUsingTypeScript(tmp)).toBe(true)
    expect(getUserTypeScriptConfigFile(tmp)).toBe(
      path.join(tmp, 'tsconfig.json')
    )
    const defaults = defaultTypeScriptConfig(tmp)
    expect(defaults.compilerOptions.jsx).toMatch(/react-jsx|preserve/)
    const overrides = getTypeScriptConfigOverrides({mode: 'development'} as any)
    expect(overrides.compilerOptions.noEmit).toBe(true)
  })
})

import {createRequire} from 'node:module'
import * as path from 'node:path'
import {describe, expect, it} from 'vitest'
import {solidBabelOptions} from '../../js-tools/solid'

// The engine's own copies, the ones the solid contract hands a project.
const requireFromEngine = createRequire(
  path.resolve(__dirname, '..', '..', '..', 'package.json')
)
const solidPreset = requireFromEngine.resolve('babel-preset-solid')
const typescriptPreset = requireFromEngine.resolve('@babel/preset-typescript')
const babel = requireFromEngine('@babel/core') as typeof import('@babel/core')

const counterTsx = `
import {createSignal} from 'solid-js'

type Props = {label: string}

export function Counter(props: Props) {
  const [count, setCount] = createSignal<number>(0)

  return (
    <button onClick={() => setCount(count() + 1)}>
      {props.label} {count()}
    </button>
  )
}
`

describe('the Solid Babel pass the engine configures', () => {
  it('compiles a .tsx component with Solid, types gone, JSX gone, nothing left for a JSX runtime', async () => {
    const result = await babel.transformAsync(counterTsx, {
      filename: '/project/Counter.tsx',
      ...solidBabelOptions({
        solidPreset,
        typescriptPreset,
        typescript: true,
        development: false
      })
    })
    const code = result?.code || ''

    // Solid's compiler output: a cloned template and an insert for the
    // signal read, which is what keeps `{count()}` reactive.
    expect(code).toContain('solid-js/web')
    expect(code).toMatch(/_\$template\(`<button> `\)/)
    // The accessor itself is handed to insert, not its value, so the DOM
    // follows the signal. The generic JSX runtime read it once.
    expect(code).toMatch(/_\$insert\(_el\$, count, null\)/)

    expect(code).not.toMatch(/<button\s+onClick/)
    expect(code).not.toContain('</button>')
    expect(code).not.toMatch(/\bjsx\(/)
    expect(code).not.toContain('jsx-runtime')
    expect(code).not.toContain('type Props')
    expect(code).not.toContain('createSignal<number>')
    expect(result?.map).toBeTruthy()
  })

  it('compiles a .jsx file without the TypeScript preset', async () => {
    const result = await babel.transformAsync(
      counterTsx
        .replace('type Props = {label: string}\n', '')
        .replace('props: Props', 'props')
        .replace('createSignal<number>', 'createSignal'),
      {
        filename: '/project/Counter.jsx',
        ...solidBabelOptions({
          solidPreset,
          typescriptPreset,
          typescript: false,
          development: true
        })
      }
    )

    expect(result?.code).toContain('solid-js/web')
    expect(result?.code).toMatch(/_\$insert\(_el\$, count, null\)/)
    expect(result?.code).not.toMatch(/<button\s+onClick/)
  })
})

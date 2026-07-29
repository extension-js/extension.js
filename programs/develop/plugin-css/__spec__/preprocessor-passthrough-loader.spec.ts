import {describe, expect, it} from 'vitest'
import preprocessorPassthroughLoader from '../preprocessor-passthrough-loader'

function run(resourcePath: string, source: string) {
  const warnings: Error[] = []
  const result = preprocessorPassthroughLoader.call(
    {resourcePath, emitWarning: (w: Error) => warnings.push(w)} as any,
    source
  )
  return {result, warnings}
}

describe('preprocessor-passthrough-loader', () => {
  it('ships SCSS verbatim with an install-sass warning', () => {
    const source = '$badge-bg: red;\n.badge { background: $badge-bg; }'
    const {result, warnings} = run('/project/popup/styles.scss', source)
    expect(result).toBe(source)
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/shipped uncompiled/)
    expect(String(warnings[0])).toMatch(/The sass package isn't installed/)
    expect(String(warnings[0])).toMatch(/npm install --save-dev sass/)
  })

  it('ships .sass verbatim with an install-sass warning', () => {
    const {result, warnings} = run('/project/styles.sass', '.a\n  color: red')
    expect(result).toBe('.a\n  color: red')
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/The sass package isn't installed/)
  })

  it('ships LESS verbatim with an install-less warning', () => {
    const source = '@badge-bg: red;\n.badge { background: @badge-bg; }'
    const {result, warnings} = run('/project/content/styles.less', source)
    expect(result).toBe(source)
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/shipped uncompiled/)
    expect(String(warnings[0])).toMatch(/The less package isn't installed/)
    expect(String(warnings[0])).toMatch(/npm install --save-dev less/)
  })
})

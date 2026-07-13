import {describe, it, expect} from 'vitest'
import preprocessorPassthroughLoader from '../preprocessor-passthrough-loader'

// Regression (bug 26): a project shipping .scss/.less sources without the
// matching compiler installed used to emit the RAW preprocessor source as
// .css with zero warnings — the build reported Success while every browser
// treated the output as broken CSS. The passthrough loader keeps the
// Chrome-parity ship-verbatim behavior but makes it loud.

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
    expect(String(warnings[0])).toMatch(/UNCOMPILED/)
    expect(String(warnings[0])).toMatch(/"sass"/)
    expect(String(warnings[0])).toMatch(/npm install --save-dev sass/)
  })

  it('ships .sass verbatim with an install-sass warning', () => {
    const {result, warnings} = run('/project/styles.sass', '.a\n  color: red')
    expect(result).toBe('.a\n  color: red')
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/"sass"/)
  })

  it('ships LESS verbatim with an install-less warning', () => {
    const source = '@badge-bg: red;\n.badge { background: @badge-bg; }'
    const {result, warnings} = run('/project/content/styles.less', source)
    expect(result).toBe(source)
    expect(warnings.length).toBe(1)
    expect(String(warnings[0])).toMatch(/UNCOMPILED/)
    expect(String(warnings[0])).toMatch(/"less"/)
    expect(String(warnings[0])).toMatch(/npm install --save-dev less/)
  })
})

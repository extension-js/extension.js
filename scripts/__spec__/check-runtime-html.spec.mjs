import assert from 'node:assert/strict'
import fs from 'node:fs'
import {test} from 'node:test'
import {
  findHtmlAssignments,
  isRuntimeSource,
  runtimeFiles
} from '../check-runtime-html.mjs'

test('flags the plain property assignment', () => {
  const hits = findHtmlAssignments('el.innerHTML = markup')

  assert.equal(hits.length, 1)
  assert.equal(hits[0].line, 1)
  assert.equal(hits[0].rule, 'property assignment')
})

test('flags the computed and object-literal forms', () => {
  assert.equal(findHtmlAssignments("el['innerHTML'] = x").length, 1)
  assert.equal(findHtmlAssignments('el["outerHTML"] = x').length, 1)
  assert.equal(
    findHtmlAssignments('Object.assign(el, {innerHTML: x})').length,
    1
  )
})

test('leaves reads, comparisons and prose alone', () => {
  assert.deepEqual(findHtmlAssignments("if ('innerHTML' in el) return"), [])
  assert.deepEqual(findHtmlAssignments('const html = el.innerHTML'), [])
  assert.deepEqual(findHtmlAssignments('if (el.innerHTML === x) return'), [])
  assert.deepEqual(
    findHtmlAssignments('// the compiler needs innerHTML, so it is skipped'),
    []
  )

  assert.deepEqual(
    findHtmlAssignments('<div dangerouslySetInnerHTML={html} />'),
    []
  )
})

test('scopes the scan to shipped runtime source', () => {
  assert.ok(isRuntimeSource('programs/develop/plugin-reload/index.ts'))
  assert.ok(
    isRuntimeSource(
      'programs/develop/plugin-web-extension/feature-scripts/steps/add-content-script-wrapper/main-world-bridge.js'
    )
  )

  assert.ok(!isRuntimeSource('programs/develop/lib/__spec__/thing.spec.ts'))
  assert.ok(!isRuntimeSource('programs/develop/dist/module.mjs'))
  assert.ok(!isRuntimeSource('programs/create/templates/javascript/src/x.js'))
  assert.ok(!isRuntimeSource('programs/develop/README.md'))
})

test('the shipped runtime carries no innerHTML assignment today', () => {
  const offenders = []

  for (const file of runtimeFiles()) {
    const text = fs.readFileSync(file, 'utf8')

    for (const hit of findHtmlAssignments(text)) {
      offenders.push(`${file}:${hit.line}`)
    }
  }

  assert.deepEqual(offenders, [])
})

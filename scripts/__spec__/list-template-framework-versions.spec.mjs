import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {test} from 'node:test'
import {fileURLToPath} from 'node:url'
import {listFrameworkVersions} from '../list-template-framework-versions.mjs'

const script = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../list-template-framework-versions.mjs'
)

/**
 * @param {string} root
 * @param {string} name
 * @param {Record<string, string>} dependencies
 * @param {Record<string, string>} installed
 */
function template(root, name, dependencies, installed) {
  const dir = path.join(root, name)
  fs.mkdirSync(dir, {recursive: true})
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({name, dependencies})
  )

  for (const [dependency, version] of Object.entries(installed)) {
    const dependencyDir = path.join(dir, 'node_modules', dependency)
    fs.mkdirSync(dependencyDir, {recursive: true})
    fs.writeFileSync(
      path.join(dependencyDir, 'package.json'),
      JSON.stringify({name: dependency, version})
    )
  }
}

function templates() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'extjs-template-versions-')
  )

  template(root, 'svelte', {svelte: '^5.15.0'}, {svelte: '5.59.1'})
  template(root, 'newtab-svelte', {svelte: '^5.15.0'}, {svelte: '5.59.1'})
  template(root, 'action-svelte', {svelte: '5.58.0'}, {svelte: '5.58.0'})
  template(root, 'vue', {vue: '^3.5.0', sass: '1.0.0'}, {})
  template(root, 'javascript', {}, {})
  fs.writeFileSync(path.join(root, 'dirname.ts'), '')

  return root
}

test('groups the templates under each version a framework resolved to', () => {
  const root = templates()

  try {
    assert.deepEqual(listFrameworkVersions(root), [
      'svelte 5.58.0 (declared 5.58.0): action-svelte',
      'svelte 5.59.1 (declared ^5.15.0): newtab-svelte, svelte',
      'vue not installed (declared ^3.5.0): vue'
    ])
  } finally {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

test('prints the lines and writes them to the step summary', () => {
  const root = templates()
  const summary = path.join(root, 'summary.md')

  try {
    const run = spawnSync(process.execPath, [script, root], {
      encoding: 'utf8',
      env: {...process.env, GITHUB_STEP_SUMMARY: summary}
    })

    assert.equal(run.status, 0, run.stderr)
    assert.match(
      run.stdout,
      /^ {2}svelte 5\.59\.1 \(declared \^5\.15\.0\): newtab-svelte, svelte$/m
    )

    assert.match(
      fs.readFileSync(summary, 'utf8'),
      /^- svelte 5\.59\.1 \(declared \^5\.15\.0\): newtab-svelte, svelte$/m
    )
  } finally {
    fs.rmSync(root, {recursive: true, force: true})
  }
})

test('answers with no lines for a folder that is not there', () => {
  assert.deepEqual(
    listFrameworkVersions(path.join(os.tmpdir(), 'extjs-no-such-templates')),
    []
  )
})

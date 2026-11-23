import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {load as loadYaml} from 'js-yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Specs read workflows as data, so a reflowed line or a moved key does not
// break them while a changed value still does.
/**
 * @param {...string} segments
 * @returns {any}
 */
export function readYaml(...segments) {
  return loadYaml(fs.readFileSync(path.join(root, ...segments), 'utf8'))
}

/** @param {string} file */
export function readWorkflow(file) {
  return readYaml('.github', 'workflows', file)
}

/**
 * @param {any} workflow
 * @param {string} id
 */
export function job(workflow, id) {
  const found = workflow.jobs?.[id]

  if (!found) throw new Error(`no job named ${id}`)

  return found
}

/**
 * @param {any} owner
 * @param {string} name
 */
export function step(owner, name) {
  const found = (owner.steps || []).find(
    (/** @type {any} */ entry) => entry.name === name
  )

  if (!found) throw new Error(`no step named ${name}`)

  return found
}

// Every run line of a job, joined, for the facts that live inside shell.
/** @param {any} owner */
export function runText(owner) {
  return (owner.steps || [])
    .map((/** @type {any} */ entry) => entry.run)
    .filter(Boolean)
    .join('\n')
}

// Finds a step by name in any job of the workflow.
/**
 * @param {any} workflow
 * @param {string} name
 */
export function anyStep(workflow, name) {
  const found = Object.values(workflow.jobs || {})
    .flatMap((/** @type {any} */ entry) => entry.steps || [])
    .find((/** @type {any} */ entry) => entry.name === name)

  if (!found) throw new Error(`no step named ${name}`)

  return found
}

// An Actions expression as the workflow file writes it.
/** @param {string} body */
export function expr(body) {
  return ['$', '{{ ', body, ' }}'].join('')
}

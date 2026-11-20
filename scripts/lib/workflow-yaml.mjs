import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import yaml from 'js-yaml'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// Specs read workflows as data, so a reflowed line or a moved key does not
// break them while a changed value still does.
export function readYaml(...segments) {
  return yaml.load(fs.readFileSync(path.join(root, ...segments), 'utf8'))
}

export function readWorkflow(file) {
  return readYaml('.github', 'workflows', file)
}

export function job(workflow, id) {
  const found = workflow.jobs?.[id]

  if (!found) throw new Error(`no job named ${id}`)

  return found
}

export function step(owner, name) {
  const found = (owner.steps || []).find((entry) => entry.name === name)

  if (!found) throw new Error(`no step named ${name}`)

  return found
}

// Every run line of a job, joined, for the facts that live inside shell.
export function runText(owner) {
  return (owner.steps || [])
    .map((entry) => entry.run)
    .filter(Boolean)
    .join('\n')
}

// Finds a step by name in any job of the workflow.
export function anyStep(workflow, name) {
  const found = Object.values(workflow.jobs || {})
    .flatMap((entry) => entry.steps || [])
    .find((entry) => entry.name === name)

  if (!found) throw new Error(`no step named ${name}`)

  return found
}

// An Actions expression as the workflow file writes it.
export function expr(body) {
  return ['$', '{{ ', body, ' }}'].join('')
}

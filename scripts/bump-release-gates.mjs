#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {execFileSync} from 'node:child_process'
import {appendFileSync, readFileSync, writeFileSync} from 'node:fs'
import {dirname, join} from 'node:path'
import {fileURLToPath} from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const GATES = ['extension-js/corpus', 'extension-js/templates']
export const FILES = [
  '.github/workflows/publish-release.yml',
  '.github/workflows/bump-release-gates.yml'
]

function literal(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A gate is pinned as `uses: <repo>/.github/workflows/<file>@<sha>` and again
// as the `ref:` input of the same job, and every one must name one commit.
export function pinnedSha(texts, repo) {
  const pattern = new RegExp(
    `uses: ${literal(repo)}/\\.github/workflows/[\\w.-]+@([0-9a-f]{40})`,
    'g'
  )
  const found = new Set(
    texts.flatMap((text) => [...text.matchAll(pattern)].map((m) => m[1]))
  )

  if (found.size !== 1) {
    throw new Error(
      `${repo} is pinned to ${found.size} commits, expected one: ${[...found].join(', ')}`
    )
  }

  return [...found][0]
}

export function movePin(text, repo, from, to, date) {
  const stamped = new RegExp(
    `(uses: ${literal(repo)}/\\.github/workflows/[\\w.-]+@)${from} # main, [0-9-]+`,
    'g'
  )

  return text.replace(stamped, `$1${to} # main, ${date}`).replaceAll(from, to)
}

function head(repo) {
  const out = execFileSync(
    'git',
    ['ls-remote', `https://github.com/${repo}.git`, 'refs/heads/main'],
    {encoding: 'utf8'}
  )
  const sha = out.split(/\s+/)[0]

  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error(`could not read the head of ${repo}`)
  }

  return sha
}

// The templates repository commits its built artifacts to main after every
// CI run. A pin that is behind by those commits alone tests the same suite.
const BOT_COMMIT = /^chore: update artifacts/

export function onlyBotCommits(messages) {
  return messages.length > 0 && messages.every((m) => BOT_COMMIT.test(m))
}

async function commitsBetween(repo, from, to) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  const response = await fetch(
    `https://api.github.com/repos/${repo}/compare/${from}...${to}`,
    {
      headers: {
        accept: 'application/vnd.github+json',
        ...(token ? {authorization: `Bearer ${token}`} : {})
      }
    }
  )

  if (!response.ok) return []

  /** @type {any} */
  const body = await response.json()

  return (body.commits || []).map((entry) => entry.commit.message)
}

async function main() {
  const check = process.argv.includes('--check')
  const date = new Date().toISOString().slice(0, 10)
  let texts = FILES.map((file) => readFileSync(join(root, file), 'utf8'))
  const moved = []
  const outputs = []

  for (const repo of GATES) {
    const from = pinnedSha(texts, repo)
    const to = head(repo)
    const name = repo.split('/')[1]

    outputs.push(`${name}=${to}`, `${name}_behind=${from !== to}`)

    if (from === to) {
      console.log(`${repo} is pinned to its head ${to.slice(0, 7)}.`)
      continue
    }

    if (onlyBotCommits(await commitsBetween(repo, from, to))) {
      outputs[outputs.length - 1] = `${name}_behind=false`
      console.log(
        `${repo} is behind by artifact commits only, ${from.slice(0, 7)} stays.`
      )

      continue
    }

    console.log(`${repo}: ${from.slice(0, 7)} -> ${to.slice(0, 7)}`)
    moved.push(`${repo} ${from.slice(0, 7)} -> ${to.slice(0, 7)}`)
    texts = texts.map((text) => movePin(text, repo, from, to, date))
  }

  outputs.push(`behind=${moved.length > 0}`, `summary=${moved.join(', ')}`)

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`)
  }

  if (check) return

  for (const [index, file] of FILES.entries()) {
    writeFileSync(join(root, file), texts[index])
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main()

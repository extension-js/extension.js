//  ██████╗██╗     ██╗
// ██╔════╝██║     ██║
// ██║     ██║     ██║
// ██║     ██║     ██║
// ╚██████╗███████╗██║
//  ╚═════╝╚══════╝╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import fs from 'fs'
import path from 'path'
import type {Command} from 'commander'
import {loadExtensionDevelopBridgeModule} from '../helpers/extension-develop-runtime'

export function readRecentConsole(
  projectPath: string,
  browser: string,
  target: {context?: string; tabId?: number},
  limit: number
): unknown[] {
  const file = path.resolve(
    projectPath,
    'dist',
    'extension-js',
    browser,
    'logs.ndjson'
  )
  let lines: string[]
  try {
    lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean)
  } catch {
    return []
  }

  const out: any[] = []
  for (const line of lines) {
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }

    if (!e || e.type === 'header') continue
    if (target.context && e.context !== target.context) continue
    if (target.tabId != null && e.tabId !== target.tabId) continue

    out.push({
      seq: e.seq,
      level: e.level,
      context: e.context,
      messageParts: e.messageParts,
      eventType: e.eventType,
      code: e.code,
      tabId: e.tabId
    })
  }

  return out.slice(Math.max(0, out.length - limit))
}

type ActContext =
  | 'background'
  | 'popup'
  | 'options'
  | 'sidebar'
  | 'devtools'
  | 'content'
  | 'page'

type CommandOp =
  | 'eval'
  | 'storage.get'
  | 'storage.set'
  | 'reload'
  | 'open'
  | 'tabs.query'
  | 'inspect'

interface CommonActOptions {
  browser?: string
  context?: string
  url?: string
  tab?: string
  timeout?: string
  output?: 'pretty' | 'json'
}

interface RunInput {
  projectPathArg?: string
  op: CommandOp
  target: {context: ActContext; url?: string; tabId?: number}
  args?: Record<string, unknown>
  needsToken?: boolean
  opts: CommonActOptions
  augment?: (
    projectPath: string,
    browser: string,
    result: any
  ) => Record<string, unknown>
}

function fail(message: string): never {
  // eslint-disable-next-line no-console
  console.error(message)
  process.exit(1)
}

function printResult(result: any, output: 'pretty' | 'json' | undefined): void {
  if (output === 'json') {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(result))
    return
  }

  if (result.ok) {
    const value = result.value
    // eslint-disable-next-line no-console
    console.log(
      typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    )

    if (result.truncated) {
      // eslint-disable-next-line no-console
      console.error('… result truncated (byte cap)')
    }

    return
  }

  const err = result.error || {name: 'Error', message: 'command failed'}
  // eslint-disable-next-line no-console
  console.error(
    `${err.name}: ${err.message}${err.engine ? ` (engine: ${err.engine})` : ''}`
  )
}

async function runCommand(input: RunInput): Promise<void> {
  const projectPath = path.resolve(input.projectPathArg || process.cwd())
  const browser = input.opts.browser || 'chromium'

  const {BridgeController, readReadyContract, readControlToken}: any =
    await loadExtensionDevelopBridgeModule()

  const ready = readReadyContract(projectPath, browser)
  if (!ready) {
    fail(
      `No active control channel found for ${browser}. ` +
        `Run \`extension dev --browser=${browser} --allow-control\` first.`
    )
  }

  const token = input.needsToken
    ? readControlToken(projectPath, browser)
    : undefined
  const controller = new BridgeController({
    controlPort: ready.controlPort,
    instanceId: ready.instanceId,
    token: token ?? undefined
  })

  try {
    await controller.connect()
  } catch (err: any) {
    controller.close()
    fail(err?.message || 'could not connect to the control channel')
  }

  const timeoutMs = input.opts.timeout ? Number(input.opts.timeout) : 5000
  let result: any
  try {
    result = await controller.command({
      op: input.op,
      target: input.target,
      args: input.args,
      timeoutMs
    })
  } catch (err: any) {
    controller.close()
    fail(err?.message || 'command failed')
  } finally {
    controller.close()
  }

  if (result && result.ok && input.augment) {
    try {
      Object.assign(result, input.augment(projectPath, browser, result))
    } catch {
      // augmentation is best-effort; never fail the command over it
    }
  }

  printResult(result, input.opts.output)
  process.exit(result.ok ? 0 : 1)
}

function targetFrom(
  opts: CommonActOptions,
  fallback: ActContext = 'background'
): {context: ActContext; url?: string; tabId?: number} {
  const context = (opts.context as ActContext) || fallback
  const target: {context: ActContext; url?: string; tabId?: number} = {context}
  if (opts.url) target.url = opts.url
  if (opts.tab != null && opts.tab !== '') target.tabId = Number(opts.tab)

  return target
}

const commonOptions = (cmd: Command): Command =>
  cmd
    .option(
      '--browser <chrome | chromium | edge | firefox>',
      'which session to target (default chromium)'
    )
    .option('--timeout <ms>', 'command timeout in milliseconds (default 5000)')
    .option('--output <pretty|json>', 'output format (default pretty)')

export function registerActCommands(program: Command): void {
  // extension eval <expression> [project-path]
  commonOptions(
    program
      .command('eval')
      .arguments('<expression> [project-path]')
      .description(
        'Evaluate an expression in a running extension context (requires --allow-eval)'
      )
      .option(
        '--context <background|popup|options|sidebar|devtools|content|page>',
        'target context (default background)'
      )
      .option(
        '--url <glob|substring>',
        'for content/page: document(s) to target'
      )
      .option('--tab <id>', 'for content/page: a specific tab')
  ).action(async function (
    expression: string,
    projectPathArg: string,
    opts: CommonActOptions
  ) {
    await runCommand({
      projectPathArg,
      op: 'eval',
      target: targetFrom(opts),
      args: {expression},
      needsToken: true,
      opts
    })
  })

  // extension storage <get|set> [project-path]
  commonOptions(
    program
      .command('storage')
      .arguments('<action> [project-path]')
      .description(
        'Read or write chrome.storage in a running extension (requires --allow-control)'
      )
      .option(
        '--area <local|sync|session|managed>',
        'storage area (default local)'
      )
      .option('--key <key>', 'key to get or set')
      .option('--value <json>', 'JSON value to set (with set)')
      .option(
        '--context <background|popup|options|sidebar|content>',
        'target context (default background)'
      )
  ).action(async function (
    action: string,
    projectPathArg: string,
    opts: CommonActOptions & {area?: string; key?: string; value?: string}
  ) {
    const area = opts.area || 'local'

    if (action === 'get') {
      await runCommand({
        projectPathArg,
        op: 'storage.get',
        target: targetFrom(opts),
        args: opts.key ? {area, key: opts.key} : {area},
        opts
      })

      return
    }
    if (action === 'set') {
      if (!opts.key || opts.value == null) {
        fail('storage set requires --key and --value')
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(opts.value as string)
      } catch {
        parsed = opts.value // fall back to a raw string value
      }

      await runCommand({
        projectPathArg,
        op: 'storage.set',
        target: targetFrom(opts),
        args: {area, items: {[opts.key as string]: parsed}},
        opts
      })

      return
    }

    fail(`unknown storage action: ${action} (use get or set)`)
  })

  // extension reload [project-path]
  commonOptions(
    program
      .command('reload')
      .arguments('[project-path]')
      .description(
        'Reload a running extension or tab (requires --allow-control)'
      )
      .option(
        '--context <background|content|page>',
        'target context (default background)'
      )
      .option('--tab <id>', 'for content/page: a specific tab')
  ).action(async function (projectPathArg: string, opts: CommonActOptions) {
    await runCommand({
      projectPathArg,
      op: 'reload',
      target: targetFrom(opts),
      opts
    })
  })

  // extension inspect [project-path] — sidecar/control-channel DOM snapshot
  commonOptions(
    program
      .command('inspect')
      .arguments('[project-path]')
      .description(
        'Inspect a page/content DOM via the agent bridge (CDP-free; requires --allow-control). For closed shadow roots use CDP-based inspection against the ready.json cdpPort.'
      )
      .option(
        '--context <content|page|popup|options|sidebar|devtools>',
        'what to inspect: content/page (needs --tab) or an open surface (default content)'
      )
      .option('--tab <id>', 'tab id to inspect (required for content/page)')
      .option(
        '--include <list>',
        'comma-separated: html,summary (default summary)'
      )
      .option('--max-bytes <n>', 'cap on returned HTML bytes (default 262144)')
      .option(
        '--with-console [n]',
        'also include the last n console lines for the target (default 20)'
      )
  ).action(async function (
    projectPathArg: string,
    opts: CommonActOptions & {
      include?: string
      maxBytes?: string
      withConsole?: string | boolean
    }
  ) {
    const include = opts.include
      ? opts.include
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : ['summary']
    const target = targetFrom(opts, 'content')
    await runCommand({
      projectPathArg,
      op: 'inspect',
      target,
      args: {
        include,
        maxBytes: opts.maxBytes ? Number(opts.maxBytes) : undefined
      },
      opts,
      augment: opts.withConsole
        ? (projectPath, browser) => {
            const n =
              typeof opts.withConsole === 'string' && opts.withConsole !== ''
                ? Number(opts.withConsole)
                : 20
            return {
              console: readRecentConsole(
                projectPath,
                browser,
                target,
                Number.isFinite(n) && n > 0 ? n : 20
              )
            }
          }
        : undefined
    })
  })

  // extension open <surface> [project-path]
  commonOptions(
    program
      .command('open')
      .arguments('<surface> [project-path]')
      .description(
        'Open an extension surface — popup, options, sidebar, action, or command (requires --allow-control)'
      )
      .option(
        '--name <command>',
        'with `open command`: the chrome.commands name to trigger'
      )
  ).action(async function (
    surface: string,
    projectPathArg: string,
    opts: CommonActOptions & {name?: string}
  ) {
    const allowed = ['popup', 'options', 'sidebar', 'action', 'command']
    if (!allowed.includes(surface)) {
      fail(
        `unknown surface: ${surface} (use popup, options, sidebar, action, or command)`
      )
    }
    // 'action' and 'command' replay a captured event in the service worker, so
    // they route to the background context (UI surfaces map 1:1 to a context).
    const inBackground = surface === 'action' || surface === 'command'
    const context: ActContext = inBackground
      ? 'background'
      : (surface as ActContext)
    const args: Record<string, unknown> = {surface}
    if (surface === 'command' && opts.name) args.name = opts.name
    await runCommand({
      projectPathArg,
      op: 'open',
      target: {context},
      args,
      opts
    })
  })
}

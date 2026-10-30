// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import packageJson from '../package.json'
export interface BuildToolchain {
  node: string
  extension_js: string
  package_manager?: {name: string; version: string}
}

const USER_AGENT_HEAD = /^([A-Za-z][\w.-]*)\/(\S+)/

// What a reviewer rebuilding the package needs to match it: the Node that ran
// the build and the package manager whose script started it. Only a script
// run sets npm_config_user_agent, so a bare binary call records Node alone.
export function getBuildToolchain(
  env: Record<string, string | undefined> = process.env,
  nodeVersion: string = process.version
): BuildToolchain {
  const agent = String(env.npm_config_user_agent || '').trim()
  const head = USER_AGENT_HEAD.exec(agent)

  if (!head || head[2] === '?') {
    return {node: nodeVersion, extension_js: packageJson.version}
  }

  return {
    node: nodeVersion,
    extension_js: packageJson.version,
    package_manager: {name: head[1].toLowerCase(), version: head[2]}
  }
}

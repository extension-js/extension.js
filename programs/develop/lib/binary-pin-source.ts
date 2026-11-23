// ██████╗ ███████╗██╗   ██╗███████╗██╗      ██████╗ ██████╗
// ██╔══██╗██╔════╝██║   ██║██╔════╝██║     ██╔═══██╗██╔══██╗
// ██║  ██║█████╗  ██║   ██║█████╗  ██║     ██║   ██║██████╔╝
// ██║  ██║██╔══╝  ╚██╗ ██╔╝██╔══╝  ██║     ██║   ██║██╔═══╝
// ██████╔╝███████╗ ╚████╔╝ ███████╗███████╗╚██████╔╝██║
// ╚═════╝ ╚══════╝  ╚═══╝  ╚══════╝╚══════╝ ╚═════╝ ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {
  type ConfigEnvTarget,
  findConfigFile,
  loadBrowserConfigBlockName
} from './config-loader'

type BinaryKey = 'chromiumBinary' | 'geckoBinary' | 'firefoxBinary'
type BinaryLayer = Partial<Record<BinaryKey, unknown>> | null | undefined

interface BinaryPinLayers {
  flags: BinaryLayer
  command: BinaryLayer
  browser: BinaryLayer
}

interface BinaryPinSources {
  chromiumBinarySource?: string
  geckoBinarySource?: string
}

type LayerName = keyof BinaryPinLayers

// The order each command reads its Gecko pin in. dev merges the layers per
// key and then prefers geckoBinary, preview walks each layer for both keys.
const GECKO_ORDER: Record<'dev' | 'serve', Array<[LayerName, BinaryKey]>> = {
  dev: [
    ['flags', 'geckoBinary'],
    ['command', 'geckoBinary'],
    ['browser', 'geckoBinary'],
    ['flags', 'firefoxBinary'],
    ['command', 'firefoxBinary'],
    ['browser', 'firefoxBinary']
  ],
  serve: [
    ['flags', 'geckoBinary'],
    ['flags', 'firefoxBinary'],
    ['command', 'geckoBinary'],
    ['command', 'firefoxBinary'],
    ['browser', 'geckoBinary'],
    ['browser', 'firefoxBinary']
  ]
}

const CHROMIUM_ORDER: Array<[LayerName, BinaryKey]> = [
  ['flags', 'chromiumBinary'],
  ['command', 'chromiumBinary'],
  ['browser', 'chromiumBinary']
]

function winner(
  layers: BinaryPinLayers,
  order: Array<[LayerName, BinaryKey]>
): [LayerName, BinaryKey] | undefined {
  return order.find(([layer, key]) => Boolean(layers[layer]?.[key]))
}

// The merge loses which layer named the binary, and a launch failure has to
// name the config key when the file pinned it, not a flag nobody typed.
export async function binaryPinSources(input: {
  projectDir: string
  command: 'dev' | 'start' | 'preview'
  browser: string
  envTarget: ConfigEnvTarget
  layers: BinaryPinLayers
}): Promise<BinaryPinSources> {
  const {projectDir, command, browser, envTarget, layers} = input
  const configPath = findConfigFile(projectDir)
  if (!configPath) return {}

  const label = async ([layer, key]: [LayerName, BinaryKey]) => {
    if (layer === 'flags') return undefined

    const block =
      layer === 'command'
        ? `commands.${command}`
        : `browser.${
            (await loadBrowserConfigBlockName(
              projectDir,
              browser as never,
              envTarget
            )) || browser
          }`

    return `${block}.${key} in ${path.basename(configPath)}`
  }

  const chromium = winner(layers, CHROMIUM_ORDER)
  const gecko = winner(layers, GECKO_ORDER[command === 'dev' ? 'dev' : 'serve'])
  const chromiumBinarySource = chromium ? await label(chromium) : undefined
  const geckoBinarySource = gecko ? await label(gecko) : undefined

  return {
    ...(chromiumBinarySource ? {chromiumBinarySource} : {}),
    ...(geckoBinarySource ? {geckoBinarySource} : {})
  }
}

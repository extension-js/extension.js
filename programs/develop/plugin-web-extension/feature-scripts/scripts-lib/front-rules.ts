// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Compiler} from '@rspack/core'

type Rules = Compiler['options']['module']['rules']

// A plugin of the project applies later and may put a rule of its own in
// front, so each step takes the front again once every plugin has applied.
export function addRulesInFront(
  compiler: Compiler,
  name: string,
  front: Rules
): void {
  compiler.options.module.rules.unshift(...front)

  compiler.hooks.initialize.tap(name, () => {
    const rules = compiler.options.module.rules

    if (front.every((rule, index) => rules[index] === rule)) return

    compiler.options.module.rules = [
      ...front,
      ...rules.filter((rule) => !front.includes(rule))
    ]
  })
}

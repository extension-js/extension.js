#!/usr/bin/env node

// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

export function corpusReleaseLine(env) {
  // Only a stable release is gated, so only its notes carry the line: which
  // canary the gate read, or that the gate was skipped by input.
  if (env.CHANNEL !== 'stable') return ''

  const canary = (env.CORPUS_CANARY || '').trim()

  if (
    env.CORPUS_RESULT === 'success' &&
    env.TEMPLATES_RESULT === 'success' &&
    canary
  ) {
    const run = env.RUN_URL ? ` ([run](${env.RUN_URL}))` : ''

    return `Validated before publishing: \`extension@${canary}\`, cut from the same commit, built every buildable sample of [extension-js/corpus](https://github.com/extension-js/corpus) on Chrome, Firefox, Edge and Safari, and passed the [extension-js/templates](https://github.com/extension-js/templates) suite${run}.`
  }

  if (env.CORPUS_SKIPPED === 'true') {
    return 'The corpus and templates gates were skipped for this release.'
  }

  return ''
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(corpusReleaseLine(process.env))
}

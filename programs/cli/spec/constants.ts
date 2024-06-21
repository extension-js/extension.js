const BROWSERS = ['chrome', 'edge', 'firefox']
const DEFAULT_TEMPLATES = ['init']
const JS_TEMPLATES = ['content', 'new']
const WASM_TEMPLATES: string[] = []
const TS_TEMPLATES = ['typescript']
const CUSTOM_TEMPLATES = ['chatgpt']
const FRAMEWORK_TEMPLATES = [
  'react',
  'react-typescript',
  'preact',
  'preact-typescript',
  'vue',
  'vue-typescript'
]
const TAILWIND_TEMPLATES = ['tailwind']
const ALL_TEMPLATES = [
  ...JS_TEMPLATES,
  ...WASM_TEMPLATES,
  ...TS_TEMPLATES,
  ...CUSTOM_TEMPLATES,
  ...FRAMEWORK_TEMPLATES,
  ...TAILWIND_TEMPLATES
]

const UI_CONTEXTS = [
  'sidebar',
  'newtab',
  'content',
  'popup', // alias: action
  'devtools'
  // options
  // sandbox
]

export {
  BROWSERS,
  DEFAULT_TEMPLATES,
  JS_TEMPLATES,
  WASM_TEMPLATES,
  TS_TEMPLATES,
  CUSTOM_TEMPLATES,
  FRAMEWORK_TEMPLATES,
  TAILWIND_TEMPLATES,
  ALL_TEMPLATES,
  UI_CONTEXTS
}

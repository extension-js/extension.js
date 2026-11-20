declare module '@stylistic/eslint-plugin' {
  // The plugin keeps its types behind an exports map the scripts project's
  // node10 resolution cannot read, so the one shape the rules use is here.
  const plugin: {rules: Record<string, import('eslint').Rule.RuleModule>}
  export default plugin
}

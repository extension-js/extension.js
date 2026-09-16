// A URL typed where the project name belongs. Only a real http or https URL
// counts, so names like httpbin-tool or https-everywhere-fork still scaffold.
export function isUrlProjectName(projectNameInput: string): boolean {
  return /^https?:\/\//i.test(projectNameInput.trim())
}

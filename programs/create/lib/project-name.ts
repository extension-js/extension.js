export function isUrlProjectName(projectNameInput: string): boolean {
  return /^https?:\/\//i.test(projectNameInput.trim())
}

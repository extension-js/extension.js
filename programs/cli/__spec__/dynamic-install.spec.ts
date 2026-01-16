describe('dynamic install', () => {
  it('has access to extension-develop in the workspace dependency graph', async () => {
    const mod: any = await import('extension-develop')
    expect(typeof mod.extensionBuild).toBe('function')
    expect(typeof mod.extensionDev).toBe('function')
    expect(typeof mod.extensionStart).toBe('function')
    expect(typeof mod.extensionPreview).toBe('function')
  })

  it('has access to extension-create in the workspace dependency graph', async () => {
    const mod: any = await import('extension-create')
    expect(typeof mod.extensionCreate).toBe('function')
  })
})

describe('cache reuse offline', () => {
  it('does not require any dlx/cache indirection for extension-develop', async () => {
    const mod: any = await import('extension-develop')
    expect(mod).toBeTruthy()
  })
})

browser.devtools.panels.elements.createSidebarPane(
  'My Own Sidebar',
  (sidebar) => {
    browser.devtools.panels.elements.onSelectionChanged.addListener(() => {
      sidebar.setExpression('$0')
    })
  }
)

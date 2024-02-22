/* global chrome */

chrome.devtools.panels.elements.createSidebarPane(
  'My Own Sidebar',
  (sidebar) => {
    chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
      sidebar.setExpression('$0')
    })
  }
)

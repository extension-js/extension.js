// Background script for the Browser Flags Example extension

// Log a message when the extension is installed or updated
chrome.runtime.onInstalled.addListener(function(details) {
  console.log('Browser Flags Example extension installed/updated:', details.reason);
  
  // Show notification about successful installation/update
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon48.png',
    title: 'Browser Flags Example',
    message: 'Extension loaded. Open the popup to test customized browser flags.'
  });
});

// This extension doesn't need to do much in the background
// It's primarily designed to demonstrate browser flag customization
console.log('Browser Flags Example background script running');

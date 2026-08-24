// Global active-tab tracker.
// Modules stay mounted (hidden via display:none) after first visit, so their
// window-level keydown listeners keep firing. Shortcut handlers must check
// this before acting so keys only affect the currently visible module.
let currentTab = 'blog'

export function setGlobalActiveTab(tab: string) {
  currentTab = tab
}

export function getGlobalActiveTab() {
  return currentTab
}

// Tells the Banchor dashboard this extension's id, so it can message back
// (chrome.runtime.sendMessage needs the id) however the dashboard was opened.
document.documentElement.dataset.banchorExt = chrome.runtime.id;

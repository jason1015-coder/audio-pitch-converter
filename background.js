/* 432Hz Audio Engine — background service worker.
   Persists settings and relays state changes to all tabs. */

const DEFAULT = { enabled: false, mode: "tempo", base: 440, target: 432 };

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.get(["a432"], (res) => {
    if (!res.a432) chrome.storage.sync.set({ a432: DEFAULT });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "A432_SAVE") {
    chrome.storage.sync.set({ a432: msg.state }, () => {
      // broadcast to every tab
      chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
          chrome.tabs
            .sendMessage(t.id, { type: "A432_SET", state: msg.state })
            .catch(() => {});
        }
      });
      reply({ ok: true });
    });
    return true;
  }
});

// Badge reflects on/off
function setBadge(enabled) {
  chrome.action.setBadgeText({ text: enabled ? "432" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#c026d3" });
}
chrome.storage.onChanged.addListener((changes) => {
  if (changes.a432) setBadge(changes.a432.newValue?.enabled);
});
chrome.storage.sync.get(["a432"], (res) => setBadge(res.a432?.enabled));

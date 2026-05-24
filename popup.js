/* 432Hz Audio Engine — popup logic */

const DEFAULT = { enabled: false, mode: "tempo", base: 440, target: 432 };
let state = { ...DEFAULT };

const $ = (id) => document.getElementById(id);
const els = {
  enabledBtn: $("enabledBtn"),
  enabledLabel: $("enabledLabel"),
  modeTempo: $("modeTempo"),
  modePitch: $("modePitch"),
  base: $("baseInput"),
  target: $("targetInput"),
  slider: $("targetSlider"),
  sliderMid: $("sliderMid"),
  ratio: $("ratioVal"),
  cents: $("centsVal"),
  semis: $("semisVal"),
  statusDot: $("statusDot"),
  statusText: $("statusText"),
  mediaCount: $("mediaCount"),
  modeHint: $("modeHint"),
  reset: $("resetBtn"),
};

function fmt(n, d = 1) { return Number(n).toFixed(d); }

function recompute() {
  const ratio = state.target / state.base;
  const cents = 1200 * Math.log2(ratio);
  const semis = cents / 100;
  els.ratio.textContent = fmt(ratio, 2) + "x";
  els.cents.textContent = (cents >= 0 ? "+" : "−") + fmt(Math.abs(cents), 1) + "¢";
  els.semis.textContent = (semis >= 0 ? "+" : "−") + fmt(Math.abs(semis), 1);
}

function renderModeHint() {
  if (state.mode === "tempo") {
    els.modeHint.textContent =
      "Tempo mode: playback is slowed to " + fmt((state.target / state.base) * 100, 1) +
      "% so a " + state.base + "Hz master plays at " + state.target + "Hz. The authentic retune — tempo shifts slightly.";
  } else {
    els.modeHint.textContent =
      "Pitch mode: tempo is preserved and only pitch drops " + fmt(Math.abs(1200 * Math.log2(state.target / state.base)), 1) +
      "¢. Needs CORS-accessible audio; may add mild artifacts.";
  }
}

function renderUI() {
  // enabled button
  els.enabledBtn.classList.toggle("off", !state.enabled);
  els.enabledLabel.textContent = state.enabled ? "Enabled" : "Disabled";
  // mode
  els.modeTempo.classList.toggle("active", state.mode === "tempo");
  els.modePitch.classList.toggle("active", state.mode === "pitch");
  // values
  els.base.value = state.base;
  els.target.value = state.target;
  els.slider.value = state.target;
  els.sliderMid.textContent = fmt(state.target, 1) + "Hz";
  // status
  els.statusDot.classList.toggle("on", state.enabled);
  els.statusText.textContent = state.enabled
    ? "Engine on · " + (state.mode === "tempo" ? "Tempo" : "Pitch") + " mode"
    : "Engine off";
  recompute();
  renderModeHint();
}

function persistAndBroadcast() {
  chrome.runtime.sendMessage({ type: "A432_SAVE", state }, () => {});
  // also push directly to active tab for instant feedback
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { type: "A432_SET", state }, () => {
        void chrome.runtime.lastError; // swallow "no receiver" on chrome:// pages
      });
    }
  });
}

function update(patch) {
  Object.assign(state, patch);
  renderUI();
  persistAndBroadcast();
}

// ---- events ----
els.enabledBtn.addEventListener("click", () => update({ enabled: !state.enabled }));
els.modeTempo.addEventListener("click", () => update({ mode: "tempo" }));
els.modePitch.addEventListener("click", () => update({ mode: "pitch" }));

els.base.addEventListener("input", () => {
  const v = parseFloat(els.base.value);
  if (!isNaN(v) && v > 0) update({ base: v });
});
els.target.addEventListener("input", () => {
  const v = parseFloat(els.target.value);
  if (!isNaN(v) && v > 0) update({ target: v });
});
els.slider.addEventListener("input", () => {
  update({ target: parseFloat(els.slider.value) });
});
els.reset.addEventListener("click", () => update({ base: 440, target: 432 }));

// ---- init: load saved state + query active tab media count ----
chrome.storage.sync.get(["a432"], (res) => {
  if (res.a432) state = { ...DEFAULT, ...res.a432 };
  renderUI();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "A432_GET" }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        els.mediaCount.textContent = "n/a here";
        return;
      }
      els.mediaCount.textContent = resp.mediaCount + " media";
    });
  });
});

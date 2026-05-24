/* Solfeggio Audio Engine — popup logic */

const PRESETS = {
  "432": { base: 440, target: 432 },   // A=432 (retune down)
  "528": { base: 440, target: 444 },   // A=444 => C=528Hz (retune up)
};
const DEFAULT = { enabled: false, mode: "tempo", base: 440, target: 432, preset: "432" };
let state = { ...DEFAULT };

const $ = (id) => document.getElementById(id);
const els = {
  enabledBtn: $("enabledBtn"), enabledLabel: $("enabledLabel"),
  modeTempo: $("modeTempo"), modePitch: $("modePitch"),
  preset: $("presetSelect"),
  base: $("baseInput"), target: $("targetInput"),
  baseWrap: $("baseWrap"), targetWrap: $("targetWrap"),
  slider: $("targetSlider"), sliderMid: $("sliderMid"),
  ratio: $("ratioVal"), cents: $("centsVal"), semis: $("semisVal"),
  statusDot: $("statusDot"), statusText: $("statusText"),
  mediaCount: $("mediaCount"), modeHint: $("modeHint"), reset: $("resetBtn"),
};

const fmt = (n, d = 1) => Number(n).toFixed(d);

function recompute() {
  const r = state.target / state.base;
  const cents = 1200 * Math.log2(r);
  els.ratio.textContent = fmt(r, 3) + "x";
  els.cents.textContent = (cents >= 0 ? "+" : "−") + fmt(Math.abs(cents), 1) + "¢";
  els.semis.textContent = (cents / 100 >= 0 ? "+" : "−") + fmt(Math.abs(cents / 100), 2);
}

function presetLabel() {
  if (state.preset === "432") return "A=432Hz";
  if (state.preset === "528") return "C=528Hz (A=444)";
  return "Custom " + fmt(state.target, 1) + "Hz";
}

function renderModeHint() {
  const r = state.target / state.base;
  const dir = r < 1 ? "down" : "up";
  const pct = fmt(Math.abs((r - 1) * 100), 2);
  if (state.mode === "tempo") {
    els.modeHint.textContent =
      "Tempo mode · " + presetLabel() + ": playback shifts " + dir + " ~" + pct +
      "% — pitch and tempo move together (authentic retune).";
  } else {
    els.modeHint.textContent =
      "Pitch mode · " + presetLabel() + ": tempo preserved, pitch shifts " + dir +
      ". Experimental — may add mild artifacts; needs CORS-readable audio.";
  }
}

function lockInputs(locked) {
  els.base.disabled = locked; els.target.disabled = locked; els.slider.disabled = locked;
  els.baseWrap.classList.toggle("locked", locked);
  els.targetWrap.classList.toggle("locked", locked);
}

function renderUI() {
  els.enabledBtn.classList.toggle("off", !state.enabled);
  els.enabledLabel.textContent = state.enabled ? "Enabled" : "Disabled";
  els.modeTempo.classList.toggle("active", state.mode === "tempo");
  els.modePitch.classList.toggle("active", state.mode === "pitch");
  els.preset.value = state.preset;
  els.base.value = state.base;
  els.target.value = fmt(state.target, state.target % 1 ? 1 : 0);
  els.slider.value = state.target;
  els.sliderMid.textContent = fmt(state.target, 1) + "Hz";
  lockInputs(state.preset !== "custom");
  els.statusDot.classList.toggle("on", state.enabled);
  els.statusText.textContent = state.enabled
    ? "Engine on · " + presetLabel() + " · " + (state.mode === "tempo" ? "Tempo" : "Pitch")
    : "Engine off";
  recompute();
  renderModeHint();
}

function persist() {
  chrome.runtime.sendMessage({ type: "A432_SAVE", state }, () => void chrome.runtime.lastError);
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "A432_SET", state },
      () => void chrome.runtime.lastError);
  });
}

function update(patch) { Object.assign(state, patch); renderUI(); persist(); }

function applyPreset(name) {
  if (name === "custom") { update({ preset: "custom" }); return; }
  const p = PRESETS[name];
  update({ preset: name, base: p.base, target: p.target });
}

// events
els.enabledBtn.addEventListener("click", () => update({ enabled: !state.enabled }));
els.modeTempo.addEventListener("click", () => update({ mode: "tempo" }));
els.modePitch.addEventListener("click", () => update({ mode: "pitch" }));
els.preset.addEventListener("change", (e) => applyPreset(e.target.value));

function customEdit(patch) {
  // editing inputs forces preset -> custom
  update({ preset: "custom", ...patch });
}
els.base.addEventListener("input", () => {
  const v = parseFloat(els.base.value); if (!isNaN(v) && v > 0) customEdit({ base: v });
});
els.target.addEventListener("input", () => {
  const v = parseFloat(els.target.value); if (!isNaN(v) && v > 0) customEdit({ target: v });
});
els.slider.addEventListener("input", () => customEdit({ target: parseFloat(els.slider.value) }));
els.reset.addEventListener("click", () => applyPreset("432"));

// init
chrome.storage.sync.get(["a432"], (res) => {
  if (res.a432) state = { ...DEFAULT, ...res.a432 };
  if (!state.preset) state.preset = "432";
  renderUI();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "A432_GET" }, (resp) => {
      if (chrome.runtime.lastError || !resp) { els.mediaCount.textContent = "n/a here"; return; }
      els.mediaCount.textContent = resp.mediaCount + " media";
    });
  });
});

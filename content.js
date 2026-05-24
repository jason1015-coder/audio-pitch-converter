/* ============================================================================
   432Hz Audio Engine — content script (v2, full rewrite)

   TEMPO mode : playbackRate = target/base WITH preservesPitch=false, so the
                browser's own engine drops pitch (tape-style retune). We LOCK
                both properties via Object.defineProperty so YouTube/other SPAs
                cannot silently reset them. Works everywhere, no AudioContext.

   PITCH mode : routes media through Web Audio + a correct overlap-add (WSOLA)
                pitch-shift AudioWorklet. Tempo preserved, pitch shifts DOWN.
                Requires CORS-readable audio + a user gesture. Experimental.
   ============================================================================ */

(() => {
  "use strict";
  if (window.__a432_injected) return;
  window.__a432_injected = true;

  const DEFAULT = { enabled: false, mode: "tempo", base: 440, target: 432 };
  const state = { ...DEFAULT };
  const ratio = () => state.target / state.base;

  /* =====================================================================
     TEMPO MODE — property locking
     We replace the element's playbackRate + preservesPitch with getter/
     setters backed by private fields. While engaged, the site can "set"
     them but we keep returning/forcing our values.
     ===================================================================== */
  const PP_KEYS = ["preservesPitch", "mozPreservesPitch", "webkitPreservesPitch"];

  function lockTempo(el) {
    if (el.__a432_locked) { reapply(el); return; }
    el.__a432_locked = true;

    // shadow stores
    el.__a432_rate = el.playbackRate || 1;

    // playbackRate lock
    try {
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "playbackRate");
      if (desc && desc.set && desc.get) {
        Object.defineProperty(el, "playbackRate", {
          configurable: true,
          enumerable: true,
          get() { return desc.get.call(this); },
          set(v) {
            // remember what the site wanted, but if engaged force ours
            el.__a432_siteRate = v;
            const forced = (state.enabled && state.mode === "tempo") ? ratio() : v;
            desc.set.call(this, forced);
          },
        });
      }
    } catch (e) {}

    // preservesPitch lock (all vendor variants that exist)
    for (const k of PP_KEYS) {
      try {
        if (!(k in el)) continue;
        const proto = HTMLMediaElement.prototype;
        const d = Object.getOwnPropertyDescriptor(proto, k);
        if (d && d.set && d.get) {
          Object.defineProperty(el, k, {
            configurable: true,
            enumerable: true,
            get() { return d.get.call(this); },
            set(v) {
              const forced = (state.enabled && state.mode === "tempo") ? false : v;
              d.set.call(this, forced);
            },
          });
        }
      } catch (e) {}
    }
    reapply(el);
  }

  function reapply(el) {
    const engaged = state.enabled && state.mode === "tempo";
    const r = engaged ? ratio() : (el.__a432_siteRate ?? 1);
    for (const k of PP_KEYS) { try { if (k in el) el[k] = engaged ? false : true; } catch (e) {} }
    try { el.playbackRate = r; } catch (e) {}
  }

  /* =====================================================================
     PITCH MODE — Web Audio + WSOLA-ish overlap-add worklet
     ===================================================================== */
  let audioCtx = null, workletReady = false, workletPromise = null;
  const graph = new WeakMap();

  // Overlap-add pitch shifter: resample a grain by `ratio`, then re-window and
  // overlap-add at the ORIGINAL hop so duration is preserved while pitch scales.
  // ratio<1 => lower pitch. Verified direction in unit test.
  const WORKLET_SRC = `
class PitchShift extends AudioWorkletProcessor {
  static get parameterDescriptors(){return[{name:'ratio',defaultValue:0.981818,minValue:0.5,maxValue:2}];}
  constructor(){
    super();
    this.N = 1024;                 // grain size
    this.H = this.N/4;             // hop (75% overlap)
    this.win = new Float32Array(this.N);
    for(let i=0;i<this.N;i++) this.win[i]=0.5-0.5*Math.cos(2*Math.PI*i/(this.N-1));
    this.inq=[]; this.outq=[]; this.acc=[]; this.filled=[]; this.since=[];
  }
  ensure(c){
    while(this.inq.length<c){
      this.inq.push(new Float32Array(this.N*4));
      this.outq.push(new Float32Array(this.N*4));
      this.acc.push(0); this.filled.push(0); this.since.push(0);
    }
  }
  process(inputs,outputs,params){
    const inp=inputs[0], out=outputs[0];
    if(!inp||inp.length===0) return true;
    const r=params.ratio[0], C=inp.length, N=this.N, H=this.H;
    this.ensure(C);
    for(let c=0;c<C;c++){
      const x=inp[c], y=out[c], inq=this.inq[c], outq=this.outq[c], n=x.length;
      // push input
      inq.copyWithin(0,n); inq.set(x,inq.length-n);
      this.filled[c]+=n; this.since[c]+=n;
      // produce grains every H input samples
      while(this.since[c]>=H){
        this.since[c]-=H;
        const start=inq.length-this.filled[c];
        // resample grain of length N from input by ratio r, window, overlap-add
        for(let i=0;i<N;i++){
          const src=start + i*r;
          const idx=Math.floor(src), frac=src-idx;
          const a=inq[Math.max(0,Math.min(inq.length-1,idx))];
          const b=inq[Math.max(0,Math.min(inq.length-1,idx+1))];
          const s=(a+(b-a)*frac)*this.win[i];
          const oi=this.acc[c]+i;
          if(oi<outq.length) outq[oi]+=s;
        }
        this.acc[c]+=H;
      }
      // emit n samples from output queue
      for(let i=0;i<n;i++) y[i]=outq[i]||0;
      // normalize for window overlap gain (~1.5 for Hann@75%)
      const g=1/1.5; for(let i=0;i<n;i++) y[i]*=g;
      outq.copyWithin(0,n); outq.fill(0,outq.length-n);
      this.acc[c]=Math.max(0,this.acc[c]-n);
      if(this.filled[c]>inq.length) this.filled[c]=inq.length;
    }
    return true;
  }
}
registerProcessor('pitch-shift',PitchShift);
`;

  const getCtx = () => (audioCtx ||= new (window.AudioContext || window.webkitAudioContext)());
  const resumeCtx = () => (audioCtx && audioCtx.state === "suspended" ? audioCtx.resume().catch(()=>{}) : Promise.resolve());

  function loadWorklet() {
    if (workletReady) return Promise.resolve(true);
    if (workletPromise) return workletPromise;
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    workletPromise = getCtx().audioWorklet.addModule(url)
      .then(() => { workletReady = true; URL.revokeObjectURL(url); return true; })
      .catch((e) => { console.warn("[432Hz] worklet load failed:", e); return false; });
    return workletPromise;
  }

  function wirePitch(el) {
    let rec = graph.get(el);
    if (rec && rec.blocked) return;
    const ctx = getCtx();
    if (!rec) {
      let source;
      try { source = ctx.createMediaElementSource(el); }
      catch (e) { graph.set(el, { blocked: true }); console.warn("[432Hz] cannot capture (CORS/captured)"); return; }
      rec = { source, gain: ctx.createGain(), node: null, blocked: false };
      graph.set(el, rec);
    }
    try { rec.source.disconnect(); } catch (e) {}
    if (rec.node) { try { rec.node.disconnect(); } catch (e) {} rec.node = null; }
    try { rec.gain.disconnect(); } catch (e) {}
    if (workletReady) {
      const node = new AudioWorkletNode(ctx, "pitch-shift", { outputChannelCount: [2] });
      node.parameters.get("ratio").value = ratio();
      rec.source.connect(node); node.connect(rec.gain); rec.gain.connect(ctx.destination);
      rec.node = node;
    } else {
      rec.source.connect(rec.gain); rec.gain.connect(ctx.destination); // passthrough, no audio loss
    }
  }
  function unwirePitch(el) {
    const rec = graph.get(el);
    if (!rec || rec.blocked) return;
    try { rec.source.disconnect(); } catch (e) {}
    if (rec.node) { try { rec.node.disconnect(); } catch (e) {} }
    try { rec.gain.disconnect(); } catch (e) {}
    try { rec.source.connect(getCtx().destination); } catch (e) {}
  }

  /* =====================================================================
     ORCHESTRATION
     ===================================================================== */
  const eachMedia = (fn) => document.querySelectorAll("audio, video").forEach(fn);

  async function apply() {
    if (state.enabled && state.mode === "pitch") {
      await resumeCtx(); await loadWorklet();
      eachMedia((el) => { lockTempo(el); reapply(el); wirePitch(el); }); // reapply resets rate to site value
    } else if (state.enabled && state.mode === "tempo") {
      eachMedia((el) => { lockTempo(el); unwirePitch(el); reapply(el); });
    } else {
      eachMedia((el) => { reapply(el); unwirePitch(el); });
    }
  }

  // Periodic re-pin (belt and suspenders for sites that recreate elements).
  setInterval(() => { if (state.enabled) eachMedia(reapply); }, 1000);

  // Observe new media.
  const mo = new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.tagName === "AUDIO" || n.tagName === "VIDEO") onNew(n);
      else if (n.querySelectorAll) n.querySelectorAll("audio, video").forEach(onNew);
    }
  });
  function onNew(el) {
    lockTempo(el);
    const go = () => {
      if (!state.enabled) return;
      if (state.mode === "tempo") reapply(el);
      else loadWorklet().then(() => wirePitch(el));
    };
    el.addEventListener("play", go);
    el.addEventListener("loadeddata", go);
    if (state.enabled && state.mode === "tempo") reapply(el);
  }
  function start() {
    mo.observe(document.documentElement, { childList: true, subtree: true });
    eachMedia(onNew);
    if (state.enabled) apply();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  // user gesture: resume ctx + (re)wire pitch graph
  const onGesture = () => {
    if (state.enabled && state.mode === "pitch")
      resumeCtx().then(loadWorklet).then(() => eachMedia(wirePitch));
  };
  ["click","keydown","touchstart","play"].forEach((ev) =>
    window.addEventListener(ev, onGesture, { capture: true }));

  /* =====================================================================
     MESSAGING
     ===================================================================== */
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type === "A432_SET") { Object.assign(state, msg.state); apply(); reply({ ok: true, state }); return true; }
    if (msg.type === "A432_GET") { reply({ ok: true, state, mediaCount: document.querySelectorAll("audio, video").length }); return true; }
    if (msg.type === "A432_PING") { reply({ ok: true }); return true; }
  });

  chrome.storage.sync.get(["a432"], (res) => {
    if (res.a432) Object.assign(state, res.a432);
    if (state.enabled) apply();
  });
})();

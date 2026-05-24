# 432Hz Audio Engine

Retunes all web audio and video to A=432Hz in real time.

- **Tempo mode** — slows playback proportionally (tape-style), dropping pitch to 432Hz. Works on all sites with no special setup.
- **Pitch mode** — preserves tempo using a WSOLA pitch-shift AudioWorklet. Requires CORS-accessible audio and a user gesture.

## Installation

### Chromium (Chrome, Brave, Edge, Opera)

1. Go to `chrome://extensions` (or `brave://extensions`, `edge://extensions`)
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select the project folder

### Firefox (Temporary)

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select the `manifest.json` file from the project folder

> The extension reloads on every browser restart. For permanent installation, submit to [addons.mozilla.org](https://addons.mozilla.org).

## Usage

1. Click the extension icon in the toolbar
2. Toggle the **Enable** switch
3. Choose **Tempo** (universal) or **Pitch** (experimental)
4. Adjust target frequency (default 432Hz)

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).

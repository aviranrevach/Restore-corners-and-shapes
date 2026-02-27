# Restore Rounded Corners — Figma Plugin

Select a **flattened** rounded rectangle (a box with rounded corners that was turned into a vector path). The plugin reverse-engineers the path and recreates it as an **editable rectangle** with dynamic corner radius so you can adjust the corners again in the design panel.

## How to use

1. In Figma, create a rectangle and set corner radius (or use an existing rounded rectangle).
2. **Flatten** it: select the shape → right-click → **Flatten** (or use the flatten command). It becomes a single vector path.
3. Run the plugin: **Plugins** → **Development** → **Import plugin from manifest…** and choose the `manifest.json` in this folder (or run it if already installed).
4. With the vector selected, run **Restore Rounded Corners** and choose:
   - **Restore as Rectangle** — For a flattened rounded **box**: replaces the vector with a Rectangle node so the radius handles appear in the panel. Use this for rounded rectangles.
   - **Restore Corners in Place** — Keeps the vector: for rounded-rect paths it sets vertex corner radius; for other shapes (e.g. open paths) it tries to make corners roundable with a default radius.

## Development

- **Build:** `npm run build` — compiles `code.ts` → `code.js`
- **Watch:** `npm run watch` — recompile on save

Then in Figma: **Plugins** → **Development** → **Import plugin from manifest…** and select this folder’s `manifest.json`.

## How it works

When you flatten a rounded rectangle, Figma converts it to a vector path made of lines and cubic Bézier curves (no SVG arc command). The plugin:

1. Reads the path data from the selected vector.
2. Parses **M** (move), **L** (line), **C** (cubic), **Q** (quadratic), **Z** (close) commands.
3. Detects a rounded-rectangle pattern: 4 lines + 4 curves.
4. Estimates each corner radius from the Bézier control points (quarter-circle approximation: control-point distance ≈ 0.552 × radius).
5. Creates a new `Rectangle` node with the same bounds and per-corner radii, copies fills/strokes/effects, then replaces the flattened vector.

## Requirements

- Selection must be a **single vector** node (the result of flattening a rounded rectangle).
- The path must be a single closed path with exactly 4 curves and 4 line segments (standard rounded-rect shape).

If the path format is different (e.g. from a boolean or more complex flatten), the plugin will show a message and you may need to flatten only the rounded rectangle itself.

## Plugin icon

- **`icon.svg`** — Rounded rectangle outline (scalable). Use this when publishing to the Figma Community: open it in Figma, then export as PNG (e.g. 128×128 or 192×192) and upload in the Publish plugin modal.
- **`icon.png`** — Same icon as PNG at 128×128 for quick use.

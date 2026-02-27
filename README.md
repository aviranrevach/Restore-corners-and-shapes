# Restore Shapes & Corners

---

<p align="center">
  <img src="https://img.shields.io/badge/Figma-Plugin-blueviolet?logo=figma&logoColor=white" alt="Figma Plugin" />
  <img src="https://img.shields.io/badge/Platform-Desktop-blue" alt="Desktop" />
  <img src="https://img.shields.io/badge/No%20API%20Key-Required-green" alt="No API Key Required" />
  <img src="https://img.shields.io/badge/TypeScript-Powered-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
</p>

<p align="center">
  <strong>Reverse-engineer flattened shapes and corners back into editable Figma primitives.</strong><br/>
  Get your corner radius controls back in one click.<br/>
  No API key. No network access. Just select and restore.
</p>

<p align="center">
  <img src="Thumbnail%201920x1080-2.png" alt="Restore Shapes & Corners" width="100%" />
</p>

```
                                                                           ╭───────╮
  ██████╗  ███████╗ ███████╗ ████████╗  ██████╗  ██████╗  ███████╗        ╭╯       ╰╮
  ██╔══██╗ ██╔════╝ ██╔════╝ ╚══██╔══╝ ██╔═══██╗ ██╔══██╗ ██╔════╝        │  ●   ●  │
  ██████╔╝ █████╗   ███████╗    ██║    ██║   ██║ ██████╔╝ █████╗          │         │
  ██╔══██╗ ██╔══╝   ╚════██║    ██║    ██║   ██║ ██╔══██╗ ██╔══╝          │         │
  ██║  ██║ ███████╗ ███████║    ██║     ╚██████╔╝ ██║  ██║ ███████╗       │         │
  ╚═╝  ╚═╝ ╚══════╝ ╚══════╝    ╚═╝      ╚═════╝  ╚═╝  ╚═╝ ╚══════╝       │         │
                                                                          │         │
  ╔═╗ ╦ ╦ ╔═╗ ╔═╗ ╔═╗ ╔═╗              ╔═╗ ╔═╗ ╦═╗ ╔╗╔ ╔═╗ ╦═╗ ╔═╗        │  ●   ●  │
  ╚═╗ ╠═╣ ╠═╣ ╠═╝ ║╣  ╚═╗      &       ║   ║ ║ ╠╦╝ ║║║ ║╣  ╠╦╝ ╚═╗        ╰╮       ╭╯
  ╚═╝ ╩ ╩ ╩ ╩ ╩   ╚═╝ ╚═╝              ╚═╝ ╚═╝ ╩╚═ ╝╚╝ ╚═╝ ╩╚═ ╚═╝         ╰───────╯
```

---

## What is This?

A Figma plugin that reverse-engineers flattened vectors back into editable Figma primitives. When you flatten a shape in Figma, it becomes a raw vector path — the plugin analyzes the path data, detects what the original shape was, and recreates it as a proper editable node.

Three restore modes:

- **Rectangles** — Reverse-engineers flattened rounded rectangles. Parses the Bezier curves, calculates each corner radius, and replaces the vector with a proper `Rectangle` node so the radius handles return to the properties panel
- **Freeshape** — Reverse-engineers corners on any vector path. Keeps the vector but applies vertex corner radii — works for free-form shapes, open paths, and non-rectangular geometry
- **Regenerate shapes** — Auto-detects the original shape type (rectangle, ellipse, star, polygon) and reverse-engineers it back into the matching Figma primitive. Select any flattened shape and the plugin figures out what it was

Other features:

- **Per-Corner Detection** — Each corner can have a different radius, all are reverse-engineered independently from the Bezier control points
- **Preserves Styling** — Fills, strokes, and effects are carried over to the restored shape
- **Corner Picker** — Visually select which specific corners to restore (Freeshape mode)
- **Tolerance Settings** — Fine-tune merge distance and radius unification for tricky shapes
- **Multi-Selection** — Process multiple vectors at once
- **Undo Support** — One-click undo to revert any restore operation
- **Zero Network Access** — Runs entirely local, no external calls, no data leaves your machine

---

## How It Works

The plugin reverse-engineers flattened shapes by reading the raw vector path data:

1. **Parses** the path commands (M, L, C, Q, Z) from the selected vector
2. **Detects** the shape pattern — rounded rectangle (4 lines + 4 curves), ellipse, star, or polygon
3. **Reverse-engineers** corner radii from Bezier control points using quarter-circle approximation (~0.552 x radius)
4. **Recreates** the shape as a native Figma node with full editability

```
Flattened Vector          Reverse-Engineered        Restored Primitive
┌─────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│  Raw vector  │     │  Shape detection     │     │  Rectangle      │
│  M/L/C/Z     │ ──> │  Bezier analysis     │ ──> │  Ellipse        │
│  commands    │     │  Radius calculation  │     │  Star / Polygon │
└─────────────┘     └─────────────────────┘     └─────────────────┘
```

---

## Getting Started

### Install from source

```bash
git clone https://github.com/aviranrevach/Restore-corners-and-shapes.git
cd Restore-corners-and-shapes
npm install
npm run build
```

### Load in Figma

1. Open Figma Desktop
2. **Plugins > Development > Import plugin from manifest...**
3. Select the `manifest.json` from this folder

### Usage

1. Select one or more flattened vectors
2. Run the plugin: **Plugins > Restore Shapes & Corners**
3. Choose your restore mode (Rectangles, Freeshape, or Regenerate shapes) — done

---

## Development

```bash
npm run build    # Compile code.ts -> code.js
npm run watch    # Recompile on save
```

---

## Requirements

- Selection must contain **vector nodes** (the result of flattening shapes)
- For rectangle mode: path needs 4 curves + 4 line segments (standard rounded-rect)
- For regenerate shapes: works with rectangles, ellipses, stars, and polygons
- Complex boolean results may need to be flattened individually first

---

## License

MIT

---

<p align="center">
  Built by <a href="https://github.com/aviranrevach">Aviran Revach</a>
</p>

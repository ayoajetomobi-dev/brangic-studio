# Comput

Generator for the brand's 0/1 graphics: circles are 0s, pills are 1s. Output is always SVG.

- **Logo:** the sphere logomark, at any size, with centre diffusion (cross or hamburger).
- **Scene:** build illustrations from Comput's own 3D shapes (sphere, cube, cylinder, ring, capsule; each with its own width, height, depth and roundness, and any shape can cut into the layers above it; up to 24 layers). Layers can be shown or hidden (eye or H), renamed and reordered; hidden layers are left out of the preview, render and export with shapes that hide each other, cast shadows and an optional ground shadow. Drag shapes on the artboard, turn and tilt the camera, melt shapes together, start from ready-made scenes or save your own (saved in the browser).
- **Undo / redo:** buttons by Shuffle, or Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z (Ctrl+Y on Windows). Covers every setting and scene edit, up to 150 steps, for the current visit.
- **Scene controls:** drag a shape to edit it with the current tool (Move, Rotate, Scale; Free or X, Y, Z). Click empty space to deselect; drag empty space to pan. Right-drag or Option/Alt-drag to orbit. Scroll or pinch to zoom. Keys: G move, R rotate, S scale, X/Y/Z axis, Esc free, F reset view, Delete remove, Shift+D duplicate, arrows nudge.
- **Speed:** the engine runs in a background worker, so the page never waits on it. In Scene mode a GPU preview (`src/gpu.js`) draws the same lighting and 0/1 marks live at full frame rate while you work; the exact render replaces it a moment after you stop.
- **Looks:** built-in looks (Ink, Paper, Night, Fine, Bold) and your own. Export saved looks and scenes as one `comput-library.json` for the team, and import it on another computer.
- **Motion:** Build up, Light orbit, Diffusion (logo) and Turn (scenes). Frames start from the previous frame's marks so they drift smoothly. Export as video (MP4 or WebM, depending on the browser), a ZIP of SVG frames, or for Build up one animated SVG.
- **Describe a scene:** in the Claude artifact only, Claude's most capable model builds the object from the shape library in real proportions; a fast, inexpensive model checks the render, and the capable model runs again only to fix what the check found. The public site has no AI connection.
- **Picture:** any picture or 3D render turned into 0s and 1s. Dark areas pack tight, light areas stay sparse, outlines get extra packing, and pills follow the shapes. Cut-out PNGs with transparent backgrounds work best.
  - **3D form** (optional): *Inflate* rounds out any flat cut-out shape, no 3D software needed; or load a *normal map* exported from 3D software. Pills then follow the surface (Burst, Follow, Rings, like the logo), shorten towards the edges, and Comput can light the object with the logo's own light, shadow and rim model. Illustrations keep their own light, separate from the logo's.

- Live: https://brangic.studio/comput
- `src/engine.js` is the generator, ported from `sphere_logo_dense.py`, with a size-aware scaling law and centre diffusion, plus the image path (tone mapping, outline packing, a flow field for pill direction).
- `src/app.html` is the interface, `src/worker.js` runs the engine off the page, `src/gpu.js` is the live scene preview.
- `src/build.sh` puts the engine into the page and writes `docs/comput/index.html` (served by GitHub Pages) and `comput.html` (the Claude artifact version).

After editing anything in `src/`, run `src/build.sh`, then commit and push. Pages republishes on its own.

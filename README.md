# Comput

Generator for the brand's 0/1 graphics: circles are 0s, pills are 1s. Output is always SVG.

- **Logo:** the sphere logomark, at any size, with centre diffusion (cross or hamburger).
- **Illustration:** any picture or 3D render turned into 0s and 1s. Dark areas pack tight, light areas stay sparse, outlines get extra packing, and pills follow the shapes. Cut-out PNGs with transparent backgrounds work best.

- Live: https://brangic.studio/comput
- `src/engine.js` is the generator, ported from `sphere_logo_dense.py`, with a size-aware scaling law and centre diffusion, plus the image path (tone mapping, outline packing, a flow field for pill direction).
- `src/app.html` is the interface.
- `src/build.sh` puts the engine into the page and writes `docs/comput/index.html` (served by GitHub Pages) and `comput.html` (the Claude artifact version).

After editing anything in `src/`, run `src/build.sh`, then commit and push. Pages republishes on its own.

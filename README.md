# Comput

Generator for the 0/1 sphere logomark: circles are 0s, pills are 1s. Output is always SVG.

- Live: https://brangic.studio/comput
- `src/engine.js` is the generator, ported from `sphere_logo_dense.py`, with a size-aware scaling law and centre diffusion.
- `src/app.html` is the interface.
- `src/build.sh` puts the engine into the page and writes `docs/comput/index.html` (served by GitHub Pages) and `comput.html` (the Claude artifact version).

After editing anything in `src/`, run `src/build.sh`, then commit and push. Pages republishes on its own.

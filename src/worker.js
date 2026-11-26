/* Comput worker: runs the engine off the page so the interface never waits on it.
 * Loaded as a blob: the engine source followed by this file.
 * Messages in:  {type:'image', image}            keep a picture for later jobs
 *               {type:'cancelBelow', g}           drop interactive jobs older than group g
 *               {type:'gen', id, g, keep, p, size, opt, src}
 *                 src = null (logo) | {kind:'image', id} | {kind:'scene', scene, w, h}
 * Messages out: {type:'progress'|'done'|'cancelled'|'error', id, ...}
 */
(() => {
  const CACHE = new Map(), IMAGES = new Map(), SCENES = new Map();
  let below = 0;
  self.onmessage = async (e) => {
    const m = e.data;
    if (m.type === 'image') { IMAGES.set(m.image.id, m.image); while (IMAGES.size > 8) IMAGES.delete(IMAGES.keys().next().value); return; }
    if (m.type === 'cancelBelow') { below = Math.max(below, m.g); return; }
    if (m.type !== 'gen') return;
    const { id, g, keep } = m, cancelled = () => !keep && g < below;
    try {
      let image = null;
      if (m.src && m.src.kind === 'scene') {
        const key = JSON.stringify(m.src.scene) + '|' + [m.p.iLightX, m.p.iLightY, m.src.w, m.src.h].join(',');
        image = SCENES.get(key);
        if (!image) {
          image = await Comput.renderScene(m.src.scene, m.p, m.src.w, m.src.h, { cancelled });
          SCENES.set(key, image); while (SCENES.size > 4) SCENES.delete(SCENES.keys().next().value);
        }
      } else if (m.src && m.src.kind === 'image') {
        image = IMAGES.get(m.src.id);
        if (!image) throw new Error('image-missing');
      }
      const motion = m.opt && (m.opt.init || m.opt.stable || m.opt.fixedN);
      const r = await Comput.generate(m.p, m.size, {
        ...m.opt, image, cancelled, cache: motion ? undefined : CACHE,
        onProgress: (f) => self.postMessage({ type: 'progress', id, f }),
      });
      self.postMessage({ type: 'done', id, r });
    } catch (err) {
      self.postMessage({ type: err instanceof Comput.Cancelled ? 'cancelled' : 'error', id, message: String((err && err.message) || err) });
    }
  };
})();

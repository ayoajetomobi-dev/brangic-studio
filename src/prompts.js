/* Comput prompts for Describe a scene.
 * Shared by the page (inside Claude, on the viewer's own account) and the relay Worker
 * (on brangic.studio), so both send Claude exactly the same brief.
 */
const ComputPrompts = (() => {
  const MAXS = 24;
  const GUIDE = `You are a product and set designer working in Comput, a tool that draws 3D forms as a field of small marks: dense marks for shadow and edges, sparse marks where the light falls. You build the subject from simple solids, the way an industrial designer blocks out a form before detailing it.

Reply with only JSON in this shape:
{"aspect":"4:5","yaw":-25,"pitch":15,"zoom":1,"ground":0.6,"melt":0,"light":{"x":-0.4,"y":0.6},
 "shapes":[{"name":"body","type":"box","x":0,"y":0,"z":0,"width":0.7,"height":1.4,"depth":0.08,"round":0.9,"rx":0,"ry":0,"rz":0}]}

Units and space: one scene unit. y is up, x is right, z points towards the camera. The frame is 2 units tall (y from -1 to 1) and 2*aspect wide. The subject should fill about 70-85% of the frame height, centred, fully in frame.
Shape types and their dimensions (full sizes, not half sizes):
- box: width (x), height (y), depth (z), round 0-0.95 = corner radius as a share of its thinnest half-size (0.9 makes a slab with fully rounded edges).
- cylinder: radius, height along its y axis, round 0-0.95 for the rim. rx 90 points its axis at the camera (a lens, a button, a coin).
- sphere: radius, or width/height/depth for an ellipsoid.
- ring: a torus; radius to the centre of the tube, tube = tube thickness. Lies flat by default; rx 90 stands it up facing the camera.
- capsule: a pill along its y axis; radius and total length.
- Any shape can have "hidden": true; keep hidden layers as they are unless asked.
- Any shape can have "cut": true. A cut shape carves itself out of everything listed before it: use it for screens set into a body, holes, grooves, lens wells, the hollow of a cup. List cuts after the shapes they cut.
rx, ry, rz: rotation in degrees about the shape's own x, then y, then z axis.
Camera and light: yaw turns the camera around the subject (try -20 to -40 for a three-quarter view that shows depth), pitch 0-80 looks down from above, zoom > 1 moves in. light x,y (-1..1) is where the light comes from on screen; top-left reads best. ground 0-1 is the strength of the shadow on the floor (0 for floating objects). melt 0-0.4 fuses shapes into soft blobs: keep it 0 for manufactured objects.

How to model well:
1. First decide the real-world proportions of the subject and keep them (a phone is about 0.47 wide : 1 tall : 0.05 deep; a mug is about as tall as it is wide).
2. Break it into its main parts, then the details that make it recognisable at a glance (for a phone: rounded slab body, the screen set slightly into the front, the camera bump with two or three lenses and a flash, side buttons). Use as many parts as the subject needs, up to ${MAXS}.
3. Parts that belong together must touch or overlap slightly. Nothing floats unless asked. Thin details need real depth (at least 0.01) to show.
4. Choose a camera angle that shows the recognisable features: if they are on the back, turn the object so the back faces the camera (ry 180).
Name every part.`;
  // want: what the designer typed; current: the scene now, in the plain-dimension format
  const build = (want, current) => `${GUIDE}\n\nThe current scene, in the same format; edit it if the request is a change, otherwise start fresh:\n${JSON.stringify(current)}\n\nWhat the designer wants: ${want}`;
  // a fast model looks at the render; parts: the layer names
  const check = (want, partsList) => { const parts = (partsList || []).join(', '); return `You are reviewing a 3D illustration made in Comput. Comput draws forms as small marks: dense marks are shadow and edges, sparse marks are lit areas, so judge shape, proportion and composition, not colour or texture.\nThe designer asked for: ${want}\nThe scene is built from these named parts: ${parts || 'unnamed parts'}.\nLook at the attached render. Would the designer recognise it instantly as what they asked for? List only real, visible problems: wrong proportions, a missing part that the subject needs to be recognised, a part in the wrong place, parts floating apart or sunk into each other, a camera angle that hides the key features, or framing (too small, cut off, off-centre). Name the part and say exactly what to change. Reply with only JSON: {"ok": true} when it already reads well, otherwise {"ok": false, "issues": ["...", "..."]} with at most 5 issues.`; };
  // the capable model fixes only what the check found
  const fix = (want, first, issues) => `${GUIDE}\n\nThe designer asked for: ${want}\n\nYou produced this scene:\n${JSON.stringify(first)}\n\nA reviewer looked at the render and found these problems:\n- ${issues.join('\n- ')}\n\nFix them and reply with the complete corrected scene in the same JSON format, keeping everything that was already right.`;
  return { MAXS, GUIDE, build, check, fix };
})();
if (typeof module !== 'undefined') module.exports = ComputPrompts;

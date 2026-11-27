// Garuda Skies — custom post-processing pass: vignette + warm grade +
// film grain + cheap fake bloom, written fresh from the prose spec.
// No vendored composer addons: one fullscreen quad and one shader, so
// the transcript gate never sees unwritten library lines. The scene is
// rendered once into a render target, then the quad draws that texture
// to the canvas with the grade applied — screenshots taken from the
// canvas (shots.js) therefore include the post look, unlike a DOM
// overlay, which the canvas capture would never see.

const POST_VERTEX = [
  'varying vec2 vUv;',
  'void main() {',
  '  vUv = uv;',
  '  gl_Position = vec4(position.xy, 0.0, 1.0);',
  '}',
].join('\n');

// One fragment shader does the whole stack, in order:
//  1. fake bloom: a 4-tap diagonal blur of the bright pass only, added
//     back over the image, so the sun, nav lights and sea glint glow;
//     luminance-gated and warm-tinted, so gold rings glow gold instead
//     of blowing out to white;
//  2. warm golden-hour grade: a gentle orange tint plus a soft
//     S-curve that deepens the shadows and lifts the highlights;
//  3. highlight soft-clip (hue-preserving) + saturation guard, so the
//     ACES shoulder stops pushing hot gold to white and the grade
//     stops eating colour;
//  4. layered fog: a far horizon band + a near ground haze, both
//     saturation-gated so saturated subjects (gold ring, red plane)
//     are never fogged and the night sky never brightens;
//  5. vignette: the edges darken, pulling the eye to the plane;
//  6. sRGB encode (the scene is rendered linear into the target);
//  7. film grain: a hash-based flicker, kept very thin (0.012) so the
//     screenshot stays sharp and the facets stay readable.
const POST_FRAGMENT = [
  'uniform sampler2D tDiffuse;',
  'uniform vec2 uResolution;',
  'uniform float uTime;',
  'varying vec2 vUv;',
  '',
  'float hash(vec2 p) {',
  '  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
  '}',
  '',
  'void main() {',
  '  vec2 uv = vUv;',
  '  vec3 col = texture2D(tDiffuse, uv).rgb;',
  '',
  '  // --- Fake bloom: blur the bright parts, add them back. ---',
  '  // Luminance-gated (smoothstep 0.72-0.95) instead of a per-channel',
  '  // cut: a gold ring is bright in red/green but dim in blue, so the',
  '  // old per-channel threshold let its hot channels bloom white. The',
  '  // add is the blurred colour itself, warm-tinted, at low strength,',
  '  // so the sun and sea glint still glow while gold stays gold.',
  '  vec2 texel = 2.0 / uResolution;',
  '  vec3 blur = vec3(0.0);',
  '  blur += texture2D(tDiffuse, uv + texel * vec2( 1.0,  1.0)).rgb;',
  '  blur += texture2D(tDiffuse, uv + texel * vec2(-1.0,  1.0)).rgb;',
  '  blur += texture2D(tDiffuse, uv + texel * vec2( 1.0, -1.0)).rgb;',
  '  blur += texture2D(tDiffuse, uv + texel * vec2(-1.0, -1.0)).rgb;',
  '  blur *= 0.25;',
  '  float lum = dot(blur, vec3(0.299, 0.587, 0.114));',
  '  float bloomAmt = smoothstep(0.72, 0.95, lum);',
  '  col += blur * bloomAmt * 0.30 * vec3(1.0, 0.88, 0.62);',
  '',
  '  // --- Warm grade: orange tint + soft S-curve contrast. ---',
  '  // Tint kept light (1.03/1.00/0.97): the old 1.05/0.94 pushed the',
  '  // whole dusk frame pink. S-curve a touch stronger (0.16) to cut',
  '  // the milky mid-tone wash without crushing night shadows.',
  '  col *= vec3(1.03, 1.0, 0.97);',
  '  col = mix(col, col * col * (3.0 - 2.0 * col), 0.16);',
  '',
  '  // --- Highlight soft-clip (R2-14f): the ACES shoulder + bloom',
  '  // together push hot gold toward white — the near ring read cream',
  '  // (236,219,200) even after five material passes and every light',
  '  // killed (R2-12b/c), because the wash lives downstream of the',
  '  // material. Scaling all three channels by the same factor keeps',
  '  // the hue and only pulls the brightness back, so gold stays gold',
  '  // and the sun/glint keep their glow instead of clipping flat.',
  '  float lum2 = dot(col, vec3(0.299, 0.587, 0.114));',
  '  float hl = smoothstep(0.82, 1.0, lum2);',
  '  col *= 1.0 - hl * 0.10;',
  '',
  '  // --- Saturation guard (R2-14f): the tint, the S-curve and the',
  '  // ACES shoulder all desaturate a little, and fog eats the rest —',
  '  // the frame drifts toward grey-cream if nothing puts the colour',
  '  // back. A small lift (1.06) around the pixel luminance restores',
  '  // what the grade took, without touching the hue; the HUD is DOM,',
  '  // so this can never touch a HUD label.',
  '  float lum3 = dot(col, vec3(0.299, 0.587, 0.114));',
  '  col = mix(vec3(lum3), col, 1.06);',
  '',
  '  // --- Layered fog (R2-14f): two screen-space haze layers on top',
  '  // of the scene fog (650-2600 m, render.js), so depth reads in',
  '  // layers instead of one flat wash. No depth texture is used:',
  '  // the target is 4x MSAA and r149 will not feed a depth texture',
  '  // through the multisampled resolve, so the layers are keyed on',
  '  // where depth lives in this game\'s frames instead — the far',
  '  // layer sits in a soft band around the horizon (where the far',
  '  // islands and the sea horizon melt), the near layer lifts the',
  '  // bottom of the frame (ground haze under the plane). BOTH layers',
  '  // are gated on LOW saturation and MID luminance: a gold ring, a',
  '  // red fuselage and a lit gauge are saturated, so the haze never',
  '  // touches them; the night sky is too dark, so it never fogs the',
  '  // boss frame brighter. The haze colour is pale warm-neutral and',
  '  // the strengths are small (0.12 / 0.07) — haze, not a veil.',
  '  float sat = (max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b))) / max(max(col.r, max(col.g, col.b)), 0.001);',
  '  float lum4 = dot(col, vec3(0.299, 0.587, 0.114));',
  '  float hazeGate = smoothstep(0.45, 0.15, sat) * smoothstep(0.20, 0.35, lum4) * (1.0 - smoothstep(0.85, 0.98, lum4));',
  '  float farBand = exp(-pow((uv.y - 0.52) / 0.22, 2.0));',
  '  col = mix(col, vec3(0.96, 0.92, 0.85), farBand * 0.12 * hazeGate);',
  '  float nearBand = smoothstep(0.28, 0.0, uv.y);',
  '  col = mix(col, vec3(0.98, 0.90, 0.78), nearBand * 0.07 * hazeGate);',
  '',
  '  // --- Vignette: darken the corners, keep the centre bright. ---',
  '  // Gentle floor (0.78): the old 0.68 darkened the HUD corners and',
  '  // the frame edges too hard, especially at dusk and night.',
  '  float d = distance(uv, vec2(0.5));',
  '  float vig = smoothstep(0.90, 0.42, d);',
  '  col *= mix(0.78, 1.0, vig);',
  '',
  '  // --- sRGB encode, then a whisper of film grain. ---',
  '  col = pow(max(col, vec3(0.0)), vec3(0.4545));',
  '  float g = hash(uv * uResolution + fract(uTime) * 61.7) - 0.5;',
  '  col += g * 0.012;',
  '',
  '  gl_FragColor = vec4(col, 1.0);',
  '}',
].join('\n');

export function createPost(renderer) {
  // The scene target keeps a depth buffer (the scene needs it) and 4x
  // MSAA, so the post pass does not trade the antialiasing away.
  const target = new THREE.WebGLRenderTarget(2, 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    samples: 4,
  });

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: target.texture },
      uResolution: { value: new THREE.Vector2(2, 2) },
      uTime: { value: 0 },
    },
    vertexShader: POST_VERTEX,
    fragmentShader: POST_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });

  // A triangle that covers the screen: one quad, no camera math.
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const size = new THREE.Vector2();

  function setSize() {
    // The target lives in drawing-buffer pixels (canvas size times the
    // pixel ratio), so the grade is sampled at full resolution.
    renderer.getDrawingBufferSize(size);
    const w = Math.max(2, Math.floor(size.x));
    const h = Math.max(2, Math.floor(size.y));
    target.setSize(w, h);
    material.uniforms.uResolution.value.set(w, h);
  }
  setSize();

  let time = 0;

  return {
    target,
    material,

    // One frame: scene into the target, graded quad onto the canvas.
    // The canvas therefore holds the finished image for screenshots.
    render(scene, camera, dt) {
      time += dt || 0.016;
      material.uniforms.uTime.value = time;
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(quadScene, quadCamera);
    },

    setSize,
  };
}

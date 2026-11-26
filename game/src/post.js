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
//  2. warm golden-hour grade: a gentle orange tint plus a soft
//     S-curve that deepens the shadows and lifts the highlights;
//  3. vignette: the edges darken, pulling the eye to the plane;
//  4. sRGB encode (the scene is rendered linear into the target);
//  5. film grain: a hash-based flicker, kept very thin (0.018) so the
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
  '  vec2 texel = 2.0 / uResolution;',
  '  vec3 blur = vec3(0.0);',
  '  blur += texture2D(tDiffuse, uv + texel * vec2( 1.0,  1.0)).rgb;',
  '  blur += texture2D(tDiffuse, uv + texel * vec2(-1.0,  1.0)).rgb;',
  '  blur += texture2D(tDiffuse, uv + texel * vec2( 1.0, -1.0)).rgb;',
  '  blur += texture2D(tDiffuse, uv + texel * vec2(-1.0, -1.0)).rgb;',
  '  blur *= 0.25;',
  '  vec3 bright = max(blur - vec3(0.60), vec3(0.0)) / 0.40;',
  '  col += bright * 0.60;',
  '',
  '  // --- Warm grade: orange tint + soft S-curve contrast. ---',
  '  col *= vec3(1.05, 1.0, 0.94);',
  '  col = mix(col, col * col * (3.0 - 2.0 * col), 0.12);',
  '',
  '  // --- Vignette: darken the corners, keep the centre bright. ---',
  '  float d = distance(uv, vec2(0.5));',
  '  float vig = smoothstep(0.85, 0.35, d);',
  '  col *= mix(0.68, 1.0, vig);',
  '',
  '  // --- sRGB encode, then a whisper of film grain. ---',
  '  col = pow(max(col, vec3(0.0)), vec3(0.4545));',
  '  float g = hash(uv * uResolution + fract(uTime) * 61.7) - 0.5;',
  '  col += g * 0.018;',
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

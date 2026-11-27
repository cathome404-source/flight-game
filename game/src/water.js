// Garuda Skies — water: realistic sea surface (R2-14e).
//
// A NEW, self-contained module: it builds its own sea plane and does NOT
// touch gameplay, sorties, HUD, or any other file. Wiring is a separate
// integration session (R2-14g). Drop-in replacement for the old sea in
// world.js: same size (4200 m), same y = 0, same userData contract
// (basePositions + shader.uTime) so the existing swell loop in render.js
// keeps driving it with zero changes.
//
// INTEGRATOR — how to wire (3 lines in world.js / main.js):
//   import { initWater } from './water.js';
//   const water = initWater(scene, { envMap: scene.environment });
//   // ...and use water.mesh INSTEAD of the old sea mesh (do not add both:
//   // two coplanar seas z-fight). Then per frame: water.update(t, sun)
//   // where sun = { direction, color, intensity } from the time-of-day
//   // keyframes (render.js already computes these for the sun light).
//   // If render.js keeps driving the swell + uTime through the old
//   // world.sea contract, water.update(t) still works — it only sets
//   // uniforms, and the swell write is idempotent (always from base).
//   // Recommended: REMOVE the old makeGlintStreak() mesh — the shader
//   // glint below already draws the sun path; keeping the streak doubles
//   // the highlight. The old foam rings (world.js) may stay: they sit at
//   // y = 2.2 above this surface and complement the in-shader foam.
//
// WHAT IT DOES (all five R2-14e requirements):
//   1. Normal-mapped waves — a tileable normal map is generated
//      procedurally at runtime on a canvas (no downloaded asset, no
//      non-CC0 risk, +0 bytes in game/). Two scrolling layers (90 m and
//      28 m tiles) plus a STATIC macro facet field.
//   2. Strong specular sun glint — tight glitter (pow 700) + broad sheen
//      (pow 90) toward the sun, added in linear HDR before tone mapping,
//      scaled by the sun intensity the integrator passes in.
//   3. Foam at the shoreline — analytic band around every island rim
//      (distance to nearest island, from the same island table as
//      config.js WORLD.islands), scalloped + streaked, matte white.
//   4. Environment reflection — MeshStandardMaterial, so scene.environment
//      (the PMREM sunset/dusk/overcast HDRI from envmap.js) reflects with
//      roughness 0.12; envMapIntensity 0.85. Pass envMap explicitly via
//      options to pin one map, or leave it unset to follow scene.environment.
//   5. Deep vs shallow colour — analytic gradient in the shader (turquoise
//      0x26a48d near shore -> deep blue 0x0d4258 out at sea, the same
//      PALETTE values world.js bakes per vertex), so the gradient is smooth
//      at any zoom instead of stepping across 60x60 vertices.
//   6. ALIVE IN A STILL (the R2-13 note: "laut tetap datar pucat di still"):
//      the macro facet field and both normal-map layers are SPATIAL —
//      they exist at t = 0 and only SCROLL with time, so a frozen frame
//      still shows tilted facets, sparkle and a broken-up sun path. The
//      fine layers fade only past ~500 m (a pixel out there covers several
//      ripple wavelengths, so fading avoids horizon moire); the macro
//      facets never fade — they are low-frequency and cannot alias.
//
// (THREE is the global from index.html's classic script tag — this module
// must NOT import vendor/three.min.js, which has no ES exports and would
// shadow the global with an empty namespace. Same rule as envmap.js.)

// Island table — same numbers as WORLD.islands in config.js (duplicated
// here so this module stays self-contained; the integrator may override
// via options.islands). Format: x, z, radius (metres).
const DEFAULT_ISLANDS = [
  { x: 0, z: 0, radius: 620 },
  { x: 1150, z: -950, radius: 480 },
  { x: -1250, z: -350, radius: 380 },
  { x: 950, z: 1150, radius: 340 },
  { x: -850, z: -1250, radius: 210 },
];
const ISLAND_COUNT = 5;

// Golden-hour default sun (WORLD.sun in config.js): azimuth 262 deg,
// elevation 10.5 deg. Direction points FROM the water TOWARD the sun.
function defaultSunDirection() {
  const az = (262 * Math.PI) / 180;
  const el = (10.5 * Math.PI) / 180;
  return new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el)
  ).normalize();
}

// Tileable procedural water normal map (256 px, generated locally).
// Heightfield = sum of sine waves whose cycle counts are INTEGERS per
// tile, so the map wraps seamlessly in both axes. Normals come from
// central differences with wrap-around. Multi-scale on purpose: the
// low cycles give rolling chop, the high cycles give fine sparkle.
function makeWaterNormalMap(size = 256) {
  const N = size;
  // [cyclesX, cyclesZ, amplitude, phase] — keep the mix anisotropic
  // (waves do not all run the same way) so the pattern never reads as
  // a grid of parallel stripes.
  const waves = [
    [3, 2, 0.55, 0.0],
    [5, 3, 0.35, 1.3],
    [8, 5, 0.22, 2.1],
    [11, 9, 0.14, 0.7],
    [17, 13, 0.09, 2.9],
    [23, 19, 0.06, 4.1],
    [31, 27, 0.04, 1.9],
    [4, 7, 0.3, 3.3],
    [9, 4, 0.18, 5.0],
    [13, 17, 0.1, 0.4],
  ];
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (let w = 0; w < waves.length; w++) {
        const [cx, cz, a, p] = waves[w];
        v += a * Math.sin((2 * Math.PI * (cx * x + cz * y)) / N + p);
      }
      h[y * N + x] = v;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(N, N);
  const d = img.data;
  // Slope scale: how steep the encoded normals are. 2.0 reads clearly
  // in a still without turning the sea into crumpled foil (2.4 did —
  // the high harness shot came out polka-dot pale).
  const s = 2.0;
  for (let y = 0; y < N; y++) {
    const yu = (y - 1 + N) % N;
    const yd = (y + 1) % N;
    for (let x = 0; x < N; x++) {
      const xl = (x - 1 + N) % N;
      const xr = (x + 1) % N;
      const dx = (h[y * N + xr] - h[y * N + xl]) * 0.5 * s;
      const dy = (h[yd * N + x] - h[yu * N + x]) * 0.5 * s;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * N + x) * 4;
      d[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      d[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      d[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// initWater(scene, options) -> { mesh, update, setSun, dispose }
//
// scene   — the THREE.Scene the sea is added to.
// options — all optional:
//   envMap        THREE.Texture (a PMREM target texture) or null to
//                 follow scene.environment (default: null).
//   sunDirection  THREE.Vector3 pointing toward the sun (default:
//                 golden-hour azimuth 262 / elevation 10.5).
//   sunColor      hex (default 0xffd27a, the golden-hour sun).
//   sunIntensity  number (default 1.9, matches the sun light).
//   islands       [{x, z, radius}] (default: the 5 WORLD islands).
//   size          sea plane width in metres (default 4200).
//   segments      plane subdivisions per side (default 80 — the swell
//                 wavelengths are ~300 m, so 52 m spacing stays smooth;
//                 the fine detail comes from the normal map, not verts).
//   shallow / deep / foam hex colours (defaults: PALETTE.seaShallow,
//                 PALETTE.seaDeep, PALETTE.seaFoam from world.js).
//   roughness     base water roughness (default 0.16 — sharp enough for
//                 a sun reflection, dull enough that the sunset env does
//                 not wash the sea pale; foam forces 0.95 locally in the
//                 shader).
//   envMapIntensity (default 0.55 — the old sea used 0.4 because the env
//                 washed it pale mint; 0.85 in the R2-14e pass-1 harness
//                 did the same, so this sits between: the deep colour
//                 survives while the sky still reflects).
//
// update(t, sun) — call once per frame. t is seconds (same ambient clock
//   render.js uses); sun optionally overrides { direction, color,
//   intensity } for this frame (time-of-day / storm changes).
// setSun(sun) — same override without touching the clock.
// dispose() — frees geometry, material and the normal-map texture.
export function initWater(scene, options = {}) {
  const islands = (options.islands || DEFAULT_ISLANDS).slice(0, ISLAND_COUNT);
  while (islands.length < ISLAND_COUNT) {
    islands.push({ x: 1e6, z: 1e6, radius: 1 }); // dummy: never nearest
  }
  const islandVecs = islands.map(
    (isl) => new THREE.Vector3(isl.x, isl.z, isl.radius)
  );

  const normalMap = makeWaterNormalMap(256);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: options.roughness !== undefined ? options.roughness : 0.16,
    metalness: 0,
  });
  mat.envMapIntensity =
    options.envMapIntensity !== undefined ? options.envMapIntensity : 0.55;
  if (options.envMap) mat.envMap = options.envMap;
  // Same polygon offset the old sea used: at grazing angles the sea
  // plane (y = 0) and the beach top (y = 2) are ~0.2 m apart along the
  // view ray, below the depth buffer's resolution at 1 km — without the
  // offset the sea showed through the beach in moire stripes.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 1;
  mat.polygonOffsetUnits = 2;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uNormalMap = { value: normalMap };
    shader.uniforms.uSunDir = {
      value: (options.sunDirection || defaultSunDirection()).clone(),
    };
    shader.uniforms.uSunColor = {
      value: new THREE.Color(
        options.sunColor !== undefined ? options.sunColor : 0xffd27a
      ),
    };
    shader.uniforms.uSunIntensity = {
      value: options.sunIntensity !== undefined ? options.sunIntensity : 1.9,
    };
    shader.uniforms.uShallow = {
      value: new THREE.Color(
        options.shallow !== undefined ? options.shallow : 0x26a48d
      ),
    };
    shader.uniforms.uDeep = {
      value: new THREE.Color(
        options.deep !== undefined ? options.deep : 0x0d4258
      ),
    };
    shader.uniforms.uFoamColor = {
      value: new THREE.Color(
        options.foam !== undefined ? options.foam : 0xfdf6dd
      ),
    };
    shader.uniforms.uIslands = { value: islandVecs };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWaterWorldPos;\nvarying vec3 vWaterWorldNormal;'
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvWaterWorldNormal = normalize(mat3(modelMatrix) * objectNormal);'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vWaterWorldPos;
        varying vec3 vWaterWorldNormal;
        uniform float uTime;
        uniform sampler2D uNormalMap;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uSunIntensity;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uFoamColor;
        uniform vec3 uIslands[${ISLAND_COUNT}];`
      )
      // Depth gradient + foam, computed before lighting. foamFactor is
      // declared here (same main() scope) and reused by the roughness
      // and glint patches below.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Distance to the nearest island rim, in metres: 0 at the
        // waterline, growing out to sea. Analytic (5 islands), so the
        // gradient is smooth at any zoom.
        float shoreDist = 1e5;
        for (int i = 0; i < ${ISLAND_COUNT}; i++) {
          shoreDist = min(shoreDist, distance(vWaterWorldPos.xz, uIslands[i].xy) - uIslands[i].z);
        }
        float depthT = smoothstep(30.0, 380.0, shoreDist);
        depthT = depthT * depthT * (3.0 - 2.0 * depthT);
        vec3 waterCol = mix(uShallow, uDeep, depthT);
        // Foam: a breaking band just OUTSIDE the beach rim. The beach rim
        // (world.js) is a disc out to ~1.06x the island radius, so a band
        // at 4–30 m would hide UNDER the sand — the R2-14e harness proved
        // it: foam only showed around the smallest island, where 1.06x
        // radius ends before 30 m. The band therefore starts at 18 m and
        // runs to ~110 m out, scalloped by two slow sines so the edge
        // wobbles and streaks instead of drawing a perfect ring. The band
        // breathes with uTime but never vanishes: at any frozen t it is
        // still a visible white fringe, not an animation-only effect.
        float foamScallop = 0.5 + 0.5 * sin(shoreDist * 0.35 + uTime * 1.4)
                          + 0.5 * sin(vWaterWorldPos.x * 0.05 + vWaterWorldPos.z * 0.043 - uTime * 0.9);
        float foamBand = smoothstep(18.0, 35.0, shoreDist) * (1.0 - smoothstep(55.0, 110.0, shoreDist));
        float foamFactor = clamp(foamBand * (0.45 + 0.55 * clamp(foamScallop * 0.5, 0.0, 1.0)), 0.0, 1.0);
        diffuseColor.rgb = mix(waterCol, uFoamColor, foamFactor);`
      )
      // Foam is matte: force roughness up inside the band.
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.95, foamFactor);'
      )
      // Normal-mapped waves. Runs after the default normal setup and
      // REPLACES the view-space normal with a world-space perturbation
      // transformed back — so the pattern is anchored to the sea, not
      // to the camera, and cannot swim when the chase camera orbits.
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        {
          // Two scrolling normal-map layers: medium chop (~90 m tile,
          // slow drift) and fine sparkle (~28 m tile, faster drift).
          // Both are spatial patterns: at any frozen uTime they still
          // tilt the surface, so the still frame keeps its texture.
          vec2 uv1 = vWaterWorldPos.xz * 0.011 + uTime * vec2(0.008, 0.005);
          vec2 uv2 = vWaterWorldPos.xz * 0.035 + uTime * vec2(-0.011, 0.007);
          vec3 n1 = texture2D(uNormalMap, uv1).rgb * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormalMap, uv2).rgb * 2.0 - 1.0;
          // Macro facets — STATIC, the still-readability core. Two long
          // crossing swells (~260 m and ~170 m) tilt whole facets so the
          // sun and sky reflections break into broad light/dark bands
          // even in a screenshot. Deliberately NOT time-driven and NOT
          // distance-faded: low frequency cannot moire at the horizon.
          float macroX = sin(vWaterWorldPos.x * 0.024 + vWaterWorldPos.z * 0.011) * 0.06
                       + sin(vWaterWorldPos.x * 0.013 - vWaterWorldPos.z * 0.021 + 1.7) * 0.05;
          float macroZ = cos(vWaterWorldPos.z * 0.019 - vWaterWorldPos.x * 0.008) * 0.06
                       + cos(vWaterWorldPos.x * 0.017 + vWaterWorldPos.z * 0.014 + 0.6) * 0.05;
          // The fine layers fade past ~500 m: out there one pixel covers
          // several ripple wavelengths and the pattern would alias into
          // stiff stripes on the far sea. The macro facets stay.
          float fineFade = 1.0 - smoothstep(500.0, 1400.0, length(vViewPosition));
          vec3 wN = normalize(vWaterWorldNormal + vec3(
            macroX + (n1.x * 0.40 + n2.x * 0.25) * fineFade,
            0.0,
            macroZ + (n1.y * 0.40 + n2.y * 0.25) * fineFade));
          normal = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
        }`
      )
      // Sun glint, added in linear HDR before tone mapping so the
      // highlight can exceed 1.0 and bloom softly instead of clipping
      // to flat white. Tight glitter (pow 700) from the fine normals
      // plus a broad sheen (pow 90) for the sun path; both scale with
      // the sun intensity, so dusk/storm dim the glint with the light.
      // Foam kills the glint (matte surf does not mirror the sun).
      .replace(
        '#include <output_fragment>',
        `#include <output_fragment>
        {
          vec3 V = normalize(vViewPosition);
          vec3 L = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
          vec3 H = normalize(L + V);
          float ndh = clamp(dot(normal, H), 0.0, 1.0);
          float glint = pow(ndh, 700.0) * 3.0 + pow(ndh, 90.0) * 0.55;
          gl_FragColor.rgb += uSunColor * glint * uSunIntensity * (1.0 - foamFactor * 0.85);
        }`
      );
    mesh.userData.shader = shader;
  };

  const size = options.size !== undefined ? options.size : 4200;
  const segments = options.segments !== undefined ? options.segments : 80;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  mesh.name = 'water';
  // Drop-in contract for the render.js swell loop: rest positions the
  // loop writes heights from, and the compiled shader (uTime) it drives.
  mesh.userData.basePositions = geo.attributes.position.array.slice();

  scene.add(mesh);

  function setSun(sun) {
    const shader = mesh.userData.shader;
    if (!shader) return; // not compiled yet (first render pending)
    if (sun.direction) shader.uniforms.uSunDir.value.copy(sun.direction);
    if (sun.color !== undefined) shader.uniforms.uSunColor.value.set(sun.color);
    if (sun.intensity !== undefined) {
      shader.uniforms.uSunIntensity.value = sun.intensity;
    }
  }

  function update(t, sun) {
    const shader = mesh.userData.shader;
    if (shader) shader.uniforms.uTime.value = t;
    if (sun) setSun(sun);
  }

  function dispose() {
    scene.remove(mesh);
    geo.dispose();
    mat.dispose();
    normalMap.dispose();
  }

  const api = { mesh, update, setSun, dispose };
  mesh.userData.water = api;
  return api;
}

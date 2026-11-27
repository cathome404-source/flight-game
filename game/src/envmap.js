// Garuda Skies — environment maps from curated CC0 sky HDRIs (R2-4b).
// Uses the global THREE loaded by index.html as a classic script (no
// import) — like every other src/ module in this game.
// The raw 1K .hdr files from Poly Haven are ~1.2–1.5 MiB each, so the
// game vendors only small tonemapped equirect JPEGs (1024x512, ~70 KiB)
// derived from them offline; the .hdr originals are NOT in the repo.
// At runtime the equirect JPEG is pushed through the r149 core
// PMREMGenerator (no RGBELoader vendored) and becomes scene.environment,
// so the R2-3 MeshStandardMaterial aircraft / rings pick up real sky
// reflections instead of the flat hemisphere bounce alone.
// The map follows the time of day: bright noon sky at midday,
// golden sunset by day, dusk after ~18:50, flat overcast while the
// boss storm is up. Switching is lazy
// (each map loads once, on first use) and the previous PMREM target is
// disposed, so only one environment lives in GPU memory at a time.

// (THREE is the global from index.html's classic script tag —
// this module must NOT import vendor/three.min.js, which has no ES
// exports and would shadow the global with an empty namespace.)

// Which vendored equirect file serves which sky. Keys are chosen by
// applyForTime; the file names match game/assets/SOURCES.md.
const ENVS = {
  noon: 'assets/env_noon.jpg',
  sunset: 'assets/env_sunset.jpg',
  dusk: 'assets/env_dusk.jpg',
  overcast: 'assets/env_overcast.jpg',
};

// Per-environment reflection strength (R2-14f). The PMREM sky is the
// PBR light that makes the aircraft skin and the gold rings read as
// metal — but at full strength (envMapIntensity 1.0) it washes every
// shaded face toward flat cream: R2-12c measured that env=null
// de-washes the aircraft hard ((208,106,92) -> (149,62,52)), and
// R2-12e had to cut the sea to 0.4 for the same reason. These factors
// keep the reflections (the PBR read) while leaving the sun (1.9) as
// the contrast: noon brightest because the sky itself is the key
// light at midday, dusk/overcast lowest because their skies are dim
// and the fill lights already carry the scene.
const ENV_INTENSITY = {
  noon: 0.65,
  sunset: 0.6,
  dusk: 0.55,
  overcast: 0.5,
};

export function createEnvMaps(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const loader = new THREE.TextureLoader();
  const cache = {}; // key -> PMREM RenderTarget (kept, reused on revisit)
  let current = null; // key of the environment currently applied
  let currentTarget = null;
  let pendingKey = 'sunset'; // key of the load currently in flight
  let lastChildCount = -1; // scene child count at the last intensity pass

  // R2-14f: per-material env strength. scene.environment alone is
  // all-or-nothing in r149 (no scene.environmentIntensity), so the
  // wash control lives here: every Standard/Phong material gets
  // envMapIntensity = (its own authored base) x (current env factor).
  // The base is remembered on first sight, so a material the world
  // deliberately tuned (sea 0.4, R2-12e) keeps its tuning and is only
  // scaled, never overwritten. Materials added after the env switch
  // (the aircraft group is attached by main.js after render init)
  // are caught because applyForTime re-runs this pass whenever the
  // scene grows — it is called every frame by setTimeOfDay, but the
  // traversal itself only runs on a key change or a child-count change.
  const baseIntensity = new WeakMap();
  function applyEnvIntensity() {
    const factor = ENV_INTENSITY[current] || 0.6;
    scene.traverse((obj) => {
      const mat = obj && obj.material;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      for (const m of mats) {
        if (!m || (!m.isMeshStandardMaterial && !m.isMeshPhongMaterial)) continue;
        if (typeof m.envMapIntensity !== 'number') continue;
        if (!baseIntensity.has(m)) baseIntensity.set(m, m.envMapIntensity);
        m.envMapIntensity = baseIntensity.get(m) * factor;
      }
    });
    lastChildCount = scene.children.length;
  }

  function apply(key) {
    if (key === current && currentTarget) return;
    pendingKey = key;
    // Already converted once: re-apply the cached target, no reload.
    // Never dispose the target being switched away from: it lives in
    // the cache and is re-applied verbatim on the next revisit, and a
    // disposed PMREM target renders a dead (black) environment.
    if (cache[key]) {
      currentTarget = cache[key];
      scene.environment = currentTarget.texture;
      current = key;
      applyEnvIntensity();
      return;
    }
    loader.load(
      ENVS[key],
      (tex) => {
        // Equirectangular source: PMREM samples it as a full sky.
        tex.mapping = THREE.EquirectangularReflectionMapping;
        const target = pmrem.fromEquirectangular(tex);
        tex.dispose();
        cache[key] = target;
        // A newer switch may have landed while this one loaded; only
        // apply if this key is still the requested one.
        if (key !== pendingKey) return;
        currentTarget = target;
        scene.environment = target.texture;
        current = key;
        applyEnvIntensity();
      },
      undefined,
      () => {
        // A missing/corrupt env file must never break the game: the
        // sky dome + hemisphere light already carry the look, so a
        // failed environment load is silently ignored.
      }
    );
  }

  // Pick the map for a clock hour (0–24) and storm intensity (0–1).
  // Storm wins over the clock: the boss arena is overcast even at
  // golden hour. Dusk starts once the sun is properly down (~18:50)
  // and runs through the night until the 06:00 dawn keyframe. Noon
  // (R2-14f) is the bright clear sky 09:30–16:00: the old code served
  // the golden sunset HDRI at midday too, so noon flights were lit
  // by a warm dusk sky — the noon map gives midday its own clean
  // blue key light and stops the warm wash at 12:00.
  function applyForTime(hours, storm) {
    const h = (((hours % 24) + 24) % 24);
    let key = 'sunset';
    if (storm > 0.5) key = 'overcast';
    else if (h >= 18.8 || h < 6) key = 'dusk';
    else if (h >= 9.5 && h < 16) key = 'noon';
    apply(key);
    // The aircraft group (and any late mesh) lands in the scene
    // after the env switch: re-run the intensity pass when the scene
    // grew, so new materials get the current env factor instead of
    // the default 1.0 wash. Cheap check, runs the traversal only
    // when the child count actually changed.
    if (current && scene.children.length !== lastChildCount) applyEnvIntensity();
  }

  function dispose() {
    for (const k of Object.keys(cache)) cache[k].dispose();
    pmrem.dispose();
    scene.environment = null;
    current = null;
    currentTarget = null;
  }

  return { applyForTime, dispose };
}

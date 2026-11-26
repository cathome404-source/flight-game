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
// The map follows the time of day: golden sunset by day, dusk after
// ~18:50, flat overcast while the boss storm is up. Switching is lazy
// (each map loads once, on first use) and the previous PMREM target is
// disposed, so only one environment lives in GPU memory at a time.

// (THREE is the global from index.html's classic script tag —
// this module must NOT import vendor/three.min.js, which has no ES
// exports and would shadow the global with an empty namespace.)

// Which vendored equirect file serves which sky. Keys are chosen by
// applyForTime; the file names match game/assets/SOURCES.md.
const ENVS = {
  sunset: 'assets/env_sunset.jpg',
  dusk: 'assets/env_dusk.jpg',
  overcast: 'assets/env_overcast.jpg',
};

export function createEnvMaps(renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const loader = new THREE.TextureLoader();
  const cache = {}; // key -> PMREM RenderTarget (kept, reused on revisit)
  let current = null; // key of the environment currently applied
  let currentTarget = null;
  let pendingKey = 'sunset'; // key of the load currently in flight

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
  // and runs through the night until the 06:00 dawn keyframe.
  function applyForTime(hours, storm) {
    const h = (((hours % 24) + 24) % 24);
    let key = 'sunset';
    if (storm > 0.5) key = 'overcast';
    else if (h >= 18.8 || h < 6) key = 'dusk';
    apply(key);
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

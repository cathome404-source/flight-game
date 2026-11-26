# Garuda Skies — curated CC0 assets (R2-4b)

Every asset in this directory is **CC0 / public domain** from Poly Haven
(https://polyhaven.com — "CC0 means absolute freedom"; all of its HDRIs,
textures and models are released under CC0 1.0, no attribution required).
License verified per asset via the Poly Haven API
(https://api.polyhaven.com/assets and /files/<slug>) on 2026-11-27.
No asset comes from any other source; nothing was taken from competitor
screenshots.

## How the files got small

The raw downloads are too big to vendor (1K HDRIs are ~1.2–1.5 MiB each,
1K texture JPGs ~0.9–1.2 MiB each). Only small derivatives are vendored:

- HDRIs: raw 1K `.hdr` decoded with ffmpeg, tonemapped (Reinhard +
  exposure, sRGB) and saved as **1024×512 JPEG** (~63–73 KiB each).
  The `.hdr` originals are NOT in the repo.
- Textures: raw 1K JPGs downscaled to **512×512 JPEG q75** (~42–63 KiB).
  The 1K originals are NOT in the repo.

Total: 6 files, ~357 KiB. The game loads nothing from the network at
runtime — every file below is local under `game/assets/`.

## Environment maps (sky HDRIs → PMREM, wired in `src/envmap.js`)

| File | Poly Haven asset | License | Vendored size | Used as |
|---|---|---|---|---|
| `env_sunset.jpg` | [kiara_8_sunset](https://polyhaven.com/a/kiara_8_sunset) — clear golden sunset over rocky hills | CC0 | 73,197 B | `scene.environment` by day (golden hour) |
| `env_dusk.jpg` | [kiara_9_dusk](https://polyhaven.com/a/kiara_9_dusk) — clear dusk valley, cool-blue sky | CC0 | 67,615 B | `scene.environment` after ~18:50 / at night |
| `env_overcast.jpg` | [kloofendal_overcast_puresky](https://polyhaven.com/a/kloofendal_overcast_puresky) — soft overcast pure sky | CC0 | 62,935 B | `scene.environment` while the boss storm is up |

## Surface textures (wired in `src/world.js`, `applySurfaceTextures`)

| File | Poly Haven asset | License | Vendored size | Used as |
|---|---|---|---|---|
| `grass.jpg` | [leafy_grass](https://polyhaven.com/a/leafy_grass) — diffuse colour map | CC0 | 63,201 B | Terrain relief mesh, tiled 18× (multiplies the vertex colours) |
| `sand.jpg` | [coast_sand_01](https://polyhaven.com/a/coast_sand_01) — diffuse colour map | CC0 | 47,687 B | Beach-rim cylinders, tiled 6× |
| `asphalt.jpg` | [worn_asphalt](https://polyhaven.com/a/worn_asphalt) — diffuse colour map | CC0 | 41,691 B | Runway strip top, tiled 10× along the strip |

## What was considered and cut (budget / style)

- **Models: none taken.** Poly Haven models are realistic high-poly
  (wrong for this low-poly game) and Kenney/Quaternius low-poly models
  would have needed a separate download + GLTF loader vendoring for at
  most a marginal gain — the game already builds all aircraft, boats,
  huts and the lighthouse procedurally. 0 models, by design.
- **More HDRIs cut:** `golden_bay` (checked first, but it is a night
  urban waterfront, not a golden-hour sky), `belfast_sunset_puresky`,
  `qwantani_sunset_puresky`, `venice_sunset` — three skies already cover
  day / dusk / storm; extra variants add size, not visible difference.
- **More textures cut:** `aerial_beach_01`, `rocky_terrain`,
  `aerial_grass_rock` — the three chosen textures cover the three
  surfaces the camera actually rests on (grass, sand, asphalt).
- **Raw files cut:** all six `.hdr` / 1K-JPG originals (~7.3 MiB total)
  were downloaded to `/tmp` only, converted, and never vendored.

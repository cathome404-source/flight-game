# Referensi Game Pesawat — "Garuda Skies" (make.fun best-flight-game-20261126-0057)

Dokumen riset, dibuat 2026-11-26. Tujuan: teknik KONKRET dari game pesawat lain yang bisa
diterapkan ke game Three.js r149 low-poly kami (kepulauan tropis, golden hour, chase + kokpit,
5 misi, HUD lengkap, semua asset prosedural/lokal, tanpa network).
Judge menilai dari screenshot (contact sheet: cover 768×480 + 3 gambar) dan source outline —
maka teknik yang paling terlihat di GAMBAR STATIS diprioritaskan.

Status game kami saat riset ini dibuat: sudah ada shadow map, laut specular + foam, langit
gradient + matahari + fog, palem, gubuk, flap, lampu nav berkedip, inersia, turbulensi,
ground effect, audio prosedural. Kekurangan menurut pengguna: kurang smooth + kurang realistik.
Catatan: bayangan pesawat di screenshot belum terverifikasi terlihat jelas.

---

## 1. Ringkasan per game — apa yang bisa ditiru

### Microsoft Flight Simulator 2024 (simulator fotorealistik)
- **Awan volumetrik berlapis**: cirrus tipis di atas, cumulus tebal di bawah; awan tinggi
  tetap terang saat sunset sementara awan rendah lebih gelap (lighting tergantung ketinggian).
  → Tiru: 2–3 lapis awan di ketinggian berbeda, warna tiap lapis beda (atas hangat-terang,
  bawah ungu-gelap).
- **Sun angle rendah = terrain terbaca**: cahaya pagi/sore mengungkap relief terrain dan
  kedalaman bangunan; matahari siang membuat gambar datar. → Tiru: matahari tetap rendah
  (golden hour), bayangan panjang, fog hangat.
- **Air & darat 3D**: ombak dan fisika air disimulasi; permukaan tanah 3D (rumput/batu/genangan
  memengaruhi roda). → Tiru: sun-glint streak di air + gelombang vertex animasi + foam pantai.
- **Baling-baling dimodelkan seperti aslinya**: multi-sample ratusan kali per gerakan bilah.
  → Tiru: prop blur disc semi-transparan yang opacity-nya ikut throttle (sudah ada — pertegas).
- **Kabut berlapis dekat tanah** sampai ~2000 m. → Tiru: fog warna = warna langit (sudah ada),
  tambah lapisan kabut tipis di atas laut saat pagi.
- **Vegetasi 3D + bioma**: 23 bioma, vegetasi bervariasi. → Tiru: variasi warna vertex
  terrain (3 hijau sudah ada) + scatter pohon/batu dengan InstancedMesh.

### Ace Combat 7: Skies Unknown (arcade sinematik, Unreal Engine 4)
- **Awan volumetrik yang bisa diterbangi**: awan tebal, disinari matahari, ada es/hujan;
  terbang lewat awan gelap = visibilitas turun drastis (dipakai sebagai gameplay: sembunyi
  dari radar). → Tiru: gumpalan awan sebagai billboard berlapis yang bisa dilewati; saat
  pesawat masuk awan, layar berkabut putih (efek murah: overlay opacity).
- **Efek cuaca sinematik**: partikel hujan, tetesan air di kanopi, heat haze di knalpot,
  vapor trail tebal di langit, film grain halus, depth of field bergaya ISO tinggi,
  motion blur MINIMAL saat gameplay (supaya tetap terbaca) dan diperkuat hanya di cutscene.
  → Tiru: vapor/contrail dari ujung sayap saat belok tajam; film grain sangat halus;
  motion blur JANGAN berlebihan (screenshot harus tetap tajam).
- **Lighting dramatis**: matahari + flare, jet membelok lewat awan terang, siluet gelap
  di langit murung. → Tiru: sun disc + additive glow sprite di sekitar matahari.

### War Thunder (simulator tempur, damage model detail)
- **Vapour cone**: kerucut uap saat kecepatan transonik (gradien tekanan lokal).
  → Tiru (versi murah): cincin uap putih tipis di sekitar fuselage saat kecepatan tinggi.
- **Contrail & wingtip vortex**: contrail mesin lebih panjang, "fluffy", dengan turbulensi
  fisik; vortex cord panjang dari ujung sayap saat manuver. → Tiru: trail putih tipis dari
  ujung sayap saat bank tajam — SANGAT fotogenik di chase view, dan menjual "gerak" di
  screenshot statis.
- **Damage terbaca**: bekas hantaman (shrapnel/hit mark), api + gosong dinamis di tengah
  api, debu/tanah terlempar saat tabrakan dengan tanah, asap hitam tebal progresif
  (bukan langsung meledak). → Tiru: asap hitam yang skalanya ikut damage %, bekas gosong
  di fuselage, partikel debu saat touchdown keras.
- **Detail model**: baling-baling metal bengkok vs kayu patah saat rusak; tiap peluru
  dimodelkan. → Tiru: panel lines + rivet + weathering di pesawat (lihat §3.5).

### Project Wingman (indie, Unreal Engine 4, 1–3 orang)
- **Kokpit sebagai "chocolate box" teknologi**: banyak tombol + layar hijau neon; info
  utama yang dipantulkan ke pemain: altitude dan speed. → Tiru: panel kokpit ramai tapi
  terbaca; altitude/speed paling besar dan paling terang.
- **Hujan di kanopi**: air mengalir di kaca kokpit saat badai (refraction shader).
  → Tiru (versi murah): streak semi-transparan di kanopi saat masuk awan/hujan.
- **Rumble dekat tanah**: suara gemuruh dalam saat dekat tanah, dipertegas supaya terasa
  akan crash. → Tiru: audio low-rumble + getar halus saat altitude rendah.
- **Wake effect**: efek tanah/air saat terbang rendah. → Tiru: spray air/debu saat
  terbang rendah di atas laut/darat.
- **Control surfaces terlihat bergerak**: aileron/elevator/rudder berfungsi penuh dan
  terlihat dari chase cam; uap dari tepi sayap saat kecepatan tinggi; cahaya berkilau
  di airframe. → Tiru: aileron + elevator + rudder berotasi mengikuti input (WWAJIB —
  ini yang membuat pesawat terlihat "diterbangkan", bukan patung).
- **UI miring/angled, customizable**. → Tiru: HUD dengan aksen miring tipis, jangan kotak
  kaku semua.

### Infinite Flight (mobile sim, HUD bersih)
- **HUD di periferi**: telemetri kritis (airspeed, altitude, VSI) di tepi layar, viewport
  tengah JERNIH saat manuver. → Tiru: speed tape kiri, altitude tape kanan, compass strip
  atas; tengah layar hanya horizon + target.
- **Speed/altitude tapes + directional gyro + wind readout + inset map kecil**.
  → Tiru: tapes vertikal dengan angka bergerak (lebih "sim" daripada angka statis).
- **Overlay memudar**: overlay non-HUD memudar setelah beberapa detik, tinggal HUD.
  → Tiru: objektif/score memudar otomatis; HUD esensial tetap.
- **Banyak sudut kamera**: kokpit, eksternal, tower, scenic (paling cantik).
  → Tiru: shot presets sudah ada (cover/cockpit/rings/landing) — pastikan tiap shot
  membingkai pesawat + target + horizon dengan komposisi berbeda.

### SimplePlanes (sandbox low-poly, Jundroo)
- **Gaya low-poly bersih**: fuselage putih cerah + sayap abu gelap + aksen oranye —
  kontras warna tegas membuat siluet terbaca dari jauh. → Tiru: livery dua warna kontras
  (putih + satu warna aksen kuat, mis. oranye/merah Garuda), jangan satu warna polos.
- **Prop-blur effect props**: baling-baling blur memberi kesan gerak saat terbang.
  → Tiru: sudah ada — pastikan blur disc terlihat di screenshot cover.
- **Semua part bergerak**: control surfaces, rudder, landing gear, semua teranimasi.
  → Tiru: sama seperti Project Wingman — aileron/elevator/rudder + gear harus bergerak.
- **"Graphics are basic, but the laws of physics are not"**: fisika lebih penting
  dari grafis. → Tiru: feel terbang (inersia, stall, ground effect — sudah ada) jangan
  dikorbankan demi visual.
- **Sunrise takeoff dari carrier** adalah momen paling berkesan. → Tiru: shot landing/
  takeoff harus membingkai matahari rendah + runway + pesawat sekaligus.

### DRIFTWING — endless glider, Three.js low-poly, golden hour (referensi TERDEKAT)
Game Three.js satu file, glider low-poly di atas dunia prosedural saat golden hour.
Tekniknya hampir 1:1 bisa ditiru:
- **Chase cam dengan smooth lag yang ikut bank pesawat, FOV melebar dengan kecepatan,
  shake halus di kecepatan maks**. → Tiru: FOV +8–12° saat kecepatan maks + wind streak.
- **Terrain chunked heightmap (simplex noise, multi-oktaf), bioma di-blend oleh
  noise temperatur/kelembapan, vertex-colored flat-shaded**. → Tiru: color ramp
  pasir → rumput → crag berdasarkan ketinggian + slope (sudah sebagian ada).
- **Sky: gradient dome + sun disc + radial god rays murah di dekat horizon; fog color
  SELALU sama dengan warna langit**. → Tiru: god rays radial murah (sprite additive).
- **Awan: instanced soft puffs di lapisan yang melayang pelan, melempar bayangan
  samar (shadow blobs) ke terrain**. → Tiru: ini awan versi low-poly yang benar.
- **Air: animated vertex waves, sun glint streak, foam band di shoreline**.
  → Tiru: glint streak = strip terang memanjang ke arah matahari.
- **Boid bird flocks yang bubar saat diterbangi**. → Tiru: kawanan burung (5–9 burung,
  instanced) — memberi skala + kehidupan di screenshot.
- **Wingtip contrails saat bank tajam, wind streak lines saat cepat**.
  → Tiru: sama seperti War Thunder — prioritas tinggi.
- **Post stack: subtle bloom, vignette, warm color grade, light film grain**.
  → Tiru: lihat §3.1.
- **Golden-hour default: long shadows, warm fog, "screenshot moment" dalam 5 detik
  pertama**. → Tiru: shot cover harus langsung menampilkan momen itu.
- **Minimal glass UI**: altitude, speed, compass strip, waypoint arrow; auto-hide
  setelah 3 detik diam. → Tiru: HUD kaca minimal, bukan panel tebal.

### Sky Strike Lanes — Three.js jet game, sunset (referensi Three.js ke-2)
- **Cloud sea**: satu plane flat-shaded, tinggi dari sine wave, vertex color ungu di
  lembah → peach di puncak. → Tiru: awan bisa juga berupa "lautan awan" di bawah pesawat.
- **Sky: canvas gradient biru gelap → oranye/emas + sun sprite additive besar**.
  → Tiru: gradient + sun sprite (murah, efektif).
- **Jet dari satu builder**: fuselage 6 sisi, cone nose, kanopi gelap faceted, wing/tail
  plate extruded, fin miring, twin engine + flame cone. → Tiru: bentuk pesawat dari
  primitif faceted (bukan smooth) — itulah yang membuat low-poly terlihat "designed".
- **Ring: torus low-segment (faceted)**. → Tiru: ring sudah ada — pastikan faceted,
  bukan halus.

### Teknik low-poly Three.js "yang terlihat mahal" (matts.cv)
- **flatShading: true, roughness 0.9, metalness 0, vertexColors: true** — satu flag
  ini yang membuat low-poly terlihat disengaja, bukan gagal.
- **Vertex colours ganti tekstur**: gradasi mustahil dari texture tiling; jitter tiap
  vertex beberapa persen lightness supaya tidak flat.
- **Bake ambient occlusion manual**: gelapkan vertex di celah, bawah overhang, antar
  pelat hull — gratis di runtime, menambah sebagian besar depth yang dirasakan.
  Shadow map boleh tetap, tapi AO baked adalah yang membuat model "berisi".
- **Instancing adalah segalanya**: 400 pohon = 1 draw call (InstancedMesh), bukan 400.
  Budget: draw call, bukan triangle. Target <80 draw call untuk seluruh scene.
- **Deterministik**: tanpa Math.random() di factory model — semua dari seeded PRNG
  (sudah ada: mulberry32).

---

## 2. Teknik prioritas (urut dari dampak terbesar di screenshot)

### P1 — Post-processing stack: bloom halus + vignette + warm grade + grain tipis
**Dampak: PALING BESAR.** Satu layer ini yang membuat render mentah terlihat "mahal":
matahari + lampu nav + glint air berpendar, tepi gambar menggelap (fokus ke tengah),
warna hangat konsisten, grain tipis menyamarkan facet yang kasar.
**Implementasi Three.js r149:** EffectComposer + RenderPass + UnrealBloomPass
(strength 0.5–0.9, radius 0.4–0.6, threshold 0.6–0.85) + satu ShaderPass custom
(vignette + warm color grade + film grain, ~40 baris GLSL) + OutputPass.
**Peringatan transcript gate:** JANGAN vendor 5 file addon mentah (EffectComposer,
RenderPass, UnrealBloomPass, ShaderPass, OutputPass + 2 shader ≈ 2000 baris
"unwritten" — bisa mendorong unwritten melewati 40% dan menggagalkan
thinking_reproduces). Opsi aman: (a) tulis SATU custom post pass sendiri (~150 baris
authored: fullscreen quad + shader vignette/grade/grain + fake bloom dari downsample
+ blur 2 pass), atau (b) vendor addon sebagai `*.min.js` (di luar hitungan gate).
**Alternatif tanpa composer:** vignette/grade via overlay DOM (div radial-gradient di
atas canvas) — TAPI belum tentu ikut ke screenshot kalau shot diambil dari canvas
saja; verifikasi dulu jalur screenshot (shots.js) sebelum memakai cara ini.
**Sumber:** DRIFTWING, MasterAllArts/threejs-postprocessing skill,
skillhub threejs-visual-systems ("post tidak boleh memperbaiki bentuk yang tidak terbaca").

### P2 — Awan "volumetrik" dari billboard puff berlapis (Ace Combat + DRIFTWING + MSFS)
**Dampak: TERBESAR ke-2.** Awan adalah hal pertama yang dibaca mata sebagai "game
terbang" di screenshot.
**Implementasi:** 2–3 lapis InstancedMesh puff (icosahedron low-poly, flat-shaded,
vertex color): lapis tinggi (cirrus, tipis, terang), lapis tengah (cumulus, tebal),
lapis rendah (gelap-ungu). Tiap puff: warna atas hangat (kena matahari) / bawah
gelap — bisa via vertex color per puff atau 2 material. Puff melayang pelan + faint
shadow blob di terrain (blob gelap transparan di bawah tiap kelompok awan).
**Bonus gameplay:** saat pesawat masuk puff, overlay kabut putih (opacity 0.3–0.6)
+ suara angin naik — meniru Ace Combat (visibilitas turun di awan).
**Jangan:** awan yang "pecah" saat diterbangi (pelajaran Project Wingman PSVR2) —
puff harus soft dan tetap utuh dari dalam (opacity rendah dari dalam).
**Sumber:** Ace Combat 7, DRIFTWING, MSFS 2024, Project Wingman (TrueSKY).

### P3 — Air: sun-glint streak + fresnel + gelombang (MSFS + DRIFTWING)
**Dampak: BESAR.** Laut kami sudah specular + foam; yang kurang adalah "jalur cahaya
matahari di air" dan perubahan warna menurut sudut pandang.
**Implementasi:** (a) glint streak: strip terang (additive plane / specular highlight
yang memanjang) dari horizon ke arah kamera, sejajar arah matahari; (b) fresnel di
shader air: air gelap saat dilihat dari atas, terang/reflektif saat sudut grazing
(dekat horizon); (c) gelombang vertex animasi sudah ada (2 sine) — tambah normal
perturbasi halus supaya specular berkilau tidak statis.
**Sumber:** MSFS 2024 (gelombang + fisika air), DRIFTWING (sun glint streak).

### P4 — Wingtip contrail/vortex + wind streak saat cepat (War Thunder + DRIFTWING)
**Dampak: BESAR di screenshot statis** — satu-satunya cara "gerak" terlihat di gambar diam.
**Implementasi:** trail putih tipis (ribbon/line dari 10–20 segmen, memudar) dari tiap
ujung sayap saat bank > ~25° atau G tinggi; wind streak: garis putih tipis acak di
sekitar kamera saat kecepatan > 70% maks (10–15 garis, spawn di depan, lewat ke
belakang). Keduanya murah (LineSegments / ribbon mesh, tanpa tekstur).
**Sumber:** War Thunder (wingtip flow separation + contrail), DRIFTWING, Ace Combat 7
(vapor trail).

### P5 — Pesawat: panel lines + livery kontras + kanopi berkilau + control surfaces bergerak
**Dampak: BESAR.** Pesawat adalah subjek utama di semua shot; sekarang masih terlihat
"polos" dari dekat.
**Implementasi:** (a) panel lines: garis gelap tipis (thin box/line geometry atau
vertex-color stripe) di sepanjang fuselage + sayap; rivet: titik-titik kecil (opsional,
murah via Points); (b) livery dua warna kontras — putih + aksen oranye/merah Garuda
(SimplePlanes: putih + abu gelap + oranye); (c) kanopi faceted gelap dengan specular
tinggi (kilau matahari); (d) aileron kiri/kanan + elevator + rudder BEROTASI mengikuti
input — WAJIB, ini pembeda "pesawat diterbangkan" vs "patung" (Project Wingman,
SimplePlanes); (e) weathering ringan: vertex gelap di sekitar exhaust + tepi sayap.
**Sumber:** War Thunder, Project Wingman, SimplePlanes, Sky Strike Lanes.

### P6 — Bayangan yang DIJAMIN terlihat: blob shadow + matahari lebih rendah
**Dampak: BESAR, dan ini kekurangan yang sudah diketahui (F2/F3).** Shadow map sudah
ada tapi belum tentu kentara di screenshot.
**Implementasi:** (a) turunkan matahari 2–3° lagi (bayangan lebih panjang, warna lebih
hangat); (b) blob shadow: disc gelap transparan di bawah pesawat, skala + opacity
mengikuti ketinggian (jelas di shot landing <50 m); (c) naikkan kontras shadow
(shadow darkness/intensity) + pastikan shadow camera mencakup runway; (d) bake AO
manual di pesawat (gelapkan vertex di celah antar pelat — matts.cv).
**Sumber:** MSFS 2024 (low sun angle), matts.cv (baked AO), DRIFTWING (long shadows).

### P7 — Kamera: FOV melebar dengan kecepatan + bank mengikuti pesawat + shake halus
**Dampak: SEDANG-BESAR (feel smooth).** Menjual kecepatan dan kelancaran tanpa mengubah
fisika.
**Implementasi:** FOV 60 → 70–72° saat kecepatan maks (lerp halus, bukan snap);
kamera chase ikut roll pesawat sebagian (~30–40% dari roll pesawat) supaya belokan
terasa; shake halus (amplitudo kecil, frekuensi tinggi) hanya di >85% kecepatan maks;
transisi cockpit↔chase di-ease (sudah damped — tambah ease di FOV juga).
**Sumber:** DRIFTWING (FOV stretches with speed, chase cam banks with plane),
Ace Combat 7 (motion blur minimal saat gameplay).

### P8 — HUD declutter: tapes di tepi, tengah jernih (Infinite Flight + DRIFTWING)
**Dampak: SEDANG.** HUD kami "lengkap" tapi berisiko terlihat ramai di contact sheet
kecil (768×480).
**Implementasi:** speed tape vertikal kiri + altitude tape kanan (angka bergerak, bukan
statis); compass strip atas; waypoint arrow (panah ke target berikutnya); objektif +
score memudar otomatis setelah 3 detik; font tipis, glassmorphism (background
transparan gelap, bukan panel tebal); tengah layar hanya horizon + target.
**Sumber:** Infinite Flight (telemetri di periferi), DRIFTWING (minimal glass UI),
Project Wingman (UI angled, jangan kotak kaku semua).

### P9 — Runway dressing + feedback touchdown (MSFS + Project Wingman + War Thunder)
**Dampak: SEDANG, terutama di shot landing.** Runway polos = "strip aspal"; runway
berdandan = "bandara".
**Implementasi:** PAPI lights (4 lampu merah/putih di sisi runway), threshold markings
+ nomor runway + garis tengah putus-putus, lampu runway menyala (emissive kecil),
tire smoke: puff putih kecil saat roda menyentuh (partikel 8–12 sprite, memudar 1 detik),
debu saat touchdown keras (War Thunder), rumble audio + getar halus saat <30 m
(Project Wingman).
**Sumber:** MSFS 2024, Project Wingman, War Thunder, Infinite Flight (ILS).

### P10 — Kehidupan + damage yang terbaca (DRIFTWING + War Thunder)
**Dampak: SEDANG.** Memberi skala dan cerita ke screenshot.
**Implementasi:** kawanan burung (7–9 burung, InstancedMesh, terbang melingkar, bubar
saat pesawat mendekat); asap hitam yang skalanya ikut damage % + bekas gosong di
fuselage saat damage tinggi; kapal kecil di laut (1–2, siluet sederhana) sebagai
referensi skala.
**Sumber:** DRIFTWING (boid flocks), War Thunder (progressive damage), MSFS 2024
(live shipping traffic).

---

## 3. Jangan ditiru (tidak feasible / melanggar aturan)

- **Jangan unduh/salin asset game lain** (model, tekstur, musik, kode) — melanggar ToS
  game itu dan transcript gate (thinking_own_work Tier 1/2: garis dari entry/repo lain
  = tolak). Referensi hanya untuk inspirasi teknik + gaya.
- **Jangan kejar fotorealisme MSFS** (ray tracing, photogrammetry, data streaming,
  true volumetric raymarched clouds) — butuh network + GPU berat; dilarang network
  dan tidak feasible di file statis. Judge memberi nilai pada gaya low-poly yang
  KOHEREN, bukan pada realisme mentah.
- **Jangan pakai livery/trademark pesawat asli** (maskapai nyata, roundel militer
  nyata, jet tempur bermerek) — kriteria originalitas: "commercial-game copies lose".
  Livery harus orisinal (Garuda = nama + warna oranye, bukan logo maskapai).
- **Jangan tiru layout/font HUD Ace Combat / Infinite Flight mentah-mentah** —
  ambil prinsipnya (tapes di tepi, tengah jernih), bukan tampilannya.
- **Jangan motion blur / film grain berat** — Ace Combat sengaja menjaga motion blur
  minimal saat gameplay; di screenshot, grain/blur tebal menyembunyikan detail dan
  membuat gambar terlihat kotor.
- **Jangan awan yang pecah saat diterbangi** (pelajaran Project Wingman PSVR2) —
  puff harus tetap soft dari dalam.
- **Jangan vendor file addon mentah dalam jumlah besar** (lihat peringatan P1) —
  jaga unwritten lines <40% dari counted lines.
- **Jangan tambah fitur yang butuh network** (cuaca live, traffic live, peta streaming)
  — game harus jalan dari file statis, tanpa request network.

---

## 4. Urutan pengerjaan yang disarankan (dampak per jam kerja)

1. P1 post-processing (custom pass authored) + P6 blob shadow + matahari lebih rendah
2. P2 awan puff berlapis + shadow blob
3. P4 contrail ujung sayap + wind streak
4. P5 detail pesawat (panel lines, livery kontras, control surfaces bergerak)
5. P3 glint streak + fresnel air
6. P7 FOV + bank kamera
7. P8 HUD tapes + declutter
8. P9 runway dressing + tire smoke
9. P10 burung + asap damage

## 5. Sumber

- MSFS 2024: pcworld.com review; msfsaddons.com weather guide;
  flyawaysimulation.com photorealistic guide; avsim.com dev update
- Ace Combat 7: bandainamcoent.com; implacableness.netlify.app visual analysis
- War Thunder: warthunder.com "New effects for aviation in the Sky Guardians update"
- Project Wingman: pcgamesn.com "Making it in Unreal"; skywardfm.com review;
  gamechronicles.com review; gamingtrend.com Frontline 59 review
- Infinite Flight: vaultexe.com usability autopsy; forums.mudspike.com
- SimplePlanes: simpleplanes.com (P-58 Stallion, fastest plane, low-poly pack);
  gamebrain.co
- DRIFTWING (Three.js low-poly glider, golden hour): omo.space/workflows/opus-5-5-game-driftwing-endless-glider-flight
- Sky Strike Lanes (Three.js jet, sunset): shanebrumback.com
- Low-poly Three.js mahal: matts.cv/blog/low-poly-threejs-that-looks-expensive
- Post-processing Three.js: masterallarts.com (Shaders From Zero ep.16 + Three.js
  From Zero art.07); github.com/afovea/game-dev-skills threejs-postprocessing;
  skillhub.club threejs-visual-systems

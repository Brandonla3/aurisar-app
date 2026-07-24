# Aurisar — Art Direction & Asset Bar

The single source of truth for how Aurisar World assets should look and what
they may cost. New art is validated against this doc before it lands. It is the
`docs/world-design-plan.md` **Painted Realism** pillar, made operational.

## 1. The look — "Painted Realism"

Anchored by the existing MPFB humans: realistic silhouettes and proportions,
low-to-mid-poly geometry, soft painterly surfaces. Not flat-shaded toy low-poly,
not photoreal.

- **Silhouette first.** Read the shape at 30 m before any texture detail.
- **Smooth normals on organic/hero forms.** Autosmooth ≥ 30–35°. Hard edges are
  reserved for built/metal objects (crates, blades, anvils), never faces, cloth,
  creatures, or foliage.
- **Muted unified palette.** Albedo saturation ≤ 0.60, value in 0.20–0.80. No
  pure black or pure white albedo. New packs are recolored toward the Ashwood
  table (below), not used as-authored.
- **Matte surfaces.** Roughness 0.7–0.95; metallic 0 except genuinely metal
  parts. No plastic sheen.
- **No outline / toon pass.** Fill-rate is already the #1 mobile risk (leaf-card
  overdraw); cohesion comes from palette + normals + roughness, not ink.

### Ashwood palette anchors (recolor targets)

| Role | Hex | Notes |
|---|---|---|
| Foliage deep | `#3f5424` | greens stay olive, never neon |
| Foliage light | `#7a8a3e` | |
| Bark / timber | `#5a4326` | warm neutral browns |
| Stone / ruin | `#6f6a5f` | desaturated grey-tan |
| Cloth warm | `#8c6f4a` | leather/tan garments |
| Cloth cool | `#3a3f4a` | slate/indigo garments |
| Metal | `#7a7d84` | low saturation, roughness ≥ 0.6 |
| Water deep | `#1c3a3a` | Beer-Lambert deep tint |

## What CI proves — and what it does not

`check:assets` and the pipeline's structural backstop verify the **shape** of
every asset: per-skin joint counts, animation clip names + channel/sampler
counts, morph-target names + counts, mesh/primitive/material counts. A write is
refused if any of those drift. That is a fail-safe against a transform silently
dropping a rig, clip, or morph — **not** a proof of pixel identity. It does not
compare vertex payloads, joint order/inverse-bind matrices, UVs, or image bytes.
"Visually identical" is an **on-device** check on the deploy preview
(`world-viewer.html?hud=assets`), never something green CI establishes. Build and
test success prove the code path and structural integrity; they do not prove the
art. Treat meshopt + `KHR_mesh_quantization` as **visually lossless**, not
float-preserving.

## 2. Cohesion treatment (applied at intake, not runtime)

New CC0 kit pieces and the MPFB humans must read as one world. This is done
**offline in the pipeline** (`scripts/assets_pipeline.mjs`) so it costs nothing
per-load — never a standing runtime pass:

- Recompute smooth normals per the autosmooth rule; keep authored hard edges on
  built objects only.
- Clamp albedo saturation/value into range; recolor toward the palette anchors.
- Roughness floor 0.7 on non-metal.
- The only runtime material touch is Babylon-only flags that can't live in glTF
  (`enableSpecularAntiAliasing`), mirroring `CharacterAvatar._wireSkinPBR`.

> Batch B ships the **byte** pipeline (optimize + manifest + budgets). The
> palette/normal **treatment** presets are declared here and stubbed in the
> pipeline; enabling them per-pack is a bounded follow-up that needs the deploy
> preview to tune, since there is no GPU in CI to eyeball a recolor.

## 3. Budgets (enforced)

`config/asset-budgets.json`, checked by `npm run check:assets` (CI). Caps are
per runtime GLB, sized ~1.25–1.4× the current worst asset in each class.

| Class | Bytes | Tris | Texture edge |
|---|---|---|---|
| `character_rigged` | 380 KB | 16 000 | 1024 |
| `character_model` | 520 KB | 40 000 | 1024 |
| `creature_rigged` | 820 KB | 20 000 | 1024 |
| `kit_static` | 620 KB | 12 000 | 1024 |

**Download ledger** (`public/assets`, the `?hud=assets` overlay reads it live):
14.1 MB → **9.7 MB** after Batch B optimization. Program cap: **≤ 18 MB** end
state, first-interactive **≤ 8 MB** on mobile (lazy loading lands in Batch F).

## 4. Optimization pipeline

`scripts/assets_pipeline.mjs` (`npm run assets:pipeline`) per runtime GLB:

1. skip if already `EXT_meshopt_compression`-encoded (idempotent — optimization
   runs once, when a fresh GLB is dropped in; `--force` re-runs from source);
2. read (all glTF extensions) → capture the structural signature;
3. `prune → dedup → weld → resample`; optional per-asset clip curation
   (`keepClips` in `config/asset-packs.json`) for CC0 packs shipping dozens of
   unused clips (e.g. `skeleton_minion` 31 → 6);
4. `meshopt` geometry encode (`EXT_meshopt_compression`) — **textures are not
   re-encoded** (see below);
5. **re-parse and abort the file if the signature drifted** — a rig/clip/morph
   is never silently lost to compression;
6. **write only if it saves ≥ 1 KB** — no sub-KB binary churn on re-runs.

**Texture policy.** The pipeline does not lossy-recompress textures. Lossy WebP
on a normal / ORM / packed-data map introduces lighting noise, shifted
roughness, or seams, and no shipped asset needs it (nothing exceeds the 1024
cap; character/model packs carry no textures). The `treatment` field
(`config/asset-packs.json`, validated — unknown values fail) governs the texture
policy per class: rigged characters/creatures never touch textures;
`kit_static` may **losslessly** downsize a future over-cap color texture. Until
then an over-cap texture is a budget failure surfaced by `check:assets`, not a
silent lossy resize.

Then it emits `public/assets/manifest/<category>.manifest.json` (key → file,
bytes, tris, bones, clips, morphs, texMaxPx) and refreshes the generated block
of `public/assets/ATTRIBUTION.md`.

- **meshopt, not Draco**: smaller decoder, better ratio here. Decoder is
  self-hosted (`scripts/vendor_meshopt_decoder.mjs` →
  `public/babylon/meshopt_decoder.js`, registered by `babylonDecoders.js`) — the
  Babylon CDN default is blocked by our `script-src 'self'` CSP anyway. The
  vendored file pins the `meshoptimizer` version in its header;
  `npm run vendor:meshopt:check` (CI) fails if a dep bump left it stale.
- **KTX2 deferred** until the texture payload warrants a transcoder (world-design
  plan, Batch B).

### Caching

Runtime GLBs and manifests keep **stable filenames** and can be rewritten in
place, so `netlify.toml` serves the mutable public-asset paths
(`/assets/{characters,mobs,props,manifest,tiles,castle,terrain}`, `/babylon`)
with `max-age=0, must-revalidate` (ETag → 304) rather than the 1-year
`immutable` used for Vite's content-hashed bundles. This guarantees a future
asset correction propagates. A client that cached a file under the *old*
immutable policy keeps it until expiry; because optimization is visually
lossless, that degrades to a larger download, not a wrong render.
Content-hashed asset URLs (via the manifest) are the follow-up if guaranteed
immediate propagation is ever required.

### Manifests are the source of truth

`AssetLibrary`, `MobAssetLibrary`, and `PropsSystem` derive their key→file maps
from the generated manifests — there are no hand-maintained path tables. Content
`MobDef.glbKey` resolves through `mobs.manifest.json`. Adding an asset =
drop the GLB in the pack dir, run `npm run assets:pipeline`, commit.

## 5. Licensing

Every pack carries a license record in `config/asset-packs.json`, emitted into
the generated section of `public/assets/ATTRIBUTION.md`. All current runtime art
is CC0 (Quaternius, Kenney, KayKit) or project-authored. CC0 needs no
attribution legally; we credit as courtesy and to keep provenance auditable.
`check:assets` fails if the generated attribution block is stale.

## 6. Validation

- `npm run check:assets` — manifests fresh, files present, every asset within
  budget, attribution current (CI: **Asset manifests + budgets**).
- `assetManifests.test.js` / `mobClips.test.js` — manifests consistent with the
  runtime maps and the content graph (`glbKey` resolves; clip names real).
- `?hud=assets` on `world-viewer.html` — live download ledger + draw calls +
  mesh/texture/material counts for the acceptance matrix.
- On-device (no GPU in CI): confirm meshopt GLBs decode and load, characters/
  mobs/props render identically to pre-optimization, first-load payload on a
  mid-tier phone. Build/test success proves the code path, not the art result.

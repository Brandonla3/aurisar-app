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

1. read (all glTF extensions) → capture structural signature (skin joints,
   clip names, morph-target names, mesh count);
2. `prune → dedup → weld → resample`; optional per-asset clip curation
   (`keepClips` in `config/asset-packs.json`) for CC0 packs shipping dozens of
   unused clips (e.g. `skeleton_minion` 31 → 6);
3. textures: downsize > cap and convert PNG/JPEG → WebP via `sharp` (already-
   small WebP left alone — never inflate);
4. `meshopt` geometry encode (`EXT_meshopt_compression`, lossless);
5. **re-parse and abort the file if the signature drifted** — a rig/clip/morph
   is never silently lost to compression;
6. **write only if smaller** than the original.

Then it emits `public/assets/manifest/<category>.manifest.json` (key → file,
bytes, tris, bones, clips, morphs, texMaxPx) and refreshes the generated block
of `public/assets/ATTRIBUTION.md`.

- **meshopt, not Draco**: smaller decoder, better ratio here. Decoder is
  self-hosted (`scripts/vendor_meshopt_decoder.mjs` →
  `public/babylon/meshopt_decoder.js`, registered by `babylonDecoders.js`) — the
  Babylon CDN default is blocked by our `script-src 'self'` CSP anyway.
- **KTX2 deferred** until the texture payload warrants a transcoder (world-design
  plan, Batch B).

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

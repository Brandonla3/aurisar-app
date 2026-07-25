# Worldgen determinism contract

Every client generates the world from `mulberry32(config.seed)` alone. There is
no server broadcast of tree positions — parity *is* determinism. A change that
shifts the RNG stream therefore moves every ruin, cave and chest in the live
world for every player at once, and silently remaps anything keyed by array
index.

`npm run verify:worldgen` (CI: **Worldgen determinism (GOLDEN)**) is the gate.
It pins realized plateau heights, per-category site counts, and an FNV-1a digest
over every site position.

## The draw order

One shared stream, consumed in exactly this order (`worldgen/index.js`):

| Stage | Source | Draws (zone1) |
|---|---|---|
| 1 | biome seeds — `biomes.js` | **0** (authored anchors) / 3 + 2N (legacy ring) |
| 2 | site manifest — `sites.js` | ~10.8 k |
| 3 | Wildwood forest — `forest.js` | ~15.2 k |

Stages are **append-only**: never insert a draw before or between them.

## Change classes

Label every worldgen change with one of these. If you cannot tell which applies,
it is RESHUFFLE until `verify:worldgen` proves otherwise.

### CONFIG-SAFE — cannot move the stream

Edits that consume no randomness and feed no rejection test that precedes a
draw. Free to make at any time.

- `biomeAnchors` — position, count, biome index. The anchor path draws nothing,
  so biome layout is fully editable. *(This is why anchors replaced `biomeRing`:
  under the ring, `biomeRing.length` was a stage-1 draw count.)*
- `exclusions` — a post-filter applied after all draws (`sites.js`).
- Anything purely presentational: `colors`, `biomes[].ground` / `fog` /
  `grassCol`, `interiors`, `anchors`, `meta`.
- `trails` — render-only dirt overlay, no RNG, no geometry.
- Per-site visual variance derived from a site's own stored `seed` via
  `mulberry32(site.seed)` — an independent derived stream per instance.

### RESHUFFLE — moves the stream; needs a deliberate cut

Everything below changes how many numbers a stage draws, or changes a rejection
test that gates a draw. **All of it must land in one commit, with the GOLDEN
regenerated once and any index-keyed persisted data migrated.**

- `seed`, `radius`, `scatter.*`.
- `lake.*` — `scatter()` rejects on `lakeWaterDepthAt`, so the lake gates every
  subsequent draw.
- `zones.wildwood.*`, `zones.mountain.*` (including `margin`) — trees, bushes
  and ponds skip `siteSeed()` on rejection, so margins are *not* CONFIG-SAFE
  despite looking purely geometric.
- `forest.js` `paths` / `clearings` / caps — stage 3 rejects on `layout.isOpen`.
  A road authored as a forest path is a reshuffle.
- `biomeRing` (legacy path only), and switching a world between the anchor and
  ring paths.
- Any new scatter that draws from the shared stream. Prefer a derived stream —
  `mulberry32(hash2(seed, category))` — which is append-only-safe by
  construction.

### Index-keyed data — the second hazard

A reshuffle also **re-indexes** arrays. Anything persisted by array position
silently repoints at a different object.

Chest ids used to be exactly this: `id: index` assigned after the exclusion
post-filter, persisted forever in `playerChestOpened.chestId`. They are now
derived from the chest's own position and seed (`chestKey` in `sites.js`), so a
chest that does not move keeps its id across any manifest edit. Follow that
pattern for anything new that needs a stable identity.

## Regenerating the GOLDEN

Only after confirming the reshuffle is intended.

1. Make the full set of reshuffle-class edits in one working tree.
2. Run `npm run verify:worldgen`. It prints realized plateau heights, the
   per-category site counts, and `got <digest>`.
3. Copy those into the `GOLDEN` block in `scripts/verify_worldgen.mjs`, keyed by
   seed.
4. Re-run until green, then regenerate every derived manifest:
   `npm run emit:world-chests && npm run emit:landmarks && npm run sync:content`.
5. Note the reshuffle and any player-visible consequence (a chest reset, moved
   landmarks) in `docs/world-design-plan.md`.

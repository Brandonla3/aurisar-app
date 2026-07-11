# Third-Party Asset Attribution

The GLB models bundled under `props/` and `mobs/` are CC0 1.0 (public
domain dedication) — no attribution is legally required, but the original
creators are credited below as a courtesy.

| Directory | Assets | Author | Source | License |
|---|---|---|---|---|
| `props/` (houses, inn, bell tower, blacksmith, well, market stands, cart) | Medieval Village Pack | Quaternius | https://quaternius.com/packs/medievalvillage.html | CC0 1.0 |
| `props/` (barrels, crates, lanterns, anvil, weapon stand, farm crate) | Fantasy Props MegaKit | Quaternius | https://quaternius.itch.io/fantasy-props-megakit | CC0 1.0 |
| `props/` (rocks, mushrooms, columns, statues) | Stylized Nature MegaKit / Nature Kit | Quaternius / Kenney | https://quaternius.itch.io/stylized-nature-megakit · https://kenney.nl | CC0 1.0 |
| `props/` (dock platform, rowboat) | Pirate Kit | Kenney | https://kenney.nl | CC0 1.0 |
| `props/` (tents, timber pillar, fence, bonfire) | Fantasy Town / Village kits | Kenney / Quaternius | https://kenney.nl · https://quaternius.com | CC0 1.0 |
| `mobs/` (wolf, bull, spider, goblin, tribal, orc, glub) | Animated creatures | Quaternius | https://poly.pizza/u/Quaternius · https://quaternius.com | CC0 1.0 |
| `mobs/skeleton_minion.glb` | Skeleton character pack | Kay Lousberg (KayKit) | https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Skeletons-1.0 | CC0 1.0 |

CC0 license: https://creativecommons.org/publicdomain/zero/1.0/

## Textures

`textures/grass-meshy.jpg` and `textures/grass-meshy-nm.jpg` (terrain grass
albedo + normal map) are derived from a Meshy AI-generated render supplied by
the project owner: cropped, color-balanced against the previous palette, made
seamlessly tileable, with the normal map generated from luminance gradients.

`textures/grass-cards.png` (3D grass clump atlas, two alpha-cutout variants)
is extracted from the same Meshy AI renders by keying out the studio
backdrop, with edge-color dilation so mipmaps stay grass-colored.

`textures/grass-clump-albedo.jpg` and the hero clump geometry
(`src/features/world/game/grassClump.json`) are extracted from a Meshy
AI-generated textured grass GLB supplied by the project owner (baked base
color downscaled 4096→1024 and brightness-matched to the game palette; a
66-blade / 1.3k-tri sub-clump lifted from the 22k-tri source mesh).

Replacing any of these files in place (same filename, passing the GLB
validator) swaps the art with zero code changes — the intended path for
the custom Blender/Unreal art pass.

---

Some zone-1 content data (NPC/quest/camp layouts) was modeled on an
MIT-licensed open-source reference implementation. Retained per the MIT
license: *Copyright (c) 2026 Levy Street · MIT
(https://opensource.org/licenses/MIT).* No code from that project ships
in this repository.

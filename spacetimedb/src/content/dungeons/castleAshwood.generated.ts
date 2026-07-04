// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/dungeons/castleAshwood.generated.ts
// Regenerate with: npm run sync:content

// GENERATED FILE — DO NOT EDIT.
// Regenerate with: npm run emit:castle

export const CASTLE_ASHWOOD_ENTRY = {
  "spawnLocal": {
    "x": -46.375,
    "z": 0
  },
  "spawnFacing": 1.5707963267948966,
  "exitHotspotLocal": {
    "x": -53.375,
    "z": 0
  },
  "gateWorld": {
    "x": 112.5,
    "z": 20
  }
} as const;

export const CASTLE_ASHWOOD_SPAWNS = [
  {
    "netId": "ca_cells",
    "roomId": "cellBlockN",
    "mobType": "restless_bones",
    "count": 4,
    "radiusM": 8,
    "pos": {
      "x": -19.25,
      "z": 17.5
    }
  },
  {
    "netId": "ca_vault",
    "roomId": "dVault",
    "mobType": "vale_bandit",
    "count": 3,
    "radiusM": 6,
    "pos": {
      "x": 22.75,
      "z": -17.5
    }
  },
  {
    "netId": "ca_ballroom",
    "roomId": "ballroom",
    "mobType": "restless_bones",
    "count": 5,
    "radiusM": 10,
    "pos": {
      "x": -24.5,
      "z": -15.75
    }
  },
  {
    "netId": "ca_boss",
    "roomId": "treasury",
    "mobType": "gorrak",
    "count": 1,
    "radiusM": 2,
    "pos": {
      "x": 1.75,
      "z": 22.75
    }
  }
] as const;

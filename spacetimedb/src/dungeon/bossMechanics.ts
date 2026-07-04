/**
 * Instance boss mechanics — aoePulse + enrage from DungeonDef.bossMechanics.
 */

import { DUNGEONS_BY_ID } from './helpers.js';
import type { BossMechanics, DungeonDef } from '../content/types.js';

export const PX_PER_M = 32;

export function getDungeonForInstance(
  ctx: { db: { dungeonInstance: { instanceId: { find: (id: bigint) => { dungeonId: string } | null } } } },
  instanceId: bigint,
): DungeonDef | null {
  if (instanceId === 0n) return null;
  const inst = ctx.db.dungeonInstance.instanceId.find(instanceId);
  if (!inst) return null;
  return DUNGEONS_BY_ID[inst.dungeonId] ?? null;
}

export function getBossMechanicsForMob(
  ctx: { db: { dungeonInstance: { instanceId: { find: (id: bigint) => { dungeonId: string } | null } } } },
  mob: { mobType: string; dungeonInstanceId: bigint },
): BossMechanics | null {
  const dungeon = getDungeonForInstance(ctx, mob.dungeonInstanceId);
  if (!dungeon || mob.mobType !== dungeon.bossMobType) return null;
  return dungeon.bossMechanics;
}

export function bossEnraged(
  mechanics: BossMechanics,
  spawnedAtMicros: bigint,
  nowMicros: bigint,
  alreadyEnraged: boolean,
): boolean {
  if (alreadyEnraged) return true;
  const enrage = mechanics.enrage;
  if (!enrage) return false;
  return nowMicros - spawnedAtMicros >= BigInt(enrage.afterSec) * 1_000_000n;
}

export function bossDamageMult(mechanics: BossMechanics, enraged: boolean): number {
  if (!enraged || !mechanics.enrage) return 1;
  return mechanics.enrage.mult;
}

export function shouldBossAoePulse(
  mechanics: BossMechanics,
  lastAoeAtMicros: bigint,
  nowMicros: bigint,
): boolean {
  const pulse = mechanics.aoePulse;
  if (!pulse) return false;
  return nowMicros - lastAoeAtMicros >= BigInt(pulse.everySec) * 1_000_000n;
}

export function bossAoeRadiusPx(mechanics: BossMechanics): number {
  return (mechanics.aoePulse?.radiusM ?? 0) * PX_PER_M;
}

/**
 * realmActorBudget.test.js — the actor half of the budget census, as its own
 * file. realmBudget.test.js is hardcoded to props and chunk streaming
 * (thin-instance carriers keyed by (prototype, chunk), a deterministic
 * placement function to sweep with adversarial cameras) and cannot be
 * parameterized over "kind of thing" without contorting it — see this
 * phase's task-6 brief. This is that sibling, for actors.
 *
 * DRAW-CALL MODEL, stated explicitly because it is the whole arithmetic
 * below: actors are ORDINARY MOVING MESHES, never thin instances.
 * view/materials/actorNME.js's brief explicitly forbids reusing propNME's
 * instanced `instTint` attribute (it reads 0 and renders black on a mesh
 * with no buffer bound), and ActorRig's live actors use ordinary world
 * transforms — no `freezeWorldMatrix()` the way PropStreamer's carriers use.
 * Nothing in this codebase updates a thin-instance matrix for an actor after
 * build, so there is no batching to reason about: ONE draw call per visible
 * actor mesh, full stop. This holds regardless of archetype or stage — a
 * disabled (archetype, stage) master (ActorPrototypes, Task 8) is a template
 * nothing renders directly; every LIVE actor clones/instantiates from one and
 * is its own draw call.
 *
 * REMAINING HEADROOM, NOT THE FULL CEILING. BUDGET_CEILINGS
 * (model/propBudget.js, never edited here) is a WHOLE-SCENE ceiling — props
 * and actors spend out of the same 150 draw calls / 740,000 triangles. Props'
 * own worst-case census already measures 117 draw calls / 567,286 triangles
 * at its worst camera (belt 4-corner deep / belt 4-corner respectively;
 * `npx vitest run src/features/world/realm/realmBudget.test.js
 * --reporter=verbose`, reproduced 2026-08-06 — see PROPS_WORST_* below). That
 * leaves actors 33 draw calls and 172,714 triangles of headroom. Checking a
 * declared actor cost against the FULL 150/740,000 would silently double-book
 * the room props already spent, so every assertion here is
 * `PROPS_WORST + actorWorst <= BUDGET_CEILINGS`, never `actorWorst <=
 * BUDGET_CEILINGS` alone.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from './model/actorMasses.js';
import { ACTOR_MANIFEST, ACTOR_CEILINGS } from './model/actorBudget.js';
import { BUDGET_CEILINGS } from './model/propBudget.js';

/**
 * Props' own measured worst case. Declared here rather than imported because
 * realmBudget.test.js's camera sweep (`census()`) is a private closure with
 * nothing exported — the same paperwork discipline BUDGET_CEILINGS's own
 * header comment uses for ITS measured actuals. Re-paste both numbers if a
 * future props change moves realmBudget.test.js's own logged
 * `[census] worst:` line.
 */
const PROPS_WORST_DRAW_CALLS = 117;
const PROPS_WORST_TRIANGLES = 567_286;

describe('the P6 actor budget census — declared worst case vs remaining headroom', () => {
  it('ACTOR_CEILINGS.maxSimultaneousActors fits what props leave behind under BUDGET_CEILINGS', () => {
    const { maxSimultaneousActors } = ACTOR_CEILINGS;
    expect(maxSimultaneousActors, 'ACTOR_CEILINGS.maxSimultaneousActors must be declared').toBeGreaterThan(0);

    // Worst-case PER-ACTOR draw-call cost is exactly 1 (see file header).
    // Worst-case PER-ACTOR triangle cost is the single priciest
    // (archetype, stage) entry in the manifest — every declared archetype
    // is checked, not just the four shipped today, so a future archetype
    // added to ACTOR_MANIFEST without a matching ARCHETYPES entry is caught
    // by actorBudget.test.js's "no ghost cargo" audit before it could ever
    // silently raise this number unnoticed.
    const worstTrisPerActor = Math.max(
      ...ARCHETYPES.flatMap((arch) => ACTOR_MANIFEST[arch.id].map((s) => s.tris)),
    );

    const actorDrawCalls = maxSimultaneousActors * 1;
    const actorTriangles = maxSimultaneousActors * worstTrisPerActor;

    const totalDrawCalls = PROPS_WORST_DRAW_CALLS + actorDrawCalls;
    const totalTriangles = PROPS_WORST_TRIANGLES + actorTriangles;

    // The evidence this ceiling was checked against — keep logging so a
    // future retune reads numbers, not folklore (realmBudget.test.js's own
    // `[census]` logging makes the same deal).
    console.log('[actor census]', JSON.stringify({
      maxSimultaneousActors,
      worstTrisPerActor,
      actorDrawCalls,
      actorTriangles,
      propsWorstDrawCalls: PROPS_WORST_DRAW_CALLS,
      propsWorstTriangles: PROPS_WORST_TRIANGLES,
      totalDrawCalls,
      totalTriangles,
      drawCallHeadroomLeft: BUDGET_CEILINGS.drawCalls - totalDrawCalls,
      triangleHeadroomLeft: BUDGET_CEILINGS.triangles - totalTriangles,
    }));

    expect(
      totalDrawCalls,
      `${maxSimultaneousActors} actors cost ${actorDrawCalls} draw calls on top of props' measured `
      + `${PROPS_WORST_DRAW_CALLS} = ${totalDrawCalls}, over the ${BUDGET_CEILINGS.drawCalls} scene ceiling`,
    ).toBeLessThanOrEqual(BUDGET_CEILINGS.drawCalls);

    expect(
      totalTriangles,
      `${maxSimultaneousActors} actors at worst ${worstTrisPerActor} tris each cost ${actorTriangles} triangles on `
      + `top of props' measured ${PROPS_WORST_TRIANGLES} = ${totalTriangles}, over the ${BUDGET_CEILINGS.triangles} `
      + 'scene ceiling',
    ).toBeLessThanOrEqual(BUDGET_CEILINGS.triangles);
  });
});

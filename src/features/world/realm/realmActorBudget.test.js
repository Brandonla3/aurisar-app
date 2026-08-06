/**
 * realmActorBudget.test.js — the actor half of the budget census, as its own
 * file. realmBudget.test.js is hardcoded to props and chunk streaming
 * (thin-instance carriers keyed by (prototype, chunk), a deterministic
 * placement function to sweep with adversarial cameras) and cannot be
 * parameterized over "kind of thing" without contorting it — see this
 * phase's task-6 brief. This is that sibling, for actors.
 *
 * DRAW-CALL MODEL, stated explicitly because it is the whole arithmetic
 * below: actors are ORDINARY MOVING MESHES, never thin instances. This is now
 * a claim about SHIPPED code, not a brief — view/materials/actorNME.js and
 * view/actor/{ActorPrototypes,ActorRig}.js landed in Tasks 7-8. actorNME.js
 * never reuses propNME's instanced `instTint` attribute (an unbound instanced
 * attribute reads 0 and renders black on a mesh with no buffer bound — its
 * own header calls this the black-actor trap); ActorRig's live actors use
 * ordinary world transforms and NEVER call `freezeWorldMatrix()` the way
 * PropStreamer's carriers do. Both are pinned by test, not just prose:
 * ActorRig.test.js proves the live-world-matrix contract behaviourally (move
 * the root, read absolutePosition back — a frozen mesh would pass every
 * structural check and reveal nothing short of that), and
 * ActorPrototypes.test.js proves each master is a single mesh with no
 * per-mass children to multiply draw calls. If a future change ever thin-
 * instances or batches actors some other way, THOSE tests are what would
 * need to change first — and this comment, and the `* 1` below, with them.
 *
 * Given that model, the arithmetic is exactly 1 draw call per visible actor
 * mesh, regardless of archetype or stage — a disabled (archetype, stage)
 * master (ActorPrototypes, Task 8) is a template nothing renders directly;
 * every LIVE actor clones/instantiates from one and is its own draw call.
 *
 * REMAINING HEADROOM, NOT THE FULL CEILING. BUDGET_CEILINGS
 * (model/propBudget.js, never edited here) is a WHOLE-SCENE ceiling — props
 * and actors spend out of the same 150 draw calls / 740,000 triangles.
 * Props' own worst-case is computed by `worstPropCensus()`
 * (model/propCensus.js) — the SAME function realmBudget.test.js calls, not a
 * hand-copied snapshot of its output. A hardcoded copy was tried first and
 * rejected: model/propBudget.js's own header comment already says triangles
 * worst 567,602 while the live computation measures 567,286 — the snapshot
 * had already drifted once, which is exactly what "budgets are tests, not
 * comments" forbids. Importing the function instead means a future props
 * change that raises the real worst case is seen here automatically, on the
 * next test run, with no re-paste step to forget.
 *
 * Checking a declared actor cost against the FULL 150/740,000 would silently
 * double-book the room props already spent, so every assertion here is
 * `propsWorst + actorWorst <= BUDGET_CEILINGS`, never `actorWorst <=
 * BUDGET_CEILINGS` alone.
 */
import { describe, expect, it } from 'vitest';
import { ARCHETYPES } from './model/actorMasses.js';
import { ACTOR_MANIFEST, ACTOR_CEILINGS } from './model/actorBudget.js';
import { BUDGET_CEILINGS } from './model/propBudget.js';
import { worstPropCensus } from './model/propCensus.js';

describe('the P6 actor budget census — declared worst case vs remaining headroom', () => {
  it('ACTOR_CEILINGS.maxSimultaneousActors fits what props leave behind under BUDGET_CEILINGS', () => {
    const { maxSimultaneousActors } = ACTOR_CEILINGS;
    expect(maxSimultaneousActors, 'ACTOR_CEILINGS.maxSimultaneousActors must be declared').toBeGreaterThan(0);

    // Props' own worst case, LIVE — the same computation realmBudget.test.js
    // asserts against, not a copy of a number it once printed.
    const propsWorst = worstPropCensus();

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

    const totalDrawCalls = propsWorst.drawCalls + actorDrawCalls;
    const totalTriangles = propsWorst.triangles + actorTriangles;

    // The evidence this ceiling was checked against — keep logging so a
    // future retune reads numbers, not folklore (realmBudget.test.js's own
    // `[census]` logging makes the same deal).
    console.log('[actor census]', JSON.stringify({
      maxSimultaneousActors,
      worstTrisPerActor,
      actorDrawCalls,
      actorTriangles,
      propsWorstDrawCalls: propsWorst.drawCalls,
      propsWorstTriangles: propsWorst.triangles,
      totalDrawCalls,
      totalTriangles,
      drawCallHeadroomLeft: BUDGET_CEILINGS.drawCalls - totalDrawCalls,
      triangleHeadroomLeft: BUDGET_CEILINGS.triangles - totalTriangles,
    }));

    expect(
      totalDrawCalls,
      `${maxSimultaneousActors} actors cost ${actorDrawCalls} draw calls on top of props' measured `
      + `${propsWorst.drawCalls} = ${totalDrawCalls}, over the ${BUDGET_CEILINGS.drawCalls} scene ceiling`,
    ).toBeLessThanOrEqual(BUDGET_CEILINGS.drawCalls);

    expect(
      totalTriangles,
      `${maxSimultaneousActors} actors at worst ${worstTrisPerActor} tris each cost ${actorTriangles} triangles on `
      + `top of props' measured ${propsWorst.triangles} = ${totalTriangles}, over the ${BUDGET_CEILINGS.triangles} `
      + 'scene ceiling',
    ).toBeLessThanOrEqual(BUDGET_CEILINGS.triangles);
  });
});

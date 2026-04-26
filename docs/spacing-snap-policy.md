# Spacing Snap Policy — Proposal

**Status:** Draft for review
**Scope:** Inline `gap`, `padding`, `margin*` values across `src/App.js` and `src/components/PlanWizard.js`. CSS files (`src/styles/*.css`) are out of scope — class-based styling already gives them a single edit point.
**Outcome:** A decision on which option to adopt, after which the migration becomes mechanical (~1,500 sites, similar shape to the PR #74 + #81 token sweeps).
**Companion:** [`spacing-snap-preview.html`](./spacing-snap-preview.html) — open in a browser for a side-by-side rendering of a workout exercise card under the recommended Option B.

---

## 1. The problem

PR #74 introduced `S.s0` … `S.s32` and PR #81 extended it to cover every distinct value, but **no actual gap/padding/margin call sites have been migrated yet**. The audit explicitly held this back because it hits a design choice: do we preserve every existing value, snap aggressively to a tight grid, or pick a balanced middle?

The values in play (live counts from `main`):

### `gap:N` — 14 distinct values

| Value | Sites | Value | Sites |
|---:|---:|---:|---:|
| 8 | 89 | 7 | 9 |
| 6 | 45 | 0 | 7 |
| 4 | 33 | 9 | 5 |
| 5 | 26 | 2 | 5 |
| 10 | 23 | 12 | 3 |
| 1 | 2 | 3 | 1 |
| 14 | 1 | 11 | 1 |

### `margin*:N` (any side) — 21 distinct values

| Value | Sites | Value | Sites |
|---:|---:|---:|---:|
| 6 | 80 | 11 | 11 |
| 4 | 73 | 16 | 7 |
| 8 | 63 | 1 | 6 |
| 10 | 62 | 13 | 5 |
| 3 | 52 | 9 | 3 |
| 2 | 45 | 18 | 3 |
| 12 | 39 | -6 | 3 |
| 5 | 33 | -4 | 3 |
| 0 | 30 | 24 | 1 |
| 14 | 24 | -8 | 1 |
| 7 | 13 | | |

### `padding:"Xpx Ypx"` shorthand — top combinations

| Pattern | Sites |
|---|---:|
| `"6px 8px"` | 35 |
| `"6px 10px"` | 32 |
| `"4px 5px"` | 24 |
| `"4px 8px"` | 16 |
| `"4px 7px"` | 16 |
| `"2px 5px"` | 12 |
| `"10px 14px"` | 9 |
| `"2px 8px"` | 8 |
| `"8px 12px"` | 7 |
| `"6px 12px"` | 7 |
| `"1px 5px"` | 7 |

**Observation:** the codebase is *already* mostly clustered around even values (4, 6, 8, 10, 12). The off-by-1 values (3, 5, 7, 9, 11, 13) are a long tail that looks more like incidental fine-tuning than deliberate design.

---

## 2. Three options

### Option A — Strict 4-based grid

The audit's original recommendation.

```js
const S = { s0: 0, s4: 4, s8: 8, s12: 12, s16: 16, s20: 20, s24: 24, s28: 28, s32: 32 };
```

**Snap rules**

| Existing | → | Token | Δ |
|---:|---|---:|---|
| 1, 2, 3 | → | s4 | up to +3px |
| 5, 6, 7 | → | s4 or s8 | ±1–2px |
| 9, 10, 11 | → | s8 or s12 | ±1–2px |
| 13, 14 | → | s12 or s16 | ±1–2px |
| 18 | → | s16 or s20 | ±2px |

**Pros**
- 9 tokens — most consistent
- Matches Tailwind / Material / Carbon design-system conventions
- Forces a true grid going forward

**Cons**
- ~600 sites get a ±1–3px shift
- Visible at small sizes (`gap:5` → `gap:4` reduces every chip-row by 1px)
- Risk of layout reflow in dense UIs (pickers, leaderboard rows, log entries)

---

### Option B — 2-based scale with off-by-1 snap (**recommended**)

Preserves every common even value; snaps the rare odd-numbered fine-tuning into the nearest even bucket.

```js
const S = {
  s0: 0,
  s2: 2,   s4: 4,   s6: 6,   s8: 8,
  s10: 10, s12: 12, s14: 14, s16: 16,
  s18: 18, s20: 20, s24: 24, s28: 28, s32: 32,
  // negatives for overlap effects (kept distinct)
  sNeg4: -4, sNeg6: -6, sNeg8: -8,
};
```

**Snap rules**

| Existing | → | Token | Δ | Sites affected |
|---:|---|---:|---:|---:|
| 1 | → | s2 | +1 | 8 |
| 3 | → | s4 | +1 | 53 |
| 5 | → | s6 | +1 | 70 |
| 7 | → | s8 | +1 | 22 |
| 9 | → | s8 | -1 | 8 |
| 11 | → | s12 | +1 | 11 |
| 13 | → | s14 | +1 | 5 |
| **All other existing values** | unchanged | | 0 | ~1,300 |

For the `padding:"Xpx Ypx"` shorthand, snap each axis independently. So `"6px 10px"` (32 sites) stays as-is, while `"4px 5px"` (24 sites) becomes `"4px 6px"`.

**Pros**
- ±1px max snap delta — imperceptible on most surfaces
- Only ~177 sites get any visual change; rest is pure rename
- Keeps `gap:6`, `gap:10`, `padding:"6px 8px"` etc. that the codebase clearly wanted
- 14 tokens — still tight enough to be a real scale
- Negative margins preserved via dedicated tokens

**Cons**
- Not a "pretty" 4-grid — design-system purists may grumble
- Still requires touching ~177 sites with non-zero visual delta

---

### Option C — Preserve everything (pure rename)

```js
// All 21 values get their own token; no snapping at all
const S = {
  s0:0, s1:1, s2:2, s3:3, s4:4, s5:5, s6:6, s7:7, s8:8, s9:9,
  s10:10, s11:11, s12:12, s13:13, s14:14, s16:16, s18:18, s20:20, s24:24, s28:28, s32:32,
  sNeg4:-4, sNeg6:-6, sNeg8:-8,
};
```

**Snap rules:** none.

**Pros**
- Zero visual change — pure value rename, identical to PR #81's font-size approach
- Lowest possible risk for merging

**Cons**
- 21 spacing tokens preserves the chaos rather than fixing it
- Doesn't address the audit's actual recommendation
- Future code can still pick from 21 sizes — no "scale" exists, just a dictionary of magic numbers with names

---

## 3. Recommendation

**Adopt Option B.**

It captures most of the consolidation value (forces the 5/7/9/11 fine-tuning into the canonical 4/6/8/10/12 scale that the codebase already prefers) at a tiny visual-delta budget (±1px on ~177 sites, ~13% of total spacing call sites). The remaining ~1,300 sites are pure renames.

Option A is correct in spirit but its ±2–3px deltas across hundreds of dense layouts (pickers, leaderboard rows) would likely require manual tuning afterwards — defeating the "mechanical migration" goal.

Option C technically completes the audit recommendation but doesn't deliver the consolidation value the audit was actually asking for.

---

## 4. Migration plan (if Option B is chosen)

1. **Update `src/utils/tokens.js`** — extend `S` with `s18` and the negative tokens.
2. **Run two Python sweeps** mirroring PR #81:
   - Sweep A — exact-value rename for everything that doesn't snap (gap:6, gap:8, gap:10, marginBottom:4, etc.). ~1,300 sites.
   - Sweep B — snap-and-rename for the off-by-1 values (gap:5 → S.s6, marginBottom:3 → S.s4, etc.). ~177 sites. List each rule explicitly in the PR description.
3. **Padding shorthand sweep** — parse each `"Xpx Ypx"` literal, snap each axis, rebuild the string. Adopt a helper `pxPair(x, y) => \`${x}px ${y}px\`` if it makes the diff clearer.
4. **Verification:**
   - `npm run build` passes.
   - `grep -cE '\bgap:[0-9]+\b'` → 0 in App.js + PlanWizard.js (everything tokenized).
   - Manually open 5 dense surfaces in a deploy preview: Library tab picker, Leaderboard, Quest list, Workout Log, Plan Wizard step 2. Confirm no obvious reflow.
5. **Audit workbook:** mark the spacing row as **FIXED** in `Spacing_BorderRadius` and `Recommendations`.

Estimated effort: 1 PR, ~1,500 sites mechanical, ~30 minutes plus visual smoke test.

---

## 5. Out of scope (and why)

- **CSS files** — already class-tokenized; no inline magic numbers worth extracting.
- **Negative margins in `landing.css`** (e.g. `marginTop:-16`) — intentional hero-text overlay; flagged in audit as "acceptable but document".
- **`padding:"30px"` / `padding:"52px"` outliers** — appear once each, likely intentional one-offs (modal pads, hero padding). Leave as literals for now.
- **`px` vs unitless React style values** — separate audit item; better tackled in a focused PR.

---

## 6. Decision needed

Which option do we adopt? Once decided, the migration is mechanical and lands in one PR.

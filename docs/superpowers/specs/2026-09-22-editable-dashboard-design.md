# Editable dashboard

## Context

Every part of the home dashboard's layout already lives in `config/config.yaml` — which widgets exist, which page and profile they're on, where they sit on the 12-column grid, and their per-widget `options`. But the only way to change any of it is to SSH in and hand-edit YAML. The Settings panel can toggle a widget on or off and nothing more.

The goal is to make the wall editable from the wall: enter an edit mode, drag widgets around, resize them, add and remove them, add and remove pages and profiles, and configure each widget — including the config it reads, so a new countdown or a new commute destination can be added from the iPad instead of from a terminal.

The architecture is already most of the way there. Layout is data-driven, there's a client widget registry, and `PATCH /api/config` does validated, atomic, comment-preserving writes addressed by path. This is overwhelmingly **new client UI plus a widget-options schema**, with one server line changed and one optional server capability added.

### Decisions made up front

| Decision | Choice |
|---|---|
| Move | Drag a handle, snapped to the grid |
| Resize | − / + width and height buttons on the selection bar |
| Bands (`share`) and stacks (`stack`) | Fully editable — join, leave, create, reorder |
| Widget config | In the widget's own panel, editing both `options` *and* the top-level lists it reads |
| Saving | Staged working copy; one batched PATCH on Save, discard on Cancel |
| Collisions | Same-size swaps, different-size blocks, free space always allowed |
| Profiles | Toolbar switcher (preview only), plus create and delete |

### Before starting

- Work on `main`: `git checkout main && git pull`. `feature/widget-refinements` is already merged (PR #1); main is at `b8bcf6c`.
- **Conflict risk:** the branch `feature/services-groups-calendar-month` is checked out in the main worktree with 2 unmerged commits touching `registry.ts`, `widgets/` and `SettingsPanel.tsx` — the same files this feature touches. Merge or abandon it first.
- Commit the design as `docs/superpowers/specs/2026-09-22-editable-dashboard-design.md` (this document) as step 0.

---

## Two measurements that drive the design

Running the real `config/config.yaml` through the `yaml` library, per kind of `ConfigChange`:

| Operation | Comments (of 65) | Damage |
|---|---|---|
| Reprint fallback (`ConfigStore.#reprint`) | **65** | aligned trailing comments collapse; flow seqs gain spaces |
| `setIn(["profiles","day","widgets"], wholeArray)` | **49** | every per-widget prose comment gone; `grid: {…}` flow maps explode to block maps |
| `setIn([…,"widgets", 5], newWidget)` (append) | **65** | new item printed block-style; rest intact |
| `deleteIn([…,"widgets", 0])` | **65** | one stray indented blank line |

So: **never send `profiles.<name>.widgets` as a single array value.** Scalar-addressed edits stay byte-surgical via `editText`; index-addressed append/delete are comment-safe.

One caveat that shapes the diff: `editText` returns `null` for the *whole batch* if any single change is non-scalar (`apps/server/src/config/textEdits.ts:119`), so a save mixing a move with an add reprints the file. Acceptable, but it argues for keeping pure-layout saves scalar-only.

---

## Module boundaries

New directory `apps/web/src/edit/`. Pure `.ts` with colocated `.test.ts`; `.tsx` only where there's JSX. Explicit `.js` import extensions, prose comments explaining *why*, matching the surrounding code.

**Pure logic (no DOM, no React — vitest runs `environment: "node"`):**

- `edit/grid.ts` — rectangles, occupancy, collision, drop outcomes, free-space search
- `edit/geometry.ts` — pointer-delta → grid-delta snapping, plain numbers only
- `edit/mutations.ts` — every `(widgets, …) => WidgetInstance[]` transform
- `edit/profiles.ts` — profile create/delete and 24-hour schedule tiling
- `edit/diff.ts` — `DashboardConfig` × `DashboardConfig` → `ConfigChange[]`
- `edit/options.ts` — `OptionSpec` types, `optionValue()`, `optionChange()`

**React:** `edit/EditContext.tsx`, `EditToolbar.tsx`, `EditableGrid.tsx`, `useDrag.ts`, `WidgetOptionsPanel.tsx`, `AddWidgetPicker.tsx`, `edit/editors/*.tsx`.

**Changed:** `components/layout.ts` (extract `groupWidgets()`), `components/DashboardGrid.tsx` (`editing` prop), `settings/parts.tsx` (new — `Section`/`Row` extracted from `SettingsPanel.tsx` so both panels share them), `settings/controls.tsx` (add `Stepper`, `ListRows`), `widgets/types.ts` + `registry.ts`, `App.tsx`, `apps/server/src/routes/api.ts`.

---

## Step 0 — shared grouping (do this first)

`apps/web/src/components/layout.ts:46-85` decides band and stack membership inline. The editor needs the *same* rule to compute occupancy, and two copies will drift — with a subtle symptom (drop preview in the wrong place). Extract:

```ts
export type Group =
  | { kind: "widget"; key: string; members: [WidgetInstance] }
  | { kind: "band";   key: string; members: WidgetInstance[] }
  | { kind: "stack";  key: string; name: string; members: WidgetInstance[] };

/** How widgets group into things the grid places: one rule, two consumers. */
export function groupWidgets(widgets: WidgetInstance[]): Group[];
```

`layout()` becomes a projection of `groupWidgets()` into CSS strings; `edit/grid.ts` projects the same groups into numeric rectangles. `layout.test.ts` must pass unchanged.

Two real rules to preserve: a band is keyed by the **row string** (so membership needs `share: true` *and* identical `row` *and* identical `rowSpan`), and `stack` is tested before `share`, so they are mutually exclusive.

---

## Pure grid helpers — `edit/grid.ts`

```ts
export interface Rect { col: number; row: number; colSpan: number; rowSpan: number }
export interface Block { key: string; kind: "widget" | "band" | "stack"; rect: Rect; members: WidgetInstance[] }

export function blocksOf(widgets: WidgetInstance[]): Block[];   // band => col 1 span 12; stack => union
export function rowsOf(widgets: WidgetInstance[]): number;      // mirrors layout(): max(row + rowSpan - 1)
export function overlaps(a: Rect, b: Rect): boolean;
export function blockAt(blocks: Block[], col: number, row: number): Block | null;
export function canPlace(blocks: Block[], movingKey: string, rect: Rect): boolean;
export function findSwapTarget(blocks: Block[], movingKey: string, rect: Rect): Block | null;

export type Drop = { kind: "free" } | { kind: "swap"; withKey: string } | { kind: "blocked" };
/** Free rectangles are always valid; same-size collisions swap; anything else blocks. */
export function dropOutcome(blocks: Block[], movingKey: string, rect: Rect): Drop;

export function clampResize(blocks: Block[], key: string, rect: Rect,
  delta: { colSpan?: number; rowSpan?: number }, rows: number): Rect;
export function freeRectFor(blocks: Block[], want: { colSpan: number; rowSpan: number }, rows: number): Rect;
/** A free horizontal run on these rows, for a widget leaving a band. */
export function freeRunIn(blocks: Block[], row: number, rowSpan: number, colSpan: number): number | null;
```

`edit/geometry.ts`:

```ts
export interface Units { colUnit: number; rowUnit: number }
export function gridUnits(width: number, height: number, rows: number, gap: number): Units;
export function snapRect(start: Rect, dx: number, dy: number, units: Units, rows: number): Rect;
```

Delta-based, not absolute-position-based — it keeps the grab point under the finger, which is what makes a drag feel right on glass. Gap read once at `pointerdown` from `getComputedStyle(grid).columnGap` (14px today).

---

## Staged editing — `edit/EditContext.tsx`

A provider mounted inside `DashboardProvider`, around the Pager.

```ts
interface EditState {
  base: DashboardConfig;      // as it was when edit began; what Save diffs against
  draft: DashboardConfig;     // the working copy; every mutation replaces it wholesale
  profileName: string;        // which profile the toolbar is laying out (preview only)
  page: number;
  selected: string | null;
  history: DashboardConfig[]; // undo snapshots — cheap, everything is immutable replacement
}

interface EditApi {
  editing: boolean; state: EditState | null;
  begin(profileName: string): void; cancel(): void; save(): Promise<void>;
  update(recipe: (draft: DashboardConfig) => DashboardConfig): void;
  undo(): void; select(id: string | null): void;
  setProfile(name: string): void; setPage(page: number): void;
}
```

**Why a whole `DashboardConfig`, not just a `Profile`:** a widget's options panel edits top-level lists (`countdowns.items`, `commute.destinations`, `bins`, …). One draft covers both; the diff handles it.

**Why `DashboardProvider` needs no changes:** `config-changed` still refetches, but while editing nothing renders `config` — `App` renders `draft`. The working copy is separate state and cannot be clobbered. No suppression flag needed.

**Why `base` matters:** diffing against the edit-start snapshot, addressed by `{ id }` where possible, means `ConfigStore.patch` (which re-reads from disk) touches only the addressed values. The multi-editor failure mode degrades to last-writer-wins *per field* rather than per file.

**Preview vs schedule:** the profile switcher must never call `/api/profile/override`. While editing, `App.tsx` ignores `activeProfile` entirely — theme comes from `draft.profiles[profileName].theme` and the grid is keyed on `profileName`, so a scheduled day→night flip mid-edit doesn't disturb your work.

**Also disable while editing:** the Pager's return-to-first-page timer (`Pager.tsx:66`), Settings' idle close, and tap-to-expand.

### Save: diffing to `ConfigChange[]`

```ts
/** The whole edit session as targeted config edits, in an order safe to apply in sequence. */
export function configChanges(base: DashboardConfig, next: DashboardConfig): ConfigChange[];
```

**Emission order is a contract.** `ConfigStore.patch` resolves every path against the *pre-patch* config once (`loader.ts:152`) but applies changes sequentially to a mutating document. So:

1. **Scalar field edits**, addressed by `{ id }` where the parent is an id-bearing array (`["profiles", name, "widgets", { id }, "grid", "col"]`). Base indexes are still valid — nothing structural has happened yet.
2. **Removals**, as index deletes in **descending** index order.
3. **Insertions/appends**, at indexes computed for the post-removal array.

Field rules, following the existing settings convention that a default leaves no trace (`SettingsPanel.tsx:340`, `:380`): back to a schema default → `value: null`. Applies to `colSpan: 1`, `rowSpan: 1`, `share: false`, `enabled: true`, `page: 1`, and every `OptionSpec.default`. `col` is deleted when a widget joins a band and written when it leaves; `stack` deleted when it leaves a stack.

**The 50-change cap.** One page's re-layout is easily 24 changes; a multi-page session exceeds 50. Raise `PatchSchema.max(50)` → `.max(200)` at `apps/server/src/routes/api.ts:27`. Do **not** chunk client-side: each PATCH re-reads, revalidates and broadcasts, so chunking makes a save non-atomic and can leave the file half-edited. One request, one validation, one atomic rename, one broadcast.

**Client-side pre-flight.** Run `DashboardConfigSchema.safeParse(draft)` on every mutation — zod is already in `@home-dash/shared`. This catches `col is required unless share is true` and the 12-column overflow the instant they happen instead of as a 400 after ten minutes of work. Outline the offending tile; disable Save.

---

## Drag on touch

**Kill the pager while editing.** Rather than fight `scroll-snap-type: x mandatory` mid-gesture, edit mode turns swiping off: the page container gets `touch-action: none` and the toolbar gets explicit page buttons. Biggest single risk reducer. It also makes cross-page moves a **"Move to page ▸"** menu item rather than a drag-to-edge gesture — more reliable and more discoverable on touch.

`edit/useDrag.ts`, Pointer Events only:

1. Handle is a 44px `<button>` in the tile corner with `touch-action: none` — the primary mechanism stopping the browser claiming the gesture as a pan.
2. `pointerdown`: `setPointerCapture(event.pointerId)` so move/up/cancel keep arriving as the finger leaves the handle. Record the grid box, `rows`, the gap, and the start `Rect`; build `Units` once.
3. `pointermove`: `snapRect(…)` → `dropOutcome(…)`. Write `transform: translate3d(dx, dy, 0)` on the dragged cell **via ref, outside React state**, so the move is one composited property and never reflows the grid. Only the snapped rect goes through state — re-renders happen once per cell crossed, not once per frame.
4. **Drop preview is an extra grid child, not an overlay:** `<div className="edit-preview" style={{ gridColumn: `${rect.col} / span ${rect.colSpan}`, gridRow: … }} data-drop={outcome.kind} />`. Placed by the same CSS grid, so it's pixel-exact for free including the 14px gap.
5. `pointerup`: on `free`/`swap`, `update()` and clear the transform **in the same React commit** — the new `gridColumn` and `transform: none` land together, so there's no one-frame jump. On `blocked` (and `pointercancel`), spring back with `el.animate({ transform: [current, "none"] }, { duration: 180, easing: "cubic-bezier(0.2,0,0,1)" })`, matching the WAAPI idiom in `Expanded.tsx`.

**Coexisting with tap-to-expand.** `DashboardGrid.tsx:41` attaches `onCellClick` unconditionally. Give it an `editing?: boolean` prop and skip attaching the handler when editing, so a tap falls through to edit-mode selection. `OWN_CONTROLS` already matches `button` and `[data-no-expand]`; wrap the edit chrome in `[data-no-expand]` regardless.

**Neutralising widget interiors.** A light switch or task checkbox must not fire while editing. Wrap each tile's body in a container with `pointer-events: none` and `aria-hidden`, edit chrome as a `pointer-events: auto` sibling. (`inert` is more correct but only landed in Safari 16.4.)

---

## Band and stack vocabulary

Reference: `layout.ts:17` (`union`), `:49-63` (stack), `:65-75` (band), `:87-89` (hidden members still count towards the rectangle).

### Bands (`share: true`)
Grouped by row string; members carry **no `col`**; they split the full 12 columns evenly in **config array order**.

| Action | UI | Mutation |
|---|---|---|
| Fixed → join a band | select tile → "Add to row band", listing bands on this page | `share: true`, delete `col`, set `row`/`rowSpan` to the band's; append to array |
| Fixed → new band | select two tiles sharing a row range → "Share this row" | both get `share: true`, `col` deleted, `row`/`rowSpan` = union rows. **Guard:** a band claims all 12 columns of those rows — `canPlace` must confirm nothing else occupies them, else refuse clearly |
| Band → fixed | "Take out of row" | delete `share`; `col = freeRunIn(blocks, row, rowSpan, colSpan)`. If no run fits, fall back to `freeRectFor()` elsewhere on the page — and say so |
| Reorder | ◀ ▶ on the selection bar | splice within the profile's `widgets` array |

### Stacks (`stack: name`)
Grouped by name; members keep their own `col`/`row`/spans, which only feed the **union**; visual order is array order.

| Action | UI | Mutation |
|---|---|---|
| Fixed → join a stack | "Add to column stack", listing stack names on this page | adopt the union's `col`/`colSpan`; take a row slice at the bottom (`row = union.row + union.rowSpan`, own `rowSpan`); set `stack`; append. **Guard:** rows below the union must be free or the union balloons and swallows a neighbour |
| Fixed → new stack | select two tiles in the same column range → "Stack these" | both get `stack: uniqueStackName(widgets, seed)`; their rects already form the union, so nothing moves |
| Stack → fixed | "Take out of stack" | delete `stack`. Its `col`/`row` already describe a real rectangle. Remaining members redistribute over the smaller union — no gap, since each member's own rect is unchanged |
| Reorder | ▲ ▼ | splice, **then `normaliseStack()`** |

**`normaliseStack(widgets, name)`** reassigns contiguous row slices to members in array order across the union. Cosmetic while stacked (flexbox divides the union regardless) but essential the moment a member *leaves* — otherwise it lands at whatever row it happened to be written with, nowhere near where it appeared. Emits only scalar `row`/`rowSpan` changes, so it stays surgical.

**`uniqueStackName(widgets, seed)`** — `` `${firstId}-stack` ``, then `-2`, `-3`. Readable in the file, in the spirit of the hand-written `right-column`.

**Mutual exclusion:** the editor never sets both `stack` and `share`; joining one deletes the other.

**Reordering is why the sequence primitive matters.** A splice within `widgets` isn't expressible as scalar edits, and `YAMLSeq.setIn(i, v)` replaces rather than inserts. Until step 9a lands, reorder can only be "remove and append" (move to end of group) — honest but limited.

---

## Server-side changes

**Required, one line:** `apps/server/src/routes/api.ts:27`, `.max(50)` → `.max(200)`.

Everything else already works — verified:

- **Profile create** — `{ path: ["profiles","evening"], value: {…} }`: object value, so `editFor` returns null and `#reprint` runs `doc.setIn()`. Comments survive, alignment reflows.
- **Profile delete** — `value: null` → `doc.deleteIn()`. Guard client-side against deleting the last profile (`DashboardConfigSchema` requires ≥1, so the server 400s anyway — but with a zod message, not a sentence).
- **`col` deletion for band members** — `grid: {…}` is a *flow* map and `editFor` has a dedicated flow branch (`textEdits.ts:65-70`). Surgical.
- **Adding a key to a flow `grid`** (e.g. `stack:`) — `textEdits.ts:82` handles flow insert. Surgical.
- **Schedules tiling 24 hours is not validated server-side.** That invariant is ours to keep.

### Step 9a — block-sequence primitive in `textEdits.ts`

Justified by reorder (§ bands/stacks), plus turning add/remove from "reprint the file" into "touch three lines".

```ts
// packages/shared/src/payloads.ts
export interface ConfigChange {
  path: PathSegment[];
  value: unknown;
  /** "insert" puts `value` before the addressed index instead of replacing it. */
  op?: "insert";
}
```

Additive and backward compatible; `PatchSchema` gains one optional enum. In `editFor`, when the last segment is a number and the parent is a **block** `YAMLSeq`:

- **delete** — range from `lineStart(src, item.range[0])` (captures the `- ` marker, since a block-seq item's range starts after it) to `lineEnd(src, item.range[2]) + 1`, extended *backwards* over contiguous comment-only and blank lines down to the previous item's last line, so a removed widget takes its own prose comment with it.
- **insert** — `doc.createNode(value)` + `stringify`, re-indent each line to the seq's indent, prefix `- ` on the first, splice at the target item's line start (or after the last item when appending).
- **replace** — delete range + insert text.

`applyToPlain` (`textEdits.ts:94`) must learn `op: "insert"` → `splice(key, 0, value)`, since today `node[key] = value` replaces. The existing safety net (`textEdits.ts:132-137` — reparse the edited text and compare against the intended plain object) makes this safe to attempt: if the splicing is off by a character it falls back to reprint rather than corrupting the file.

---

## Widget options schema

`apps/web/src/edit/options.ts`:

```ts
export type OptionSpec =
  | { key: string; label: string; detail?: string; kind: "boolean"; default: boolean }
  | { key: string; label: string; detail?: string; kind: "number";
      default: number; min: number; max: number; step?: number; unit?: string }
  | { key: string; label: string; detail?: string; kind: "enum";
      default: string; choices: { value: string; label: string }[] }
  | { key: string; label: string; detail?: string; kind: "text";
      default: string; placeholder?: string }
  | { key: string; label: string; detail?: string; kind: "strings";
      default: string[]; max?: number };

export function optionValue<S extends OptionSpec>(spec: S, options: Record<string, unknown>): S["default"];

/**
 * The edit for setting an option. A value back at its default writes null, so
 * returning a setting to normal leaves no trace in config.yaml - the same
 * convention the settings screen already follows for `enabled` and `hidden`.
 */
export function optionChange(profile: string, id: string, spec: OptionSpec, next: unknown): ConfigChange;
```

`default` is mandatory on every spec precisely so `optionChange` can decide when to delete the key.

`WidgetDefinition` gains:

```ts
/** Display settings the edit-mode panel generates controls for, in order. */
options?: OptionSpec[];
/**
 * Editor for the config this widget reads beyond its own options - the
 * countdowns list, the commute destinations, the bins. Generated controls
 * cannot express these, so a widget that needs one brings its own.
 */
configEditor?: ComponentType<WidgetConfigProps>;
```

```ts
export interface WidgetConfigProps {
  instance: WidgetInstance;
  config: DashboardConfig;   // the staged config; edits are local until Save
  update: (recipe: (draft: DashboardConfig) => DashboardConfig) => void;
}
```

Concrete examples (defaults verified against `ClockWidget.tsx:45-46`, `CountdownsWidget.tsx`):

```ts
clock: {
  type: "clock",
  component: ClockWidget as WidgetDefinition["component"],
  chrome: true,
  options: [
    { key: "size", kind: "enum", label: "Size", default: "default",
      choices: [{ value: "default", label: "Normal" }, { value: "xl", label: "Extra large" }],
      detail: "Extra large is the night treatment: the clock is the whole screen." },
    { key: "showSeconds", kind: "boolean", label: "Show seconds", default: false },
    { key: "showDate", kind: "boolean", label: "Show the date", default: true },
  ],
},

countdowns: {
  type: "countdowns",
  component: CountdownsWidget as WidgetDefinition["component"],
  detail: CountdownsDetail as WidgetDefinition["detail"],
  dataKey: "countdowns",
  chrome: true,
  options: [{ key: "limit", kind: "number", label: "How many to show", default: 1, min: 1, max: 6 }],
  // The list itself lives at countdowns.items, shared by every countdowns
  // widget on every profile, so it cannot be an instance option.
  configEditor: CountdownsEditor,
},
```

Option coverage: clock (3), weather (`compact`, `hours`), calendar (`days`, capped at `config.calendar.daysAhead`), tasks (`assignee` — enum whose choices come from the tasks envelope's members; `readOnly`), countdowns (`limit`), river (`gauges`), temps (`limit`). The rest get `options: []` plus a `configEditor` where relevant:

| Widget | `configEditor` edits |
|---|---|
| countdowns | `countdowns.items`, `calendarTag`, `daysAhead` |
| commute | `commute.destinations` (max 5, geocode search reusing `GET /api/geocode`) |
| bins | `bins` (name, weekday, every, anchor, moved, skip) |
| river | `river.gauges` + the instance's `options.gauges` (honour `riverGaugesFor`'s "empty means use the dashboard list") |
| services | `services.checks`, `services.docker.{enabled,include,exclude}` |
| lights | `lights` (name, host, hidden) — supersedes the Lights section in Settings |
| disks | `system.disks` |
| temps | `system.tempWarn`, `system.tempCrit` |
| calendar | `calendar.daysAhead` |
| tasks | `ticktick.listName` |

---

## Build order

Each step leaves the app working, tests green, and is committable.

0. **Groundwork, no behaviour change.** Commit the design doc. Extract `groupWidgets()` from `layout.ts`; extract `Section`/`Row` into `settings/parts.tsx`. Existing tests pass unchanged.
1. **`edit/grid.ts` + `edit/geometry.ts` + tests.** Nothing wired up.
2. **`edit/mutations.ts` + tests.** Still nothing wired up.
3. **`edit/diff.ts` + tests.** Server: PATCH cap → 200; comment-preservation test in `loader.test.ts`.
4. **Edit shell.** `EditContext`, `EditToolbar`, entry point as a row in Settings' Widgets section ("Edit layout" — no new always-visible chrome on a kiosk). Renders the draft; shows *all* widgets including `enabled: false` and `relevant: false` ones (`layout(widgets, () => true)`); tile bodies non-interactive; tap selects; Cancel/Save work. Commit: edit mode exists and does nothing.
5. **Drag to move.** Do this before anything else UI-shaped — Safari pointer capture is the biggest unknown and everything downstream assumes it works.
6. **Resize.** − / + width and height on the selection bar, via `clampResize`.
7. **Add and remove widgets.** Picker over `widgetRegistry`, `uniqueWidgetId`, `freeRectFor`. First step whose save is index-addressed — verify the file diff by hand.
8. **Pages.** Add, remove, "Move to page ▸", toolbar page switcher.
9. **Band and stack vocabulary.** Join, leave, create, `normaliseStack`.
   - **9a.** `textEdits.ts` block-sequence insert/remove + `op` on `ConfigChange`. Turns reorder into a real splice and makes add/remove surgical rather than a reprint.
10. **Options panel.** `OptionSpec` on `WidgetDefinition`, generated controls, specs for all 16 types.
11. **Bespoke `configEditor`s.** Countdowns, commute, bins, river gauges, services checks, lights, disks, temps. Retire the Lights section from `SettingsPanel`.
12. **Profiles.** Create and delete with schedule tiling; theme per profile.
13. **Polish.** Undo stack, invalid-tile outlines, empty-page state, README and `config.example.yaml` note that layout is now editable from the wall.

---

## Verification

**Unit (vitest, `environment: "node"` — no jsdom, which reinforces the pure-functions-only rule):**

- `edit/grid.test.ts` — `blocksOf` against the real day page 1 (fixed + a `right-column` stack) and the night profile (a four-member band); `overlaps`; `canPlace`; `dropOutcome` covering free / same-size swap / different-size blocked; `clampResize` at column 12, at row 1, and into a neighbour; `freeRectFor` including no-room; `freeRunIn`.
- `edit/geometry.test.ts` — `snapRect` at half-cell and cell-and-a-half deltas with the 14px gap, clamped at every edge.
- `edit/mutations.test.ts` — every band/stack transition in both directions, each result fed through `GridPlacementSchema.parse()` so the `col`-unless-`share` and 12-column rules are checked for free. Plus `uniqueWidgetId`, `uniqueStackName`, `nextPageNumber`, `addPage`/`removePage`, `normaliseStack`.
- `edit/profiles.test.ts` — the invariant as a property: after create or delete, walk all 1440 minutes of the day and assert **exactly one** profile matches at each. Catches gaps and overlaps in one assertion; mirrors `scheduleChanges()` (`settings/model.ts:11-27`).
- `edit/diff.test.ts` — **the most valuable file.** A table of scenarios (move, resize, swap, add/remove widget, reorder in band, reorder in stack, option set, option reset-to-default, add/remove page, add/delete profile, edit `countdowns.items`), each asserting: (1) **round trip** — applying the emitted changes to `base` with the server's index semantics deep-equals `next`; (2) **scalar purity** — a pure-layout scenario emits only scalar-or-null values, so `editText` won't bail; (3) **ordering** — removals descend, insertions follow removals; (4) **size** — a full-page re-layout stays well inside 200.
- `apps/server/src/config/loader.test.ts` (extend) — the anti-corrosion guard. Apply a realistic editor batch to a copy of `config.example.yaml` and assert the result validates, **the `#` count is unchanged** (the test that would have caught the 65→49 regression), and that an all-scalar batch's line diff touches only the edited lines.
- `apps/server/src/config/textEdits.test.ts` (new, with 9a) — sequence insert/remove/replace, comment-before capture on delete, indentation on insert, and that a malformed attempt falls through to `null` rather than writing garbage.

Run: `npm test`, `npm run typecheck`.

**End to end:** `npm run dev`, open on the actual iPad — the pointer-capture behaviour must be confirmed on real glass, not in Safari's responsive mode. Per step: drag a tile and watch the pager *not* scroll; drop onto a same-size tile and see them swap; drop onto a different-size tile and see it spring back; Cancel and confirm `config.yaml` is untouched; Save and confirm the diff is exactly the moved tile's `col`/`row` and nothing else.

**`git diff config/config.yaml` after each save is the real acceptance test.**

---

## Risks, worst first

1. **Pointer capture inside the snap scroller on Safari 16** — the one thing that could invalidate the interaction design. Mitigated structurally (pager scrolling off in edit mode, `touch-action: none`, explicit page buttons) and by ordering: step 5 is a spike on a single tile before anything depends on it.
2. **Comment corrosion** — measured and real: one whole-array write costs 16 of 65 comments in the shipped example, irreversibly, on a fresh user's first reorder. Mitigated by scalar-first diffing, never writing the `widgets` array whole, step 9a, and the comment-count assertion.
3. **Index-based change ordering** — `resolvePath` resolves against the pre-patch config but applies sequentially to a mutating document. A batch mixing deletes and appends is silently wrong unless ordered. Mitigated by the emission contract and the round-trip test.
4. **`layout.ts` and the editor disagreeing about grouping** — subtle symptom, two copies drift. Mitigated by step 0.
5. **Producing config the server rejects** — `col is required unless share is true` is easy to trip when leaving a band. A 400 after ten minutes of editing is the worst possible failure here. Mitigated by parsing the draft with `DashboardConfigSchema` on every mutation.
6. **Stacks whose member `row` values don't match array order** — invisible while stacked, wrong the moment a member leaves. Mitigated by `normaliseStack`.
7. **Forgetting that edit mode must show hidden widgets** — `enabled: false` widgets and `bins` between collections are absent from the normal render. If absent in edit mode you can't move them, and worse, their space looks free but isn't. `blocksOf` must include them.
8. **Band creation claiming a whole row** — promoting a 4-wide tile into a new band silently claims the other 8 columns. Must be a `canPlace` guard with a clear refusal, not a surprise.
9. **Losing a session** — the draft survives an iPad sleep (separate state), but the Pager idle-return and Settings idle-close must be disabled while editing or the wall will helpfully undo your navigation mid-drag.
10. **Two editors at once** — out of scope. `{ id }`-addressed scalar changes degrade this to last-writer-wins *per field* rather than whole-file clobber.

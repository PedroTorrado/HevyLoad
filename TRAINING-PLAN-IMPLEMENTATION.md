# HevyLoad Training Plan — Implementation & Improvement Proposal

## Purpose

This document turns the current HevyLoad suggestions screen into an editable, history-aware
training-plan system. It combines:

- the current HevyLoad powerbuilding split and Supabase data model;
- the rolling-block, time-boxed structure described in `Training Split`;
- OpenGym's strongest planning ideas: explicit constraints, explainable recommendations,
  plan/version separation, user approval, snapshots, and feedback-driven recalculation.

This is an implementation proposal for HevyLoad. It does **not** add an AI dependency or replace
the existing workout history.

## Design principles

1. **Recommend, do not lock.** A generated plan is a draft. Users can edit days, exercises,
   sets, reps, rest, loads, and progression rules before activation.
2. **Separate plan from performance.** Planned targets and completed sets are different records.
   Editing a future plan must never rewrite imported or completed history.
3. **Keep load calculation deterministic.** Recommendation logic chooses the structure and policy;
   the progression helper calculates a suggested load from recent evidence.
4. **Explain every recommendation.** Show the evidence, constraints, trade-offs, and confidence
   behind a split or exercise choice.
5. **Support real schedules.** A plan can use fixed weekdays, a rolling order, or a one-off
   session. Missing a day must not silently discard the next planned session.
6. **Prefer safe substitutions.** Replacements preserve movement pattern and muscle intent by
   default, while respecting equipment and user exclusions.
7. **Fail explicitly.** Missing history, unavailable exercises, or incompatible constraints should
   be shown to the user rather than converted into an apparently valid but empty plan.

## Current baseline and gaps

The existing [training program](./lib/training-program.ts) provides a useful four-session
powerbuilding baseline:

| Session | Focus | Current role |
|---|---|---|
| A | Squat + chest push | Squat and bench volume |
| B | Hinge + back pull | Deadlift, rows, pulldowns |
| C | Bench priority + upper | Bench intensity and upper accessories |
| D | Lower hypertrophy | Quads, hamstrings, unilateral work |

The current [suggestions screen](./app/app/suggestions.tsx) already loads exercises, recent sets,
and bodyweight, but it has important limits:

- the split is hardcoded rather than selected from user goals and availability;
- aliases are substring matches, so exercise selection can be noisy;
- the highest estimated 1RM is used without a recency, volume, or effort-quality signal;
- every suggestion uses a fixed 70% estimate rather than a configurable progression policy;
- only 1,000 sets are requested and there is no explicit evidence window;
- the user cannot edit, save, activate, compare, or revert a proposed plan;
- no planned-vs-performed record exists for adherence, skipped sessions, or recovery feedback;
- target sets do not expose rest, effort target, set type, substitution group, or rationale.

## Target user flow

```text
Start plan
  -> Answer essential preferences
  -> Review inferred history
  -> Receive ranked compatible plans
  -> Inspect reasons, volume, duration, and recovery
  -> Edit, replace, lock, or remove components
  -> Save draft
  -> Activate a versioned plan
  -> Complete or skip sessions
  -> Review adherence and performance
  -> Adjust the next block from evidence
```

The existing quick suggestions view should remain available as a low-friction entry point. It
should offer “Use as draft” rather than forcing the full questionnaire.

## Recommendation inputs

### Essential preferences

Store structured answers, not only free text:

| Input | Examples | Effect |
|---|---|---|
| Primary goal | strength, hypertrophy, recomposition, general fitness | Chooses emphasis and progression defaults |
| Reliable sessions | 2, 3, 4, 5, variable | Filters candidate split families |
| Schedule mode | fixed weekdays, rolling, variable | Chooses calendar or cycle behavior |
| Session limit | under 30, 30–45, 45–60, 60+ minutes | Caps slots and rest assumptions |
| Equipment | full gym, barbell, machines, cables, dumbbells, bodyweight | Filters exercises |
| Priority muscles | chest, back, shoulders, arms, quads, posterior chain, balanced | Allocates exposure |
| Avoidances | exercise, pattern, joint limitation, free text | Hard exclusions and substitutions |
| Preferred style | heavy, moderate, high reps, supersets, straight sets | Sets prescription defaults |
| Recovery tolerance | quick, average, needs more recovery, unsure | Controls spacing and fatigue |

Optional answers can capture preferred exercises, variety, effort style, and whether automatic
progression is wanted.

### History-derived signals

When imported data exists, show inferred statements for confirmation:

- training frequency and session spacing;
- recurring exercise families and most recently used movements;
- typical session duration;
- current and recent estimated 1RM;
- muscle exposure and gaps;
- completion, skipped-session, and replacement patterns;
- confidence limits such as missing RPE or missing weight.

Confirmed user corrections override weak history signals. A single explicit avoidance is a hard
constraint; repeated completions are a gradual preference signal.

## Plan catalogue

Seed these as editable templates. The current A/B/C/D plan is the first-class powerbuilding
candidate, not the only option.

### P1 — Rolling Push / Pull / Lower

```text
Push -> Pull -> Lower -> repeat
```

Best for three sessions or unpredictable attendance. Each day has one primary movement, two
secondary slots, and optional accessories or core.

### P2 — Four-day Upper / Lower

```text
Upper A -> Lower A -> Upper B -> Lower B
```

Best for balanced strength and muscle gain with twice-per-cycle exposure.

### P3 — Rolling Powerbuilding A/B/C/D

```text
A: Squat + chest push
B: Hinge + back pull
C: Bench priority + upper
D: Lower hypertrophy
```

Use the current exercise catalogue and shoulder-safe substitutions. Keep the two bench exposures
at least 48 hours apart when calendar scheduling allows.

### P4 — Five-day PPL + Upper / Lower

Best for consistent five-day users and specialization phases. Apply a weekly volume ceiling so
the extra day does not automatically become excessive fatigue.

### P5 — Full body, two or three days

Each session contains a knee-dominant movement, press, pull, posterior-chain movement, and an
optional core or conditioning slot. This is the fallback for low frequency or highly variable
attendance.

### P6 — Muscle-focus session

Generate a short one-off session around a selected priority. It must show that it is not a
replacement for a complete weekly recovery plan.

## Candidate selection

### Hard constraints

Reject a candidate when it:

- requires more reliable days than the user selected;
- needs unavailable equipment;
- contains an explicitly avoided movement or pattern;
- exceeds the hard session-duration limit;
- cannot represent the selected schedule mode.

If no candidate survives, show the conflicting constraints and ask which one may be relaxed.

### Explainable ranking

Rank surviving candidates with visible components rather than a misleading single percentage:

```text
fit =
  goal fit
  + schedule fit
  + duration fit
  + equipment fit
  + recovery fit
  + preference fit
  + history fit
  + variety fit
  - complexity cost
  - disliked-pattern cost
```

Each component should produce a sentence such as:

- “Matches four available sessions.”
- “Uses your recent bench, row, and squat movement families.”
- “Keeps the estimated core session within 45–60 minutes.”
- “Provides two chest exposures because chest is your selected priority.”
- “Does not use overhead pressing because it is excluded.”

## Plan and exercise model

The following types should be introduced in `lib/` before expanding the UI:

```text
TrainingPlan
  id, user_id, name, goal, schedule_mode, status, version, source
  days[], duration_target, created_at, updated_at

TrainingDay
  key, title, focus, order, weekday?, estimated_minutes
  exercises[], locked

PlannedExercise
  exercise_id, movement_pattern, primary_muscle, secondary_muscles[]
  sets, reps, set_type, target_load?, target_rpe?, rest_seconds
  progression_policy, substitutions[], rationale, locked

PlanVersion
  plan_id, version, status=draft|active|superseded
  source_run_id, snapshot, created_at

WorkoutInstance
  plan_id, plan_version, day_key, scheduled_date?
  status=scheduled|in_progress|completed|skipped|cancelled
  performed_workout_id?
```

Completed workout records remain authoritative for what happened. A new plan version affects
future unscheduled instances only unless the user explicitly updates scheduled-but-unstarted
sessions.

## Prescription and progression improvements

### Core and flush blocks

Use the `Training Split` structure for time-boxing:

- **Core block:** 35–45 minutes; primary compound, required secondary work, and integrated
  shoulder-health work.
- **Flush block:** optional 10–15 minutes; isolation, myo-reps, arms, calves, core, or
  conditioning.

The UI must label optional work clearly so a 45-minute user can finish the required session.
Estimated duration should include set count, rest, and superset savings.

### Periodization

Represent blocks above days:

```text
Plan -> Block -> Week -> Day -> Planned exercise -> Planned sets
```

The default powerbuilding block can use:

| Phase | Weeks | Intent |
|---|---:|---|
| Accumulation | 1–4 | Build volume and technique at moderate effort |
| Intensification | 5–7 | Reduce volume and increase load |
| Deload/assessment | 8 | Reduce volume and collect a clean performance signal |

The progression engine must own load arithmetic. The plan stores policy and boundaries such as
rep range, increment, RIR/RPE target, and deload behavior.

### Better load evidence

Replace the current single fixed 70% estimate with:

1. choose the user's most recent valid performance inside a bounded evidence window;
2. calculate e1RM only for weighted, positive-load, positive-rep sets;
3. prefer recent consistent working sets over an old all-time peak;
4. use a configurable percentage or RIR/RPE policy;
5. round using the user's increment;
6. show the source set, date, formula, and confidence;
7. return “no load estimate” when evidence is insufficient.

Bodyweight, timed, distance, warmup, dropset, and failure records must remain valid without being
forced through a weighted e1RM calculation.

## Exercise matching and substitutions

Replace free-form alias matching with explicit metadata:

```text
ExerciseProfile
  exercise_id
  movement_pattern
  primary_muscle
  secondary_muscles[]
  equipment[]
  fatigue_cost
  shoulder_friendly
  substitution_group
```

Examples of substitution groups:

```text
horizontal_press:
  barbell bench -> dumbbell bench -> machine press -> push-up
vertical_pull:
  pull-up -> assisted pull-up -> lat pulldown -> single-arm pulldown
hinge:
  barbell deadlift -> trap-bar deadlift -> Romanian deadlift -> cable hinge
horizontal_pull:
  bent-over row -> chest-supported row -> cable row -> machine row
```

The replacement should preserve the movement pattern and intended muscle emphasis unless the
user explicitly changes the goal. Preserve the original exercise in the plan history when a
substitution is made.

## Feedback loop

After activation, record:

- planned versus completed sets, reps, load, duration, and effort;
- completed, skipped, cancelled, and rescheduled instances;
- user replacements and edits;
- optional session rating (`easy`, `right`, `hard`) and note;
- bodyweight trend when available;
- muscle exposure and recovery warnings.

Use this evidence to create a draft adjustment, never an automatic silent change. Examples:

- repeated completion of A–C but skipped D → offer a three-day rolling plan or shorter D;
- repeated deadlift replacement with RDL → raise RDL preference and offer it first;
- high effort plus stalled bench → reduce fatigue or vary the press while preserving chest
  frequency;
- chest volume below the user's successful range → explain the gap and suggest a second exposure;
- repeated long sessions → remove optional slots or convert compatible work to supersets.

Every adjustment is a discrete change with `before`, `after`, `why`, evidence dates, and an
accept/reject action. Applying accepted changes snapshots the prior active plan; reverting a
snapshot never modifies completed history.

## Supabase rollout

The existing `exercises`, `sets`, `workouts`, and `profiles` tables remain the source of history.
Add recommendation data in stages:

| Table | Purpose |
|---|---|
| `training_plans` | User-owned plan identity and active version |
| `training_plan_versions` | Immutable draft/active/superseded snapshots |
| `training_plan_days` | Ordered days, schedule metadata, duration |
| `training_plan_exercises` | Prescriptions, policies, substitutions, rationale |
| `training_workout_instances` | Scheduled/rolling cycle state |
| `recommendation_profiles` | Normalized preferences and hard constraints |
| `recommendation_runs` | Input snapshot, candidates, selected result |
| `recommendation_feedback` | Likes, dislikes, locks, replacements, and reasons |

Apply RLS to every user-owned table. Seeded candidate definitions should be readable but not
mutable by users; user drafts are copies. Do not store another user's training history in a
recommendation run.

## UI implementation phases

### Phase 1 — Foundation and safe compatibility

- Extract plan, day, exercise, prescription, and duration types.
- Preserve the current A/B/C/D suggestions output.
- Add explicit exercise metadata and substitution groups.
- Replace the unbounded “best set” assumption with a bounded, explainable evidence helper.
- Add tests for matching, e1RM filtering, load rounding, and rolling next-day selection.

### Phase 2 — Draft plans and preferences

- Add essential questionnaire with a quick mode.
- Store normalized preferences and inferred-history confirmations.
- Seed P1–P6 candidates and implement hard-constraint filtering.
- Add explainable candidate ranking and a draft plan editor.
- Let users edit, replace, lock, remove, save, and compare plan components.

### Phase 3 — Activation and tracking

- Add versioned plan persistence and workout instances.
- Support fixed-week, rolling, and one-off scheduling.
- Show the next compatible session and recovery warnings.
- Keep completed history immutable and preserve plan snapshots.

### Phase 4 — Evidence-based adjustment

- Add planned-vs-performed comparisons, session ratings, and replacement signals.
- Generate discrete review proposals with evidence and rationales.
- Add accept/reject, snapshot, and one-tap revert.
- Add bounded cadence later; on-demand review should work first.

### Phase 5 — Optional coaching integrations

An AI or external coaching provider is explicitly later work. If added, it may propose plan
changes only through the same validated draft/change-set interface. It must not calculate or
silently apply per-session loads, access credentials, or modify completed history.

## Acceptance criteria

- A user can receive a compatible plan from goal, availability, duration, equipment, and
  limitation inputs.
- Existing imported history improves exercise and load suggestions without being required.
- Hard constraints are never silently violated.
- The recommendation shows reasons, assumptions, evidence dates, and trade-offs.
- At least three materially different alternatives are shown when compatible candidates exist.
- Every planned exercise and set target is editable.
- The user can use fixed weekdays, rolling order, or a one-off session.
- Missing a session advances the rolling cycle correctly rather than deleting a day.
- The current A/B/C/D powerbuilding plan remains available as a draft candidate.
- Core and optional flush work are visibly separated and duration estimates are testable.
- Weighted and non-weighted set types are handled without invalid e1RM output.
- Activating or editing a plan never rewrites completed workout history.
- Applying a review creates a snapshot and supports revert.
- RLS prevents access to another user's plans, preferences, feedback, or recommendation runs.

## Source references

- HevyLoad baseline: [lib/training-program.ts](./lib/training-program.ts) and
  [app/app/suggestions.tsx](./app/app/suggestions.tsx)
- Training structure: `/home/admin/Documents/Projects/Training Split/training_program.md`,
  `/home/admin/Documents/Projects/Training Split/generic-training-program-structure.md`, and
  `/home/admin/Documents/Projects/Training Split/adaptive-training-split-recommender-plan.md`
- OpenGym planning patterns: `/home/admin/Documents/Projects/opengym/docs/AI_COACH.md`,
  `/home/admin/Documents/Projects/opengym/ai-enablement/functional-plan.md`, and
  `/home/admin/Documents/Projects/opengym/ai-enablement/implementation-plan.md`

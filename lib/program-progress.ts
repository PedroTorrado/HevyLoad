/**
 * Program progress, adherence and recovery-aware adaptations.
 *
 * Flow:
 *  1. syncProgramProgress() matches each unlogged workout (after activation) to the planned session at the
 *     current cursor and stores adherence (muscle coverage, RPE delta, volume ratio) in program_session_logs.
 *  2. getProgramPosition() derives week / phase / next session from the counted logs.
 *  3. computeRecovery() builds per-muscle fatigue from recent workouts, decayed by the time elapsed —
 *     a hard session 4 days ago barely matters, the same session 12 hours ago matters a lot.
 *  4. computeAdaptations() combines adherence trends + recovery into concrete changes for the next session.
 */
import { supabase } from "./supabase";
import { CustomExercise, CustomProgram, CustomSession, getProgramWeeks, WeekPhase } from "./custom-programs";
import { estimateOneRepMax, matchesTrainingTarget } from "./training-recommendations";

// ---------- Types ----------

export interface LoggedSet {
    exercise_id: string;
    weight_kg: number;
    reps: number;
    rpe?: number | null;
    set_type?: string | null;
}

export interface LoggedWorkout {
    id: string;
    start_time: string;
    end_time?: string | null;
    sets: LoggedSet[];
}

export interface ExerciseInfo {
    id: string;
    name: string;
    muscle_group: string | null;
}

export type AdjustmentKind = "load" | "sets" | "rpe" | "add-sets" | "deload-early" | "reduce-frequency" | "ramp-back";

export interface Adjustment {
    targetKey: string | null; // null = whole session/program
    kind: AdjustmentKind;
    value: number;
    reason: string;
}

export interface SessionLog {
    workout_id: string;
    week_index: number;
    session_key: string;
    phase: WeekPhase;
    counted: boolean;
    muscle_coverage: number;
    avg_rpe_delta: number | null;
    volume_ratio: number;
    adjustments: Adjustment[];
    created_at?: string;
    start_time?: string;
}

interface SessionLogRow {
    workout_id: string;
    week_index: number;
    session_key: string;
    phase: WeekPhase;
    counted: boolean;
    muscle_coverage: number;
    avg_rpe_delta: number | null;
    volume_ratio: number;
    adjustments: Adjustment[];
    created_at?: string;
}

export interface ProgramPosition {
    week: number;
    phase: WeekPhase;
    sessionIndex: number;
    session: CustomSession;
    completedSessions: number;
    missedSessions: number;
}

export interface MuscleRecovery {
    muscle: string;
    fatigue: number;       // decayed stress units
    readiness: number;     // 0 (wrecked) … 1 (fully recovered)
    hoursSinceLast: number;
    lastRpe: number | null;
}

export interface RecoveryState {
    hoursSinceLastWorkout: number | null;
    muscles: Record<string, MuscleRecovery>;
}

// ---------- Tunables ----------
// NOTE: app/app/program-guide.tsx describes this behaviour to users. It documents the code, not the
// other way round — when you change rules or numbers here, update that page to match.

const COUNTED_COVERAGE_MIN = 0.4;
const FATIGUE_HALF_LIFE_HOURS = 30;   // big-muscle recovery half-life
const FATIGUE_FULL_SCALE = 6;         // stress at which readiness hits 0
const LONG_GAP_DAYS = 10;

export const PROGRESS_TUNABLES = { COUNTED_COVERAGE_MIN, FATIGUE_HALF_LIFE_HOURS, FATIGUE_FULL_SCALE, LONG_GAP_DAYS } as const;

const isWorkingSet = (s: LoggedSet) => (s.set_type ?? "normal").toLowerCase() !== "warmup" && s.reps > 0;
const norm = (muscle: string | null | undefined) => (muscle ?? "other").trim().toLowerCase();
const hoursBetween = (a: Date, b: Date) => Math.max(0, (b.getTime() - a.getTime()) / 3_600_000);

function fromSessionLogRow(row: SessionLogRow): SessionLog {
    return {
        workout_id: row.workout_id,
        week_index: row.week_index,
        session_key: row.session_key,
        phase: row.phase,
        counted: row.counted,
        muscle_coverage: Number(row.muscle_coverage),
        avg_rpe_delta: row.avg_rpe_delta == null ? null : Number(row.avg_rpe_delta),
        volume_ratio: Number(row.volume_ratio),
        adjustments: Array.isArray(row.adjustments) ? row.adjustments : [],
        created_at: row.created_at,
    };
}

// ---------- Effort estimation ----------

/** Logged RPE, or an estimate from reps vs. best known e1RM (reps-in-reserve model). */
export function effectiveRpe(set: LoggedSet, bestE1rm: number | undefined): number | null {
    if (set.rpe != null && Number.isFinite(Number(set.rpe))) return Number(set.rpe);
    if (!bestE1rm || set.weight_kg <= 0) return null;
    const ratio = Math.min(1, set.weight_kg / bestE1rm);
    const maxReps = Math.max(set.reps, (1.0278 - ratio) / 0.0278);
    return Math.max(5, Math.min(10, 10 - (maxReps - set.reps)));
}

export function buildE1rmIndex(history: LoggedWorkout[]): Map<string, number> {
    const best = new Map<string, number>();
    for (const w of history) for (const s of w.sets) {
        if (!isWorkingSet(s)) continue;
        const e = estimateOneRepMax(s.weight_kg, s.reps);
        if (e > (best.get(s.exercise_id) ?? 0)) best.set(s.exercise_id, e);
    }
    return best;
}

// ---------- Adherence ----------

export function matchWorkoutToSession(
    workout: LoggedWorkout,
    planned: CustomSession,
    exercises: Map<string, ExerciseInfo>,
    e1rm: Map<string, number>,
) {
    const working = workout.sets.filter(isWorkingSet);
    const plannedMuscles = new Set(planned.exercises.map((e) => norm(e.group)));
    const trainedMuscles = new Set<string>();
    const setsByTarget = new Map<string, LoggedSet[]>();
    const usedSets = new Set<LoggedSet>();

    for (const s of working) trainedMuscles.add(norm(exercises.get(s.exercise_id)?.muscle_group));

    for (const target of planned.exercises) {
        const matched = working.filter((s) => {
            if (usedSets.has(s)) return false;
            const info = exercises.get(s.exercise_id);
            return info ? matchesTrainingTarget(info.name, info.muscle_group, target) : false;
        });
        const fallback = matched.length ? matched : working.filter((s) => !usedSets.has(s) && norm(exercises.get(s.exercise_id)?.muscle_group) === norm(target.group));
        const chosen = fallback.slice(0, Math.max(target.prescription.sets, fallback.length));
        chosen.forEach((s) => usedSets.add(s));
        setsByTarget.set(target.key, chosen);
        if (chosen.length) trainedMuscles.add(norm(target.group));
    }

    const covered = [...plannedMuscles].filter((m) => trainedMuscles.has(m));
    const missedMuscles = [...plannedMuscles].filter((m) => !trainedMuscles.has(m));
    const extraMuscles = [...trainedMuscles].filter((m) => !plannedMuscles.has(m) && m !== "other");

    const plannedSets = planned.exercises.reduce((n, e) => n + e.prescription.sets, 0);
    const doneSets = [...setsByTarget.values()].reduce((n, s) => n + s.length, 0);

    const rpeDeltas: { targetKey: string; delta: number }[] = [];
    for (const target of planned.exercises) {
        if (target.optional || target.prescription.targetRpe == null) continue;
        const rpes = (setsByTarget.get(target.key) ?? [])
            .map((s) => effectiveRpe(s, e1rm.get(s.exercise_id)))
            .filter((r): r is number => r != null);
        if (rpes.length) rpeDeltas.push({ targetKey: target.key, delta: rpes.reduce((a, b) => a + b, 0) / rpes.length - target.prescription.targetRpe });
    }

    return {
        muscleCoverage: plannedMuscles.size ? covered.length / plannedMuscles.size : 1,
        volumeRatio: plannedSets ? Math.min(1.5, doneSets / plannedSets) : 1,
        avgRpeDelta: rpeDeltas.length ? rpeDeltas.reduce((a, b) => a + b.delta, 0) / rpeDeltas.length : null,
        rpeDeltas,
        missedMuscles,
        extraMuscles,
    };
}

// ---------- Position ----------

export function getProgramPosition(program: CustomProgram, logs: SessionLog[], now = new Date()): ProgramPosition {
    const weeks = getProgramWeeks(program);
    const perWeek = weeks[0].sessions.length;
    const counted = logs.filter((l) => l.counted).length;
    let weekIdx = Math.floor(counted / perWeek) % weeks.length;
    let sessionIndex = counted % perWeek;
    let missedSessions = 0;

    if (program.scheduleMode === "calendar" && program.activatedAt) {
        const elapsedWeeks = Math.floor(hoursBetween(new Date(program.activatedAt), now) / (24 * 7));
        const calendarWeek = elapsedWeeks % weeks.length;
        const expected = elapsedWeeks * perWeek;
        missedSessions = Math.max(0, expected - counted);
        if (calendarWeek !== weekIdx) {
            weekIdx = calendarWeek;
            sessionIndex = Math.min(sessionIndex, perWeek - 1);
        }
    }

    const week = weeks[weekIdx];
    return {
        week: week.week,
        phase: week.phase,
        sessionIndex,
        session: week.sessions[sessionIndex],
        completedSessions: counted,
        missedSessions,
    };
}

// ---------- Recovery ----------

/**
 * Per-muscle fatigue: each working set adds stress scaled by effort (RPE 6 ≈ 0.25, RPE 10 ≈ 1.25),
 * then decays exponentially with the hours since that workout.
 */
export function computeRecovery(
    recent: LoggedWorkout[],
    exercises: Map<string, ExerciseInfo>,
    e1rm: Map<string, number>,
    now = new Date(),
): RecoveryState {
    const muscles: Record<string, MuscleRecovery> = {};
    let lastWorkout: Date | null = null;

    for (const w of recent) {
        const end = new Date(w.end_time ?? w.start_time);
        if (end > now) continue;
        if (!lastWorkout || end > lastWorkout) lastWorkout = end;
        const hours = hoursBetween(end, now);
        const decay = Math.pow(0.5, hours / FATIGUE_HALF_LIFE_HOURS);
        if (decay < 0.02) continue;

        for (const s of w.sets.filter(isWorkingSet)) {
            const muscle = norm(exercises.get(s.exercise_id)?.muscle_group);
            const rpe = effectiveRpe(s, e1rm.get(s.exercise_id)) ?? 7.5;
            const stress = Math.max(0.1, (rpe - 5) / 4);
            const m = (muscles[muscle] ??= { muscle, fatigue: 0, readiness: 1, hoursSinceLast: Infinity, lastRpe: null });
            m.fatigue += stress * decay;
            if (hours < m.hoursSinceLast) { m.hoursSinceLast = hours; m.lastRpe = rpe; }
            else if (hours === m.hoursSinceLast) m.lastRpe = Math.max(m.lastRpe ?? 0, rpe);
        }
    }

    for (const m of Object.values(muscles)) m.readiness = Math.max(0, Math.min(1, 1 - m.fatigue / FATIGUE_FULL_SCALE));
    return { hoursSinceLastWorkout: lastWorkout ? hoursBetween(lastWorkout, now) : null, muscles };
}

const fmtHours = (h: number) => (h < 36 ? `${Math.round(h)}h` : `${Math.round(h / 24)} days`);

// ---------- Adaptations ----------

export function computeAdaptations(
    next: CustomSession,
    phase: WeekPhase,
    logs: SessionLog[],
    recovery: RecoveryState,
    lastMatch?: ReturnType<typeof matchWorkoutToSession>,
): Adjustment[] {
    const out: Adjustment[] = [];
    const counted = logs.filter((l) => l.counted);
    const recent = counted.slice(-3);

    // Long break → ramp back regardless of plan.
    if (recovery.hoursSinceLastWorkout != null && recovery.hoursSinceLastWorkout > LONG_GAP_DAYS * 24) {
        out.push({ targetKey: null, kind: "ramp-back", value: -10, reason: `${fmtHours(recovery.hoursSinceLastWorkout)} since your last workout. Start about 10% lighter and build back up.` });
    }

    for (const ex of next.exercises) {
        const muscle = norm(ex.group);
        const rec = recovery.muscles[muscle];

        // Recovery: time-aware. Hard + recent = back off; hard + long ago = fine (or push).
        if (rec && phase === "build") {
            if (rec.readiness < 0.45) {
                out.push({ targetKey: ex.key, kind: "load", value: -5, reason: `${ex.group} trained ${fmtHours(rec.hoursSinceLast)} ago${rec.lastRpe ? ` at RPE ${rec.lastRpe.toFixed(1)}` : ""}. It's still recovering.` });
                out.push({ targetKey: ex.key, kind: "sets", value: -1, reason: `${ex.group} hasn't recovered yet` });
            } else if (rec.readiness < 0.7) {
                out.push({ targetKey: ex.key, kind: "rpe", value: -0.5, reason: `${ex.group} partly fatigued (trained ${fmtHours(rec.hoursSinceLast)} ago)` });
            }
        }

        // Adherence: RPE vs target on this lift from recent sessions.
        const lastDelta = lastMatch?.rpeDeltas.find((d) => d.targetKey === ex.key)?.delta;
        const fresh = !rec || rec.readiness >= 0.85;
        if (lastDelta != null && phase === "build") {
            if (lastDelta >= 1 && !(rec && rec.hoursSinceLast > 72)) {
                out.push({ targetKey: ex.key, kind: "load", value: -2.5, reason: `Last time was RPE +${lastDelta.toFixed(1)} over target` });
            } else if (lastDelta >= 1 && rec && rec.hoursSinceLast > 72) {
                // Hard session but days ago: hold load instead of dropping.
                out.push({ targetKey: ex.key, kind: "load", value: 0, reason: `Last session was hard, but ${fmtHours(rec.hoursSinceLast)} of rest is enough. Keep the same load.` });
            } else if (lastDelta <= -1 && fresh) {
                out.push({ targetKey: ex.key, kind: "load", value: 2.5, reason: `Last time was RPE ${lastDelta.toFixed(1)} under target and you're recovered` });
            }
        } else if (fresh && rec && rec.hoursSinceLast > 72 && phase === "build" && (lastMatch?.avgRpeDelta ?? 0) <= 0) {
            out.push({ targetKey: ex.key, kind: "rpe", value: 0.5, reason: `${ex.group} has rested ${fmtHours(rec.hoursSinceLast)}, so you can push a bit harder` });
        }
    }

    // Missed muscles from last session → add volume where the next session already trains them (or the first slot).
    for (const muscle of lastMatch?.missedMuscles ?? []) {
        const target = next.exercises.find((e) => norm(e.group) === muscle);
        if (target && (recovery.muscles[muscle]?.readiness ?? 1) > 0.6) {
            out.push({ targetKey: target.key, kind: "add-sets", value: 1, reason: `${target.group} was skipped last session` });
        }
    }

    // Extra muscles trained last time that the next session also hits → trim if not recovered.
    for (const muscle of lastMatch?.extraMuscles ?? []) {
        const target = next.exercises.find((e) => norm(e.group) === muscle);
        if (target && (recovery.muscles[muscle]?.readiness ?? 1) < 0.8) {
            out.push({ targetKey: target.key, kind: "sets", value: -1, reason: `${target.group} got unplanned work last session` });
        }
    }

    // Fatigue trend: RPE drifting up across 3 sessions while short on rest → bring deload forward.
    const deltas = recent.map((l) => l.avg_rpe_delta).filter((d): d is number => d != null);
    if (phase === "build" && deltas.length === 3 && deltas[0] < deltas[1] && deltas[1] < deltas[2] && deltas[2] >= 1) {
        out.push({ targetKey: null, kind: "deload-early", value: 1, reason: "Effort has climbed for 3 sessions in a row. Think about taking the deload now." });
    }

    // Chronic under-completion.
    if (recent.length === 3 && recent.every((l) => l.volume_ratio < 0.7)) {
        out.push({ targetKey: null, kind: "reduce-frequency", value: -1, reason: "You've done under 70% of the planned volume lately. Try fewer or shorter sessions." });
    }

    return dedupe(out);
}

/** Keep one adjustment per (target, kind); recovery/safety wins over progression (most negative). */
function dedupe(adjustments: Adjustment[]): Adjustment[] {
    const map = new Map<string, Adjustment>();
    for (const a of adjustments) {
        const k = `${a.targetKey}:${a.kind}`;
        const prev = map.get(k);
        if (!prev || a.value < prev.value) map.set(k, a);
    }
    return [...map.values()];
}

export function applyAdjustments(session: CustomSession, adjustments: Adjustment[]): (CustomExercise & { adjustments: Adjustment[] })[] {
    const global = adjustments.filter((a) => a.targetKey === null && a.kind === "ramp-back");
    return session.exercises.map((ex) => {
        const mine = adjustments.filter((a) => a.targetKey === ex.key);
        const p = { ...ex.prescription };
        for (const a of [...mine, ...global]) {
            if ((a.kind === "load" || a.kind === "ramp-back") && p.loadPercent) p.loadPercent = Math.round(p.loadPercent * (1 + a.value / 100));
            if (a.kind === "sets") p.sets = Math.max(1, p.sets + a.value);
            if (a.kind === "add-sets") p.sets += a.value;
            if (a.kind === "rpe" && p.targetRpe != null) p.targetRpe = Math.min(9.5, Math.max(5, p.targetRpe + a.value));
        }
        return { ...ex, prescription: p, adjustments: [...mine, ...global] };
    });
}

// ---------- Supabase sync ----------

async function fetchWorkouts(userId: string, sinceIso: string): Promise<LoggedWorkout[]> {
    const { data, error } = await supabase
        .from("workouts")
        .select("id, start_time, end_time, sets(exercise_id, weight_kg, reps, rpe, set_type)")
        .eq("user_id", userId)
        .gte("start_time", sinceIso)
        .order("start_time", { ascending: true });
    if (error) throw error;
    return (data ?? []).map((w) => ({
        ...w,
        sets: (w.sets ?? []).map((s: LoggedSet) => ({ ...s, weight_kg: Number(s.weight_kg), reps: Number(s.reps) })),
    })) as LoggedWorkout[];
}

export interface ProgramStatus {
    position: ProgramPosition;
    logs: SessionLog[];
    recovery: RecoveryState;
    lastMatch?: ReturnType<typeof matchWorkoutToSession>;
    adjustments: Adjustment[];
    nextExercises: ReturnType<typeof applyAdjustments>;
}

/** Matches new workouts to the plan, stores logs, and returns the adapted next session. */
export async function syncProgramProgress(program: CustomProgram, now = new Date()): Promise<ProgramStatus> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !program.id) throw new Error("No active program.");

    const activatedAt = program.activatedAt ?? new Date(0).toISOString();
    const historyStart = new Date(Math.min(new Date(activatedAt).getTime(), now.getTime() - 84 * 86_400_000)).toISOString();

    const [{ data: logRows, error: logError }, { data: exerciseRows, error: exError }, history] = await Promise.all([
        supabase.from("program_session_logs").select("*").eq("program_id", program.id).order("created_at"),
        supabase.from("exercises").select("id, name, muscle_group").eq("user_id", user.id),
        fetchWorkouts(user.id, historyStart),
    ]);
    if (logError) throw logError;
    if (exError) throw exError;

    const exercises = new Map((exerciseRows ?? []).map((e) => [e.id, e as ExerciseInfo]));
    const e1rm = buildE1rmIndex(history);
    const logs: SessionLog[] = (logRows ?? []).map((row) => fromSessionLogRow(row as SessionLogRow));
    const logged = new Set(logs.map((l) => l.workout_id));
    let lastMatch: ReturnType<typeof matchWorkoutToSession> | undefined;

    const pending = history.filter((w) => w.start_time >= activatedAt && !logged.has(w.id));
    for (const workout of pending) {
        const at = new Date(workout.start_time);
        const pos = getProgramPosition(program, logs, at);
        const match = matchWorkoutToSession(workout, pos.session, exercises, e1rm);
        const counted = match.muscleCoverage >= COUNTED_COVERAGE_MIN;
        const priorRecovery = computeRecovery(history.filter((w) => new Date(w.start_time) < at), exercises, e1rm, at);
        const log: SessionLog = {
            workout_id: workout.id,
            week_index: pos.week,
            session_key: pos.session.key,
            phase: pos.phase,
            counted,
            muscle_coverage: Number(match.muscleCoverage.toFixed(3)),
            avg_rpe_delta: match.avgRpeDelta == null ? null : Number(match.avgRpeDelta.toFixed(2)),
            volume_ratio: Number(match.volumeRatio.toFixed(3)),
            adjustments: computeAdaptations(pos.session, pos.phase, logs, priorRecovery, lastMatch),
        };
        const { error } = await supabase.from("program_session_logs").insert({
            user_id: user.id,
            program_id: program.id,
            workout_id: log.workout_id,
            week_index: log.week_index,
            session_key: log.session_key,
            phase: log.phase,
            counted: log.counted,
            muscle_coverage: log.muscle_coverage,
            avg_rpe_delta: log.avg_rpe_delta,
            volume_ratio: log.volume_ratio,
            adjustments: log.adjustments,
        });
        if (error && error.code !== "23505") throw error; // ignore duplicate from concurrent sync
        // A duplicate means another sync already persisted this workout; keep it in
        // the in-memory sequence so the position returned by this sync is current.
        logs.push(log);
        if (counted) lastMatch = match;
    }

    if (!lastMatch) {
        // Recompute the latest counted match so adaptations have context after a reload.
        const lastLog = [...logs].reverse().find((l) => l.counted);
        const workout = lastLog && history.find((w) => w.id === lastLog.workout_id);
        const planned = lastLog && getProgramWeeks(program)[lastLog.week_index - 1]?.sessions.find((s) => s.key === lastLog.session_key);
        if (workout && planned) lastMatch = matchWorkoutToSession(workout, planned, exercises, e1rm);
    }

    const position = getProgramPosition(program, logs, now);
    const recovery = computeRecovery(history, exercises, e1rm, now);
    const adjustments = computeAdaptations(position.session, position.phase, logs, recovery, lastMatch);
    return { position, logs, recovery, lastMatch, adjustments, nextExercises: applyAdjustments(position.session, adjustments) };
}

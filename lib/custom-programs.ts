// NOTE: app/app/program-guide.tsx describes this generator to users. It documents what is implemented
// here, not a spec — when you change the logic below, update that page to match.
import { supabase } from "./supabase";
import { TrainingExerciseTarget, TrainingSession, TrainingSessionKey, TRAINING_PROGRAMS } from "./training-program";

export type CustomGoal = "strength" | "hypertrophy" | "fitness" | "conditioning";
export type CustomScheduleMode = "rolling" | "calendar";
export type CustomStyle = "heavy" | "moderate" | "high-rep" | "mixed";
export type BlockLength = 4 | 6 | 8;

export interface CustomPrescription {
    sets: number;
    reps: string;
    loadPercent?: number;
    targetRpe?: number;
    rir?: number;
    restSeconds: number;
    setType: "normal" | "warmup" | "failure" | "dropset";
    notes: string;
}

export interface CustomExercise extends TrainingExerciseTarget {
    prescription: CustomPrescription;
}

export interface CustomSession extends Omit<TrainingSession, "exercises"> {
    exercises: CustomExercise[];
}

export type WeekPhase = "build" | "deload";

export interface CustomWeek {
    week: number;
    phase: WeekPhase;
    sessions: CustomSession[];
}

export interface CustomProgramDefinition {
    /** Week 1 sessions — kept for backwards compatibility with rows saved before `weeks` existed. */
    sessions: CustomSession[];
    weeks?: CustomWeek[];
    priorities: string[];
    equipment: string[];
    avoidedExercises: string[];
    style: CustomStyle;
    variety: "repeat" | "variation";
    deloadOptional: boolean;
    includeDeload?: boolean;
    sessionMinutes?: number;
}

export interface CustomProgram {
    id?: string;
    name: string;
    goal: CustomGoal;
    scheduleMode: CustomScheduleMode;
    sessionsPerWeek: number;
    blockLengthWeeks: BlockLength;
    progressionStyle: "hybrid";
    definition: CustomProgramDefinition;
    isActive?: boolean;
    activatedAt?: string | null;
}

const defaultRestSeconds = (target: TrainingExerciseTarget) =>
    target.movementPattern === "squat" || target.group === "Deadlift" ? 180 : target.optional ? 60 : 90;

const BASE_RPE: Record<CustomStyle, number> = { heavy: 7, moderate: 7.5, "high-rep": 8, mixed: 7.5 };

function toCustomSession(session: TrainingSession, style: CustomStyle): CustomSession {
    return {
        ...session,
        exercises: session.exercises.map((exercise) => ({
            ...exercise,
            prescription: {
                sets: exercise.sets,
                reps: exercise.reps,
                loadPercent: exercise.movementPattern || exercise.group === "Deadlift" ? 70 : undefined,
                targetRpe: BASE_RPE[style],
                rir: style === "high-rep" ? 1 : 2,
                restSeconds: defaultRestSeconds(exercise),
                setType: "normal",
                notes: exercise.optional ? "Optional accessory" : "",
            },
        })),
    };
}

/** Explicit goal × frequency → template key. */
const TEMPLATE_TABLE: Record<CustomGoal, Record<2 | 3 | 4 | 5, string>> = {
    strength: { 2: "fitness-2", 3: "strength-full-body-3", 4: "upper-lower-4", 5: "powerbuilding-5" },
    hypertrophy: { 2: "fitness-2", 3: "push-pull-legs-3", 4: "hypertrophy-upper-lower-4", 5: "powerbuilding-5" },
    fitness: { 2: "fitness-2", 3: "strength-full-body-3", 4: "upper-lower-4", 5: "hypertrophy-upper-lower-4" },
    conditioning: { 2: "fitness-2", 3: "strength-full-body-3", 4: "upper-lower-4", 5: "hypertrophy-upper-lower-4" },
};

function pickTemplate(goal: CustomGoal, sessionsPerWeek: number): TrainingSession[] {
    const days = Math.min(5, Math.max(2, Math.round(sessionsPerWeek))) as 2 | 3 | 4 | 5;
    const source = TRAINING_PROGRAMS.find((program) => program.key === TEMPLATE_TABLE[goal][days]);
    if (!source) throw new Error("No matching program template is available.");
    // A 4-session template used for a 5-day plan: repeat the first session so session count matches.
    const sessions = [...source.sessions];
    const keys: TrainingSessionKey[] = ["A", "B", "C", "D", "E"];
    while (sessions.length < days) {
        const copy = sessions[sessions.length % source.sessions.length];
        sessions.push({ ...copy, key: keys[sessions.length], title: `Day ${keys[sessions.length]}` });
    }
    return sessions.slice(0, days);
}

function trimToDuration(session: CustomSession, minutes: number): CustomSession {
    const estimate = session.estimatedMinutes ?? session.exercises.length * 9;
    if (estimate <= minutes) return session;
    const perExercise = estimate / Math.max(1, session.exercises.length);
    let over = estimate - minutes;
    const exercises = [...session.exercises];
    for (let i = exercises.length - 1; i >= 0 && over > 0; i--) {
        if (exercises[i].optional) {
            exercises.splice(i, 1);
            over -= perExercise;
        }
    }
    return { ...session, exercises, estimatedMinutes: Math.round(Math.max(minutes, estimate - (estimate - minutes - Math.max(0, over)))) };
}

function applyVariation(exercise: CustomExercise, week: number): CustomExercise {
    if (week % 2 === 1 || exercise.aliases.length < 2) return exercise;
    // Even weeks: put the next alias first so matching/labels prefer the variant.
    const [first, ...rest] = exercise.aliases;
    return { ...exercise, aliases: [...rest, first], prescription: { ...exercise.prescription, notes: [exercise.prescription.notes, `Variation: ${rest[0]}`].filter(Boolean).join(" · ") } };
}

function buildWeek(base: CustomSession[], week: number, phase: WeekPhase, variety: "repeat" | "variation"): CustomWeek {
    return {
        week,
        phase,
        sessions: base.map((session) => ({
            ...session,
            exercises: session.exercises
                .filter((exercise) => phase === "build" || !exercise.optional)
                .map((exercise) => {
                    const varied = variety === "variation" ? applyVariation(exercise, week) : exercise;
                    const p = varied.prescription;
                    if (phase === "deload") {
                        return {
                            ...varied,
                            prescription: {
                                ...p,
                                sets: Math.max(1, Math.round(p.sets * 0.6)),
                                loadPercent: p.loadPercent ? 60 : undefined,
                                targetRpe: 6,
                                rir: 4,
                                notes: [p.notes, "Deload"].filter(Boolean).join(" · "),
                            },
                        };
                    }
                    const targetRpe = Math.min(9, (p.targetRpe ?? 7.5) + 0.5 * (week - 1));
                    return {
                        ...varied,
                        prescription: { ...p, targetRpe, rir: Math.max(0, Math.round(10 - targetRpe)) },
                    };
                }),
        })),
    };
}

export function generateCustomProgram(input: {
    name: string;
    goal: CustomGoal;
    sessionsPerWeek: number;
    scheduleMode: CustomScheduleMode;
    blockLengthWeeks: BlockLength;
    priorities: string[];
    equipment: string[];
    avoidedExercises: string[];
    style: CustomStyle;
    variety: "repeat" | "variation";
    includeDeload?: boolean;
    sessionMinutes?: number;
}): CustomProgram {
    const includeDeload = input.includeDeload ?? true;
    const sessionsPerWeek = Math.min(5, Math.max(2, Math.round(input.sessionsPerWeek)));
    const base = pickTemplate(input.goal, sessionsPerWeek)
        .map((session) => toCustomSession(session, input.style))
        .map((session) => (input.sessionMinutes ? trimToDuration(session, input.sessionMinutes) : session));

    const weeks: CustomWeek[] = Array.from({ length: input.blockLengthWeeks }, (_, i) => {
        const week = i + 1;
        const phase: WeekPhase = includeDeload && week === input.blockLengthWeeks ? "deload" : "build";
        return buildWeek(base, week, phase, input.variety);
    });

    return {
        name: input.name.trim() || `${input.goal[0].toUpperCase()}${input.goal.slice(1)} ${sessionsPerWeek}-day plan`,
        goal: input.goal,
        scheduleMode: input.scheduleMode,
        sessionsPerWeek,
        blockLengthWeeks: input.blockLengthWeeks,
        progressionStyle: "hybrid",
        definition: {
            sessions: weeks[0].sessions,
            weeks,
            priorities: input.priorities,
            equipment: input.equipment,
            avoidedExercises: input.avoidedExercises,
            style: input.style,
            variety: input.variety,
            deloadOptional: includeDeload,
            includeDeload,
            sessionMinutes: input.sessionMinutes,
        },
    };
}

/** Returns the weeks of a program, synthesising them for legacy rows that only stored `sessions`. */
export function getProgramWeeks(program: CustomProgram): CustomWeek[] {
    const def = program.definition;
    if (def.weeks?.length) return def.weeks;
    return Array.from({ length: program.blockLengthWeeks }, (_, i) =>
        buildWeek(def.sessions, i + 1, def.deloadOptional && i + 1 === program.blockLengthWeeks ? "deload" : "build", def.variety ?? "repeat"));
}

type ProgramRow = {
    id: string; name: string; goal: CustomGoal; schedule_mode: CustomScheduleMode; sessions_per_week: number;
    block_length_weeks: BlockLength; progression_style: "hybrid"; definition: CustomProgramDefinition;
    is_active: boolean; activated_at?: string | null;
};

const PROGRAM_COLUMNS = "id, name, goal, schedule_mode, sessions_per_week, block_length_weeks, progression_style, definition, is_active, activated_at";

function fromRow(data: ProgramRow): CustomProgram {
    return {
        id: data.id,
        name: data.name,
        goal: data.goal,
        scheduleMode: data.schedule_mode,
        sessionsPerWeek: data.sessions_per_week,
        blockLengthWeeks: data.block_length_weeks,
        progressionStyle: data.progression_style,
        definition: data.definition,
        isActive: data.is_active,
        activatedAt: data.activated_at ?? null,
    };
}

export async function loadActiveCustomProgram(): Promise<CustomProgram | null> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data, error } = await supabase
        .from("training_programs")
        .select(PROGRAM_COLUMNS)
        .eq("user_id", user.id)
        .eq("is_active", true)
        .maybeSingle();
    if (error) throw error;
    return data ? fromRow(data as ProgramRow) : null;
}
export async function saveCustomProgram(program: CustomProgram, activate = true): Promise<CustomProgram> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Your session has expired. Please sign in again.");

    const { data, error } = await supabase
        .from("training_programs")
        .insert({
            user_id: user.id,
            name: program.name,
            goal: program.goal,
            schedule_mode: program.scheduleMode,
            sessions_per_week: program.sessionsPerWeek,
            block_length_weeks: program.blockLengthWeeks,
            progression_style: program.progressionStyle,
            definition: program.definition,
            is_active: false,
        })
        .select("id, name, goal, schedule_mode, sessions_per_week, block_length_weeks, progression_style, definition, is_active")
        .single();

    if (error || !data) throw error ?? new Error("The custom program could not be saved.");

    if (activate) {
        const { error: activationError } = await supabase.rpc("activate_training_program", { program_id: data.id });
        if (activationError) throw activationError;
        const { data: refreshed } = await supabase.from("training_programs").select(PROGRAM_COLUMNS).eq("id", data.id).single();
        if (refreshed) return fromRow(refreshed as ProgramRow);
    }

    return { ...fromRow({ ...(data as ProgramRow), activated_at: null }), isActive: activate };
}



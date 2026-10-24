import { supabase } from "./supabase";
import { TrainingExerciseTarget, TrainingSession, TRAINING_PROGRAMS } from "./training-program";

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

export interface CustomProgramDefinition {
    sessions: CustomSession[];
    priorities: string[];
    equipment: string[];
    avoidedExercises: string[];
    style: CustomStyle;
    variety: "repeat" | "variation";
    deloadOptional: boolean;
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
}

const defaultRestSeconds = (target: TrainingExerciseTarget) =>
    target.movementPattern === "squat" || target.group === "Deadlift" ? 180 : target.optional ? 60 : 90;

function toCustomSession(session: TrainingSession, style: CustomStyle): CustomSession {
    return {
        ...session,
        exercises: session.exercises.map((exercise) => ({
            ...exercise,
            prescription: {
                sets: exercise.sets,
                reps: exercise.reps,
                loadPercent: exercise.movementPattern || exercise.group === "Deadlift" ? 70 : undefined,
                targetRpe: style === "heavy" ? 7 : style === "high-rep" ? 8 : 7.5,
                rir: style === "high-rep" ? 1 : 2,
                restSeconds: defaultRestSeconds(exercise),
                setType: "normal",
                notes: exercise.optional ? "Optional accessory" : "",
            },
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
}): CustomProgram {
    const source = input.sessionsPerWeek <= 2
        ? TRAINING_PROGRAMS.find((program) => program.key === "fitness-2")
        : input.sessionsPerWeek === 3
            ? TRAINING_PROGRAMS.find((program) => program.key === (input.goal === "strength" ? "strength-full-body-3" : "push-pull-legs-3"))
            : input.sessionsPerWeek === 4
                ? TRAINING_PROGRAMS.find((program) => program.key === (input.goal === "hypertrophy" ? "hypertrophy-upper-lower-4" : "upper-lower-4"))
                : TRAINING_PROGRAMS.find((program) => program.key === "powerbuilding-5");

    if (!source) throw new Error("No matching program template is available.");

    return {
        name: input.name.trim() || `${input.goal[0].toUpperCase()}${input.goal.slice(1)} ${input.sessionsPerWeek}-day plan`,
        goal: input.goal,
        scheduleMode: input.scheduleMode,
        sessionsPerWeek: input.sessionsPerWeek,
        blockLengthWeeks: input.blockLengthWeeks,
        progressionStyle: "hybrid",
        definition: {
            sessions: source.sessions.map((session) => toCustomSession(session, input.style)),
            priorities: input.priorities,
            equipment: input.equipment,
            avoidedExercises: input.avoidedExercises,
            style: input.style,
            variety: input.variety,
            deloadOptional: true,
        },
    };
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
    }

    return {
        id: data.id,
        name: data.name,
        goal: data.goal,
        scheduleMode: data.schedule_mode,
        sessionsPerWeek: data.sessions_per_week,
        blockLengthWeeks: data.block_length_weeks,
        progressionStyle: data.progression_style,
        definition: data.definition,
        isActive: activate,
    };
}

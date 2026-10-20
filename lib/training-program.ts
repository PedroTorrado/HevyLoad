export type TrainingSessionKey = "A" | "B" | "C" | "D";

export interface TrainingExerciseTarget {
    key: string;
    group: string;
    aliases: string[];
    sets: number;
    reps: string;
}

export interface TrainingSession {
    key: TrainingSessionKey;
    title: string;
    focus: string;
    exercises: TrainingExerciseTarget[];
}

export const TRAINING_PROGRAM: TrainingSession[] = [
    {
        key: "A",
        title: "Day A",
        focus: "Squat + Chest Push",
        exercises: [
            { key: "squat", group: "Squat", aliases: ["squat", "leg press"], sets: 4, reps: "4" },
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "5" },
            { key: "secondary-chest", group: "Chest", aliases: ["feet-up bench", "spoto", "close-grip bench", "chest press", "incline bench"], sets: 3, reps: "6–8" },
            { key: "row", group: "Back", aliases: ["cable row", "seated row", "chest-supported row"], sets: 3, reps: "10" },
            { key: "pecs", group: "Chest", aliases: ["pec deck", "butterfly", "chest fly", "cable fly"], sets: 1, reps: "15" },
            { key: "shoulder-health", group: "Shoulders", aliases: ["face pull", "rear delt"], sets: 2, reps: "15–20" },
            { key: "triceps", group: "Triceps", aliases: ["tricep", "pushdown", "skull crusher"], sets: 2, reps: "15" },
        ],
    },
    {
        key: "B",
        title: "Day B",
        focus: "Hinge + Back Pull",
        exercises: [
            { key: "deadlift", group: "Deadlift", aliases: ["deadlift", "trap bar"], sets: 4, reps: "3" },
            { key: "row", group: "Back", aliases: ["bent-over row", "barbell row", "cable row", "chest-supported row"], sets: 4, reps: "6" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull-up", "pullup", "chin-up"], sets: 3, reps: "10–12" },
            { key: "hinge", group: "Hamstrings", aliases: ["romanian deadlift", "rdl", "good morning"], sets: 3, reps: "8" },
            { key: "shoulder-health", group: "Shoulders", aliases: ["face pull", "rear delt"], sets: 3, reps: "15–20" },
            { key: "biceps", group: "Biceps", aliases: ["bicep", "curl"], sets: 3, reps: "10–12" },
        ],
    },
    {
        key: "C",
        title: "Day C",
        focus: "Bench Priority + Upper",
        exercises: [
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "3–5" },
            { key: "shoulder-press", group: "Shoulders", aliases: ["overhead press", "military press", "shoulder press", "incline bench"], sets: 3, reps: "6–8" },
            { key: "chest-row", group: "Back", aliases: ["chest-supported row", "cable row", "seated row"], sets: 3, reps: "8–10" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull-up", "pullup", "chin-up"], sets: 3, reps: "10–12" },
            { key: "lateral-raise", group: "Shoulders", aliases: ["lateral raise", "side raise", "rear delt"], sets: 2, reps: "15–20" },
            { key: "shoulder-health", group: "Shoulders", aliases: ["face pull"], sets: 2, reps: "15–20" },
            { key: "triceps", group: "Triceps", aliases: ["tricep", "pushdown", "skull crusher"], sets: 2, reps: "12–15" },
        ],
    },
    {
        key: "D",
        title: "Day D",
        focus: "Lower Hypertrophy",
        exercises: [
            { key: "quad", group: "Quadriceps", aliases: ["front squat", "squat", "leg press", "hack squat"], sets: 3, reps: "8–10" },
            { key: "posterior", group: "Hamstrings", aliases: ["romanian deadlift", "rdl", "leg curl", "hamstring"], sets: 3, reps: "8–12" },
            { key: "unilateral", group: "Legs", aliases: ["split squat", "bulgarian", "lunge"], sets: 3, reps: "8–10" },
            { key: "leg-extension", group: "Quadriceps", aliases: ["leg extension", "quad extension"], sets: 2, reps: "12–15" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 3, reps: "12–15" },
        ],
    },
];

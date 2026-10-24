export type TrainingSessionKey = "A" | "B" | "C" | "D" | "E";

export type TrainingScheduleMode = "rolling" | "calendar" | "one-off";

export type TrainingSetType = "normal" | "warmup" | "failure" | "dropset";

export interface TrainingExerciseTarget {
    key: string;
    group: string;
    aliases: string[];
    sets: number;
    reps: string;
    movementPattern?: string;
    substitutionGroup?: string;
    optional?: boolean;
}

export interface TrainingSession {
    key: TrainingSessionKey;
    title: string;
    focus: string;
    exercises: TrainingExerciseTarget[];
    estimatedMinutes?: number;
    coreMinutes?: number;
    flushMinutes?: number;
}

export interface TrainingProgram {
    key: string;
    title: string;
    purpose: string;
    description: string;
    frequency: string;
    sessions: TrainingSession[];
}

export const TRAINING_PROGRAM: TrainingSession[] = [
    {
        key: "A",
        title: "Day A",
        focus: "Squat + Chest Push",
        estimatedMinutes: 55,
        coreMinutes: 42,
        flushMinutes: 13,
        exercises: [
            { key: "squat", group: "Squat", aliases: ["squat", "leg press"], sets: 4, reps: "4", movementPattern: "squat", substitutionGroup: "knee-dominant" },
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "5", movementPattern: "horizontal-press", substitutionGroup: "horizontal-press" },
            { key: "secondary-chest", group: "Chest", aliases: ["feet-up bench", "spoto", "close-grip bench", "chest press", "incline bench"], sets: 3, reps: "6–8", movementPattern: "horizontal-press", substitutionGroup: "horizontal-press" },
            { key: "row", group: "Back", aliases: ["cable row", "seated row", "chest-supported row"], sets: 3, reps: "10", movementPattern: "horizontal-pull", substitutionGroup: "horizontal-pull" },
            { key: "pecs", group: "Chest", aliases: ["pec deck", "butterfly", "chest fly", "cable fly"], sets: 1, reps: "15", movementPattern: "horizontal-press", substitutionGroup: "chest-isolation", optional: true },
            { key: "shoulder-health", group: "Shoulders", aliases: ["face pull", "rear delt"], sets: 2, reps: "15–20", movementPattern: "shoulder-health", substitutionGroup: "shoulder-health" },
            { key: "triceps", group: "Triceps", aliases: ["tricep", "pushdown", "skull crusher"], sets: 2, reps: "15", movementPattern: "triceps", substitutionGroup: "triceps", optional: true },
        ],
    },
    {
        key: "B",
        title: "Day B",
        focus: "Hinge + Back Pull",
        estimatedMinutes: 55,
        coreMinutes: 43,
        flushMinutes: 12,
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
        estimatedMinutes: 55,
        coreMinutes: 42,
        flushMinutes: 13,
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
        estimatedMinutes: 50,
        coreMinutes: 40,
        flushMinutes: 10,
        exercises: [
            { key: "quad", group: "Quadriceps", aliases: ["front squat", "squat", "leg press", "hack squat"], sets: 3, reps: "8–10" },
            { key: "posterior", group: "Hamstrings", aliases: ["romanian deadlift", "rdl", "leg curl", "hamstring"], sets: 3, reps: "8–12" },
            { key: "unilateral", group: "Legs", aliases: ["split squat", "bulgarian", "lunge"], sets: 3, reps: "8–10" },
            { key: "leg-extension", group: "Quadriceps", aliases: ["leg extension", "quad extension"], sets: 2, reps: "12–15" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 3, reps: "12–15" },
        ],
    },
];

const POWERBUILDING_5_DAY: TrainingSession[] = [
    {
        key: "A",
        title: "Day 1",
        focus: "Secondary squat + bench volume",
        estimatedMinutes: 55,
        exercises: [
            { key: "pause-squat", group: "Squat", aliases: ["pause squat", "squat"], sets: 4, reps: "5–6", movementPattern: "squat" },
            { key: "bench-volume", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "5–6", movementPattern: "horizontal-press" },
            { key: "incline", group: "Chest", aliases: ["incline bench", "incline press"], sets: 3, reps: "8–10" },
            { key: "row", group: "Back", aliases: ["row", "cable row", "dumbbell row"], sets: 3, reps: "8–12" },
            { key: "triceps", group: "Triceps", aliases: ["tricep", "pushdown", "triceps extension"], sets: 3, reps: "10–15", optional: true },
        ],
    },
    {
        key: "B",
        title: "Day 2",
        focus: "Secondary deadlift + back",
        estimatedMinutes: 50,
        exercises: [
            { key: "deadlift-volume", group: "Deadlift", aliases: ["deadlift", "romanian deadlift", "rdl"], sets: 3, reps: "4–6" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up", "pullup"], sets: 4, reps: "8–12" },
            { key: "row", group: "Back", aliases: ["row", "cable row", "dumbbell row"], sets: 3, reps: "8–12" },
            { key: "leg-curl", group: "Hamstrings", aliases: ["leg curl", "hamstring"], sets: 3, reps: "10–15" },
            { key: "biceps", group: "Biceps", aliases: ["bicep", "curl"], sets: 3, reps: "10–15", optional: true },
        ],
    },
    {
        key: "C",
        title: "Day 3",
        focus: "Primary squat + bench technique",
        estimatedMinutes: 55,
        exercises: [
            { key: "squat", group: "Squat", aliases: ["squat", "leg press"], sets: 4, reps: "3–5", movementPattern: "squat" },
            { key: "bench-technique", group: "Chest", aliases: ["bench press", "bench"], sets: 3, reps: "3–5", movementPattern: "horizontal-press" },
            { key: "leg-press", group: "Quadriceps", aliases: ["leg press", "squat"], sets: 3, reps: "8–12" },
            { key: "lateral-raise", group: "Shoulders", aliases: ["lateral raise", "side raise"], sets: 3, reps: "12–20" },
            { key: "shoulder-health", group: "Shoulders", aliases: ["face pull", "rear delt"], sets: 2, reps: "15–20", optional: true },
        ],
    },
    {
        key: "D",
        title: "Day 4",
        focus: "Primary bench + deadlift",
        estimatedMinutes: 60,
        exercises: [
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "3–5", movementPattern: "horizontal-press" },
            { key: "deadlift", group: "Deadlift", aliases: ["deadlift"], sets: 3, reps: "3–5" },
            { key: "chest-supported-row", group: "Back", aliases: ["chest-supported row", "cable row", "row"], sets: 3, reps: "8–12" },
            { key: "incline", group: "Chest", aliases: ["incline bench", "incline press"], sets: 3, reps: "8–12" },
            { key: "triceps", group: "Triceps", aliases: ["tricep", "pushdown"], sets: 3, reps: "10–15", optional: true },
        ],
    },
    {
        key: "E",
        title: "Day 5",
        focus: "Hypertrophy + upper accessories",
        estimatedMinutes: 50,
        exercises: [
            { key: "bench-accessory", group: "Chest", aliases: ["bench press", "chest press", "cable fly", "pec deck"], sets: 3, reps: "8–12" },
            { key: "shoulders", group: "Shoulders", aliases: ["shoulder press", "lateral raise"], sets: 3, reps: "10–15" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 3, reps: "10–15" },
            { key: "arms", group: "Arms", aliases: ["bicep", "curl", "tricep", "pushdown"], sets: 3, reps: "10–15" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 3, reps: "12–20", optional: true },
        ],
    },
];

const PUSH_PULL_LEGS_3_DAY: TrainingSession[] = [
    {
        key: "A",
        title: "Push",
        focus: "Chest, shoulders + triceps",
        estimatedMinutes: 55,
        exercises: [
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "5–8" },
            { key: "incline", group: "Chest", aliases: ["incline bench", "chest press"], sets: 3, reps: "8–12" },
            { key: "shoulder-press", group: "Shoulders", aliases: ["shoulder press", "overhead press"], sets: 3, reps: "6–10" },
            { key: "lateral-raise", group: "Shoulders", aliases: ["lateral raise", "side raise"], sets: 3, reps: "12–20" },
            { key: "triceps", group: "Triceps", aliases: ["tricep", "pushdown"], sets: 3, reps: "10–15" },
        ],
    },
    {
        key: "B",
        title: "Pull",
        focus: "Back, rear delts + biceps",
        estimatedMinutes: 55,
        exercises: [
            { key: "deadlift", group: "Deadlift", aliases: ["deadlift", "romanian deadlift"], sets: 3, reps: "3–6" },
            { key: "row", group: "Back", aliases: ["row", "cable row", "dumbbell row"], sets: 4, reps: "6–10" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 4, reps: "8–12" },
            { key: "rear-delt", group: "Shoulders", aliases: ["face pull", "rear delt"], sets: 3, reps: "15–20" },
            { key: "biceps", group: "Biceps", aliases: ["bicep", "curl"], sets: 3, reps: "10–15" },
        ],
    },
    {
        key: "C",
        title: "Legs",
        focus: "Squat, hamstrings + calves",
        estimatedMinutes: 55,
        exercises: [
            { key: "squat", group: "Squat", aliases: ["squat", "leg press"], sets: 4, reps: "5–8" },
            { key: "leg-press", group: "Quadriceps", aliases: ["leg press", "leg extension"], sets: 3, reps: "8–12" },
            { key: "hinge", group: "Hamstrings", aliases: ["romanian deadlift", "rdl", "leg curl"], sets: 3, reps: "8–12" },
            { key: "leg-curl", group: "Hamstrings", aliases: ["leg curl", "hamstring"], sets: 3, reps: "10–15" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 4, reps: "12–20" },
        ],
    },
];

const FULL_BODY_STRENGTH_3_DAY: TrainingSession[] = [
    {
        key: "A",
        title: "Full body A",
        focus: "Squat strength + bench volume",
        estimatedMinutes: 55,
        exercises: [
            { key: "squat", group: "Squat", aliases: ["squat", "leg press"], sets: 4, reps: "3–5" },
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "5–8" },
            { key: "row", group: "Back", aliases: ["row", "cable row", "dumbbell row"], sets: 3, reps: "8–12" },
            { key: "leg-curl", group: "Hamstrings", aliases: ["leg curl", "hamstring"], sets: 2, reps: "10–15" },
        ],
    },
    {
        key: "B",
        title: "Full body B",
        focus: "Deadlift strength + overhead press",
        estimatedMinutes: 55,
        exercises: [
            { key: "deadlift", group: "Deadlift", aliases: ["deadlift"], sets: 3, reps: "3–5" },
            { key: "shoulder-press", group: "Shoulders", aliases: ["shoulder press", "overhead press"], sets: 3, reps: "5–8" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 3, reps: "8–12" },
            { key: "split-squat", group: "Legs", aliases: ["split squat", "lunge", "leg press"], sets: 3, reps: "8–12" },
        ],
    },
    {
        key: "C",
        title: "Full body C",
        focus: "Squat variation + bench intensity",
        estimatedMinutes: 55,
        exercises: [
            { key: "squat-variation", group: "Squat", aliases: ["squat", "leg press"], sets: 3, reps: "5–8" },
            { key: "bench-intensity", group: "Chest", aliases: ["bench press", "bench", "incline bench"], sets: 4, reps: "3–5" },
            { key: "row", group: "Back", aliases: ["row", "cable row", "dumbbell row"], sets: 3, reps: "8–12" },
            { key: "hinge", group: "Hamstrings", aliases: ["romanian deadlift", "rdl", "leg curl"], sets: 3, reps: "8–12" },
        ],
    },
];

const HYPERTROPHY_UPPER_LOWER_4_DAY: TrainingSession[] = [
    {
        key: "A",
        title: "Upper A",
        focus: "Chest and back volume",
        estimatedMinutes: 55,
        exercises: [
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "6–10" },
            { key: "row", group: "Back", aliases: ["row", "cable row"], sets: 4, reps: "8–12" },
            { key: "incline", group: "Chest", aliases: ["incline bench", "chest press"], sets: 3, reps: "8–12" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 3, reps: "10–15" },
            { key: "arms", group: "Arms", aliases: ["bicep", "curl", "tricep", "pushdown"], sets: 3, reps: "10–15" },
        ],
    },
    {
        key: "B",
        title: "Lower A",
        focus: "Quads and hamstrings",
        estimatedMinutes: 55,
        exercises: [
            { key: "squat", group: "Quadriceps", aliases: ["squat", "leg press"], sets: 4, reps: "6–10" },
            { key: "hinge", group: "Hamstrings", aliases: ["romanian deadlift", "rdl"], sets: 3, reps: "8–12" },
            { key: "leg-press", group: "Quadriceps", aliases: ["leg press", "leg extension"], sets: 3, reps: "10–15" },
            { key: "leg-curl", group: "Hamstrings", aliases: ["leg curl", "hamstring"], sets: 3, reps: "10–15" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 3, reps: "12–20" },
        ],
    },
    {
        key: "C",
        title: "Upper B",
        focus: "Shoulders, back and arms",
        estimatedMinutes: 55,
        exercises: [
            { key: "shoulder-press", group: "Shoulders", aliases: ["shoulder press", "overhead press"], sets: 4, reps: "6–10" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 4, reps: "8–12" },
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 3, reps: "8–12" },
            { key: "lateral-raise", group: "Shoulders", aliases: ["lateral raise", "side raise"], sets: 3, reps: "12–20" },
            { key: "arms", group: "Arms", aliases: ["bicep", "curl", "tricep", "pushdown"], sets: 3, reps: "10–15" },
        ],
    },
    {
        key: "D",
        title: "Lower B",
        focus: "Posterior chain and quads",
        estimatedMinutes: 55,
        exercises: [
            { key: "deadlift", group: "Deadlift", aliases: ["deadlift"], sets: 3, reps: "4–6" },
            { key: "leg-press", group: "Quadriceps", aliases: ["leg press", "hack squat"], sets: 4, reps: "8–12" },
            { key: "leg-curl", group: "Hamstrings", aliases: ["leg curl", "hamstring"], sets: 4, reps: "10–15" },
            { key: "unilateral", group: "Legs", aliases: ["split squat", "lunge"], sets: 3, reps: "10–12" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 3, reps: "12–20" },
        ],
    },
];

const STRENGTH_UPPER_LOWER_4_DAY: TrainingSession[] = [
    {
        key: "A",
        title: "Upper A",
        focus: "Bench volume + upper back",
        estimatedMinutes: 60,
        exercises: [
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "5–8", movementPattern: "horizontal-press" },
            { key: "row", group: "Back", aliases: ["row", "cable row", "dumbbell row"], sets: 4, reps: "6–10", movementPattern: "horizontal-pull" },
            { key: "incline", group: "Chest", aliases: ["incline bench", "chest press"], sets: 3, reps: "8–10" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 3, reps: "8–12" },
            { key: "triceps", group: "Triceps", aliases: ["tricep", "pushdown"], sets: 3, reps: "10–15", optional: true },
        ],
    },
    {
        key: "B",
        title: "Lower A",
        focus: "Squat strength + legs",
        estimatedMinutes: 60,
        exercises: [
            { key: "squat", group: "Squat", aliases: ["squat", "leg press"], sets: 4, reps: "3–5", movementPattern: "squat" },
            { key: "leg-press", group: "Quadriceps", aliases: ["leg press", "leg extension"], sets: 3, reps: "8–12" },
            { key: "hinge", group: "Hamstrings", aliases: ["romanian deadlift", "rdl"], sets: 3, reps: "8–10" },
            { key: "leg-curl", group: "Hamstrings", aliases: ["leg curl", "hamstring"], sets: 3, reps: "10–15" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 3, reps: "12–20", optional: true },
        ],
    },
    {
        key: "C",
        title: "Upper B",
        focus: "Bench intensity + shoulders",
        estimatedMinutes: 60,
        exercises: [
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 4, reps: "3–5", movementPattern: "horizontal-press" },
            { key: "shoulder-press", group: "Shoulders", aliases: ["shoulder press", "overhead press"], sets: 3, reps: "6–8" },
            { key: "chest-row", group: "Back", aliases: ["chest-supported row", "cable row", "row"], sets: 4, reps: "8–12" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 3, reps: "10–12" },
            { key: "lateral-raise", group: "Shoulders", aliases: ["lateral raise", "side raise"], sets: 3, reps: "12–20", optional: true },
        ],
    },
    {
        key: "D",
        title: "Lower B",
        focus: "Deadlift strength + posterior chain",
        estimatedMinutes: 60,
        exercises: [
            { key: "deadlift", group: "Deadlift", aliases: ["deadlift"], sets: 3, reps: "3–5" },
            { key: "pause-squat", group: "Squat", aliases: ["pause squat", "squat", "leg press"], sets: 3, reps: "5–8" },
            { key: "leg-curl", group: "Hamstrings", aliases: ["leg curl", "hamstring"], sets: 3, reps: "8–12" },
            { key: "unilateral", group: "Legs", aliases: ["split squat", "lunge"], sets: 3, reps: "8–12" },
            { key: "calves", group: "Calves", aliases: ["calf"], sets: 3, reps: "12–20", optional: true },
        ],
    },
];

const FITNESS_2_DAY: TrainingSession[] = [
    {
        key: "A",
        title: "Strength A",
        focus: "Squat, press, pull and core",
        estimatedMinutes: 40,
        exercises: [
            { key: "squat", group: "Legs", aliases: ["squat", "leg press"], sets: 3, reps: "6–10" },
            { key: "bench", group: "Chest", aliases: ["bench press", "bench"], sets: 3, reps: "6–10" },
            { key: "row", group: "Back", aliases: ["row", "cable row"], sets: 3, reps: "8–12" },
            { key: "core", group: "Core", aliases: ["crunch", "leg raise", "sit up"], sets: 2, reps: "10–15", optional: true },
        ],
    },
    {
        key: "B",
        title: "Strength B",
        focus: "Hinge, press, pull and single-leg work",
        estimatedMinutes: 40,
        exercises: [
            { key: "hinge", group: "Posterior chain", aliases: ["deadlift", "romanian deadlift", "rdl"], sets: 3, reps: "5–8" },
            { key: "shoulder-press", group: "Shoulders", aliases: ["shoulder press", "overhead press"], sets: 3, reps: "6–10" },
            { key: "pulldown", group: "Back", aliases: ["lat pulldown", "pull up"], sets: 3, reps: "8–12" },
            { key: "unilateral", group: "Legs", aliases: ["split squat", "lunge"], sets: 2, reps: "8–12" },
        ],
    },
];

export const TRAINING_PROGRAMS: TrainingProgram[] = [
    {
        key: "powerbuilding-5",
        title: "5-day powerbuilding",
        purpose: "Strength",
        description: "Your historical block style: frequent bench, squat and deadlift practice, then a dedicated accessories day.",
        frequency: "5 sessions · rolling order",
        sessions: POWERBUILDING_5_DAY,
    },
    {
        key: "upper-lower-4",
        title: "4-day upper / lower",
        purpose: "Balanced progress",
        description: "Alternates upper and lower sessions so the rolling cycle never puts two demanding lower days back-to-back.",
        frequency: "4 sessions · rolling order",
        sessions: STRENGTH_UPPER_LOWER_4_DAY,
    },
    {
        key: "push-pull-legs-3",
        title: "3-day push / pull / legs",
        purpose: "Simple rotation",
        description: "A simpler rotation for busy weeks without dropping the main lifts or accessories.",
        frequency: "3 sessions · rolling order",
        sessions: PUSH_PULL_LEGS_3_DAY,
    },
    {
        key: "strength-full-body-3",
        title: "3-day full-body strength",
        purpose: "Strength with limited days",
        description: "Practice the main lifts every session with enough recovery between workouts.",
        frequency: "3 sessions · non-consecutive days",
        sessions: FULL_BODY_STRENGTH_3_DAY,
    },
    {
        key: "hypertrophy-upper-lower-4",
        title: "4-day hypertrophy",
        purpose: "Muscle growth",
        description: "Train each major muscle twice weekly and distribute volume across shorter, higher-quality sessions.",
        frequency: "4 sessions · upper / lower",
        sessions: HYPERTROPHY_UPPER_LOWER_4_DAY,
    },
    {
        key: "fitness-2",
        title: "2-day general fitness",
        purpose: "Busy schedule",
        description: "Full-body sessions that cover the major movement patterns when time is limited.",
        frequency: "2 sessions · non-consecutive days",
        sessions: FITNESS_2_DAY,
    },
];

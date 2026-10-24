import { TrainingExerciseTarget } from "./training-program";

export interface TrainingPerformance {
    exercise_id: string;
    weight_kg: number;
    reps: number;
    start_time: string;
    set_type?: string | null;
    rpe?: number | null;
}

export interface EvidenceWindow {
    from: Date;
    to: Date;
    days: number;
}

export interface ExerciseEvidence {
    performance: TrainingPerformance;
    estimatedOneRepMax: number;
    recencyScore: number;
}

export function createEvidenceWindow(days = 84, now = new Date()): EvidenceWindow {
    const from = new Date(now);
    from.setDate(from.getDate() - days);
    return { from, to: now, days };
}

export function estimateOneRepMax(weight: number, reps: number): number {
    if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight <= 0 || reps <= 0 || reps > repLimit()) {
        return 0;
    }
    return reps === 1 ? weight : weight / (1.0278 - 0.0278 * reps);
}

function repLimit() {
    return 20;
}

function isUsablePerformance(performance: TrainingPerformance, window: EvidenceWindow): boolean {
    const date = new Date(performance.start_time);
    const setType = (performance.set_type ?? "normal").toLowerCase();
    return (
        date >= window.from &&
        date <= window.to &&
        performance.weight_kg > 0 &&
        performance.reps > 0 &&
        performance.reps <= repLimit() &&
        setType === "normal"
    );
}

export function getBestRecentEvidence(
    performances: TrainingPerformance[],
    exerciseId: string,
    window = createEvidenceWindow(),
): ExerciseEvidence | null {
    const candidates = performances
        .filter((performance) => performance.exercise_id === exerciseId && isUsablePerformance(performance, window))
        .map((performance) => {
            const ageDays = Math.max(0, (window.to.getTime() - new Date(performance.start_time).getTime()) / 86_400_000);
            return {
                performance,
                estimatedOneRepMax: estimateOneRepMax(performance.weight_kg, performance.reps),
                recencyScore: Math.max(0, 1 - ageDays / window.days),
            };
        })
        .filter((candidate) => candidate.estimatedOneRepMax > 0);

    return candidates.sort((a, b) => {
        const aScore = a.estimatedOneRepMax * (0.75 + a.recencyScore * 0.25);
        const bScore = b.estimatedOneRepMax * (0.75 + b.recencyScore * 0.25);
        return bScore - aScore;
    })[0] ?? null;
}

export function roundLoad(load: number, increment = 2.5): number | null {
    if (!Number.isFinite(load) || load <= 0 || !Number.isFinite(increment) || increment <= 0) {
        return null;
    }
    return Math.max(increment, Math.round(load / increment) * increment);
}

export function suggestedLoadFromEvidence(
    evidence: ExerciseEvidence | null,
    percentage = 0.7,
    increment = 2.5,
): number | null {
    if (!evidence || percentage <= 0 || percentage > 1) return null;
    return roundLoad(evidence.estimatedOneRepMax * percentage, increment);
}

export function matchesTrainingTarget(
    exerciseName: string,
    muscleGroup: string | null | undefined,
    target: TrainingExerciseTarget,
): boolean {
    const value = `${exerciseName} ${muscleGroup ?? ""}`.toLowerCase();
    return target.aliases.some((keyword) => value.includes(keyword.toLowerCase()));
}

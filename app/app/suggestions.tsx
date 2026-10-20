import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { TRAINING_PROGRAM, TrainingExerciseTarget } from "../../lib/training-program";

interface Exercise {
    id: string;
    name: string;
    muscle_group: string | null;
}

interface Performance {
    weight_kg: number;
    reps: number;
    exercise_id: string;
    start_time: string;
}

interface RawPerformance extends Omit<Performance, "start_time"> {
    workouts: { start_time: string } | { start_time: string }[];
}

function matchesTarget(exercise: Exercise, target: TrainingExerciseTarget) {
    const value = `${exercise.name} ${exercise.muscle_group ?? ""}`.toLowerCase();
    return target.aliases.some((keyword) => value.includes(keyword));
}

function estimateOneRepMax(weight: number, reps: number) {
    if (weight <= 0 || reps <= 0) return 0;
    return reps === 1 ? weight : weight / (1.0278 - 0.0278 * reps);
}

export default function Suggestions() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();
    const [sessionIndex, setSessionIndex] = useState(0);
    const [exercises, setExercises] = useState<Exercise[]>([]);
    const [performances, setPerformances] = useState<Performance[]>([]);
    const [bodyweight, setBodyweight] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function loadSuggestionData() {
            setLoading(true);
            setError(null);
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) {
                setError("Your session has expired. Please sign in again.");
                setLoading(false);
                return;
            }

            const [exerciseResult, performanceResult, profileResult] = await Promise.all([
                supabase.from("exercises").select("id, name, muscle_group").eq("user_id", user.id),
                supabase
                    .from("sets")
                    .select("weight_kg, reps, exercise_id, workouts!inner(user_id, start_time)")
                    .eq("workouts.user_id", user.id)
                    .limit(1000),
                supabase.from("profiles").select("bodyweight").eq("id", user.id).single(),
            ]);

            if (exerciseResult.error || performanceResult.error) {
                console.error("Suggestion data load error:", exerciseResult.error ?? performanceResult.error);
                setError("We could not load enough training history to build suggestions.");
            } else {
                setExercises(exerciseResult.data ?? []);
                setPerformances((performanceResult.data ?? []).map((performance: RawPerformance) => ({
                    weight_kg: Number(performance.weight_kg),
                    reps: Number(performance.reps),
                    exercise_id: performance.exercise_id,
                    start_time: Array.isArray(performance.workouts)
                        ? performance.workouts[0]?.start_time
                        : performance.workouts?.start_time,
                })).filter((performance) => Boolean(performance.start_time)));
            }
            if (!profileResult.error && profileResult.data?.bodyweight) {
                setBodyweight(Number(profileResult.data.bodyweight));
            }
            setLoading(false);
        }

        loadSuggestionData();
    }, []);

    const selectedSession = TRAINING_PROGRAM[sessionIndex % TRAINING_PROGRAM.length];
    const suggestions = useMemo(() => {
        const performanceByExercise = new Map<string, Performance>();
        performances
            .filter((performance) => Number(performance.weight_kg) > 0 && Number(performance.reps) > 0)
            .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime())
            .forEach((performance) => {
                const current = performanceByExercise.get(performance.exercise_id);
                const performanceScore = estimateOneRepMax(Number(performance.weight_kg), Number(performance.reps));
                const currentScore = current ? estimateOneRepMax(Number(current.weight_kg), Number(current.reps)) : 0;
                if (!current || performanceScore > currentScore) {
                    performanceByExercise.set(performance.exercise_id, performance);
                }
            });

        const usedExerciseIds = new Set<string>();
        return selectedSession.exercises.map((target) => {
            const candidates = exercises.filter((exercise) => !usedExerciseIds.has(exercise.id) && matchesTarget(exercise, target));
            const rankedCandidates = [...candidates].sort((a, b) => {
                const aPerformance = performanceByExercise.get(a.id);
                const bPerformance = performanceByExercise.get(b.id);
                if (aPerformance && bPerformance) {
                    return new Date(bPerformance.start_time).getTime() - new Date(aPerformance.start_time).getTime();
                }
                return Number(Boolean(bPerformance)) - Number(Boolean(aPerformance));
            });
            const exercise = rankedCandidates[0];
            if (exercise) usedExerciseIds.add(exercise.id);
            const performance = exercise ? performanceByExercise.get(exercise.id) : undefined;
            const oneRepMax = performance ? estimateOneRepMax(Number(performance.weight_kg), Number(performance.reps)) : 0;
            const load = oneRepMax ? Math.max(0, Math.round((oneRepMax * 0.70) / 2.5) * 2.5) : null;
            return { target, exercise, load };
        }).filter((suggestion): suggestion is { target: TrainingExerciseTarget; exercise: Exercise; load: number | null } => Boolean(suggestion.exercise));
    }, [exercises, performances, selectedSession]);

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
                <View style={styles.header}>
                    <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel={t("app.suggestions.go_back")}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </Pressable>
                    <View style={styles.headerCopy}>
                        <Text style={[styles.eyebrow, { color: colors.tint }]}>{t("app.suggestions.eyebrow")}</Text>
                        <Text style={[styles.title, { color: colors.text }]}>{t("app.suggestions.title")}</Text>
                        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{t("app.suggestions.subtitle")}</Text>
                    </View>
                </View>

                <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>{t("app.suggestions.choose_session")}</Text>
                <View style={styles.splitRow}>
                    {TRAINING_PROGRAM.map((item, index) => (
                        <Pressable
                            key={item.key}
                            onPress={() => setSessionIndex(index)}
                            style={[
                                styles.splitCard,
                                { backgroundColor: colors.card, borderColor: index === sessionIndex ? colors.tint : colors.border },
                            ]}
                        >
                            <Text style={[styles.splitName, { color: colors.text }]}>{item.title}</Text>
                            <Text style={[styles.splitDescription, { color: colors.secondaryText }]}>{item.focus}</Text>
                        </Pressable>
                    ))}
                </View>

                <View style={[styles.planHeader, { borderBottomColor: colors.border }]}>
                    <View>
                        <Text style={[styles.planTitle, { color: colors.text }]}>{selectedSession.title}: {selectedSession.focus}</Text>
                        <Text style={[styles.planSubtitle, { color: colors.secondaryText }]}>{t("app.suggestions.rolling_split")}</Text>
                    </View>
                    {bodyweight ? (
                        <View style={[styles.weightBadge, { backgroundColor: colors.tint + "18" }]}>
                            <Ionicons name="scale-outline" size={16} color={colors.tint} />
                            <Text style={[styles.weightBadgeText, { color: colors.tint }]}>{bodyweight} kg</Text>
                        </View>
                    ) : null}
                </View>

                {loading ? (
                    <ActivityIndicator style={styles.loader} color={colors.tint} />
                ) : error ? (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>{error}</Text>
                        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>{t("app.suggestions.import_error")}</Text>
                    </View>
                ) : suggestions.length > 0 ? suggestions.map((suggestion, index) => (
                    <View key={`${suggestion.target.key}-${suggestion.exercise.id}`} style={[styles.suggestionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={[styles.stepNumber, { backgroundColor: colors.tint }]}>
                            <Text style={styles.stepNumberText}>{index + 1}</Text>
                        </View>
                        <View style={styles.suggestionCopy}>
                            <Text style={[styles.groupName, { color: colors.secondaryText }]}>{suggestion.target.group.toUpperCase()}</Text>
                            <Text style={[styles.exerciseName, { color: colors.text }]}>
                                {suggestion.exercise?.name ?? t("app.suggestions.add_exercise")}
                            </Text>
                            <Text style={[styles.loadText, { color: colors.secondaryText }]}>
                                {suggestion.load ? `${suggestion.load} kg · ${suggestion.target.sets} × ${suggestion.target.reps}` : t("app.suggestions.no_previous_load")}
                            </Text>
                        </View>
                        <Ionicons name="sparkles-outline" size={20} color={colors.tint} />
                    </View>
                )) : (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>{t("app.suggestions.import_first")}</Text>
                        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>{t("app.suggestions.personalized")}</Text>
                    </View>
                )}

            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { width: "100%", maxWidth: 1120, alignSelf: "center", paddingHorizontal: 24 },
    header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 34 },
    backButton: { padding: 8, marginRight: 10, marginLeft: -8 },
    headerCopy: { flex: 1 },
    eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginBottom: 6 },
    title: { fontSize: 34, fontWeight: "900", letterSpacing: -1 },
    subtitle: { fontSize: 15, marginTop: 8, lineHeight: 22 },
    sectionLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
    splitRow: { flexDirection: "row", gap: 12, flexWrap: "wrap", marginBottom: 34 },
    splitCard: { flex: 1, minWidth: 210, padding: 18, borderRadius: 14, borderWidth: 1.5 },
    sessionRow: { flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: -18, marginBottom: 28 },
    sessionChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1 },
    splitName: { fontSize: 16, fontWeight: "800", marginBottom: 8 },
    splitDescription: { fontSize: 13, lineHeight: 19 },
    planHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 14, borderBottomWidth: 1, marginBottom: 14 },
    planTitle: { fontSize: 22, fontWeight: "900" },
    planSubtitle: { fontSize: 13, marginTop: 5 },
    weightBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20 },
    weightBadgeText: { fontSize: 12, fontWeight: "800" },
    loader: { marginTop: 48 },
    suggestionCard: { flexDirection: "row", alignItems: "center", padding: 18, borderRadius: 14, borderWidth: 1, marginBottom: 10 },
    stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginRight: 14 },
    stepNumberText: { color: "#FFF", fontSize: 13, fontWeight: "900" },
    suggestionCopy: { flex: 1 },
    groupName: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
    exerciseName: { fontSize: 17, fontWeight: "800" },
    loadText: { fontSize: 13, marginTop: 5 },
    emptyCard: { padding: 22, borderRadius: 14, borderWidth: 1, marginTop: 18 },
    emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 6 },
    emptyText: { fontSize: 14, lineHeight: 21 },
});

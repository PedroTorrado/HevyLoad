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
import { TRAINING_PROGRAMS, TrainingExerciseTarget } from "../../lib/training-program";
import {
    createEvidenceWindow,
    ExerciseEvidence,
    getBestRecentEvidence,
    matchesTrainingTarget,
    suggestedLoadFromEvidence,
    TrainingPerformance,
} from "../../lib/training-recommendations";

interface Exercise {
    id: string;
    name: string;
    muscle_group: string | null;
}

interface RawPerformance extends Omit<TrainingPerformance, "start_time"> {
    workouts: { start_time: string } | { start_time: string }[];
}

export default function Suggestions() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();
    const [programIndex, setProgramIndex] = useState(0);
    const [sessionIndex, setSessionIndex] = useState(0);
    const [exercises, setExercises] = useState<Exercise[]>([]);
    const [performances, setPerformances] = useState<TrainingPerformance[]>([]);
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

            const [exerciseResult] = await Promise.all([
                supabase.from("exercises").select("id, name, muscle_group").eq("user_id", user.id),
            ]);

            const pageSize = 1000;
            const performanceRows: RawPerformance[] = [];
            let performanceError: Error | null = null;
            for (let offset = 0; ; offset += pageSize) {
                const performanceResult = await supabase
                    .from("sets")
                    .select("weight_kg, reps, exercise_id, set_type, rpe, workouts!inner(user_id, start_time)")
                    .eq("workouts.user_id", user.id)
                    .range(offset, offset + pageSize - 1);

                if (performanceResult.error) {
                    performanceError = performanceResult.error;
                    break;
                }

                const rows = (performanceResult.data ?? []) as RawPerformance[];
                performanceRows.push(...rows);
                if (rows.length < pageSize) break;
            }

            if (exerciseResult.error || performanceError) {
                console.error("Suggestion data load error:", exerciseResult.error ?? performanceError);
                setError("We could not load enough training history to build suggestions.");
            } else {
                setExercises(exerciseResult.data ?? []);
                setPerformances(performanceRows.map((performance) => ({
                    weight_kg: Number(performance.weight_kg),
                    reps: Number(performance.reps),
                    exercise_id: performance.exercise_id,
                    set_type: performance.set_type,
                    rpe: performance.rpe,
                    start_time: Array.isArray(performance.workouts)
                        ? performance.workouts[0]?.start_time
                        : performance.workouts?.start_time,
                })).filter((performance) => Boolean(performance.start_time)));
            }
            setLoading(false);
        }

        loadSuggestionData();
    }, []);

    const selectedProgram = TRAINING_PROGRAMS[programIndex];
    const selectedSession = selectedProgram.sessions[sessionIndex % selectedProgram.sessions.length];
    const suggestions = useMemo(() => {
        const evidenceWindow = createEvidenceWindow();
        const historicalWindow = createEvidenceWindow(3650);
        const getEvidence = (exerciseId: string) =>
            getBestRecentEvidence(performances, exerciseId, evidenceWindow)
            ?? getBestRecentEvidence(performances, exerciseId, historicalWindow);
        const usedExerciseIds = new Set<string>();
        return selectedSession.exercises.map((target) => {
            const candidates = exercises.filter((exercise) => !usedExerciseIds.has(exercise.id) && matchesTrainingTarget(exercise.name, exercise.muscle_group, target));
            const rankedCandidates = [...candidates].sort((a, b) => {
                const aEvidence = getEvidence(a.id);
                const bEvidence = getEvidence(b.id);
                return (bEvidence?.recencyScore ?? 0) - (aEvidence?.recencyScore ?? 0);
            });
            const exercise = rankedCandidates[0];
            if (exercise) usedExerciseIds.add(exercise.id);
            const evidence = exercise ? getEvidence(exercise.id) : null;
            const load = suggestedLoadFromEvidence(evidence);
            return { target, exercise, load, evidence };
        }).filter((suggestion): suggestion is {
            target: TrainingExerciseTarget;
            exercise: Exercise;
            load: number | null;
            evidence: ExerciseEvidence | null;
        } => Boolean(suggestion.exercise));
    }, [exercises, performances, selectedSession]);
    const matchedCount = suggestions.length;
    const totalExercises = selectedSession.exercises.length;

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

                <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>Choose your program</Text>
                <Pressable
                    onPress={() => router.push("/app/custom-program")}
                    style={[styles.customProgramButton, { backgroundColor: colors.tint, borderColor: colors.tint }]}
                >
                    <Ionicons name="create-outline" size={18} color="#FFF" />
                    <View style={styles.customProgramButtonCopy}>
                        <Text style={styles.customProgramButtonTitle}>Build a custom program</Text>
                        <Text style={styles.customProgramButtonSubtitle}>Choose your goal, schedule and progression</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color="#FFF" />
                </Pressable>
                <View style={styles.programList}>
                    {TRAINING_PROGRAMS.map((item, index) => {
                        const isSelected = index === programIndex;
                        return (
                            <Pressable
                                key={item.key}
                                onPress={() => {
                                    setProgramIndex(index);
                                    setSessionIndex(0);
                                }}
                                style={[
                                    styles.programCard,
                                    {
                                        backgroundColor: isSelected ? colors.tint : colors.card,
                                        borderColor: isSelected ? colors.tint : colors.border,
                                    },
                                ]}
                            >
                                <View style={styles.programCardTop}>
                                    <View style={[styles.splitKey, { backgroundColor: isSelected ? "rgba(255,255,255,0.2)" : colors.secondary }]}>
                                        <Ionicons name={index === 0 ? "flame-outline" : index === 1 ? "grid-outline" : "calendar-outline"} size={15} color={isSelected ? "#FFF" : colors.tint} />
                                    </View>
                                    <Ionicons name={isSelected ? "checkmark-circle" : "ellipse-outline"} size={20} color={isSelected ? "#FFF" : colors.secondaryText} />
                                </View>
                                <Text style={[styles.splitName, { color: isSelected ? "#FFF" : colors.text }]}>{item.title}</Text>
                                <Text style={[styles.programPurpose, { color: isSelected ? "rgba(255,255,255,0.85)" : colors.tint }]}>{item.purpose}</Text>
                                <Text style={[styles.splitDescription, { color: isSelected ? "rgba(255,255,255,0.8)" : colors.secondaryText }]}>{item.frequency}</Text>
                            </Pressable>
                        );
                    })}
                </View>
                <Text style={[styles.programDescription, { color: colors.secondaryText }]}>{selectedProgram.description}</Text>

                <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>Choose a session</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sessionRow}>
                    {selectedProgram.sessions.map((session, index) => (
                        <Pressable
                            key={session.key}
                            onPress={() => setSessionIndex(index)}
                            style={[
                                styles.sessionChip,
                                {
                                    backgroundColor: index === sessionIndex ? colors.tint : colors.card,
                                    borderColor: index === sessionIndex ? colors.tint : colors.border,
                                },
                            ]}
                        >
                            <Text style={[styles.sessionChipKey, { color: index === sessionIndex ? "#FFF" : colors.tint }]}>{session.key}</Text>
                            <Text style={[styles.sessionChipText, { color: index === sessionIndex ? "#FFF" : colors.text }]}>{session.title.replace("Day ", "")}</Text>
                        </Pressable>
                    ))}
                </ScrollView>

                <View style={[styles.planCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.planHeader}>
                        <View style={styles.planHeaderCopy}>
                            <Text style={[styles.planTitle, { color: colors.text }]}>{selectedSession.title}</Text>
                            <Text style={[styles.planSubtitle, { color: colors.secondaryText }]}>{selectedSession.focus}</Text>
                        </View>
                        <View style={[styles.sessionBadge, { backgroundColor: colors.tint }]}>
                            <Text style={styles.sessionBadgeText}>{selectedSession.key}</Text>
                        </View>
                    </View>
                    <View style={[styles.planMeta, { borderTopColor: colors.border }]}>
                        <View style={styles.metaItem}>
                            <Ionicons name="time-outline" size={15} color={colors.secondaryText} />
                            <Text style={[styles.metaText, { color: colors.secondaryText }]}>~{selectedSession.estimatedMinutes ?? 55} min</Text>
                        </View>
                        <View style={styles.metaItem}>
                            <Ionicons name="barbell-outline" size={15} color={colors.secondaryText} />
                            <Text style={[styles.metaText, { color: colors.secondaryText }]}>{totalExercises} movements</Text>
                        </View>
                    </View>
                </View>

                {loading ? (
                    <ActivityIndicator style={styles.loader} color={colors.tint} />
                ) : error ? (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>{error}</Text>
                        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>{t("app.suggestions.import_error")}</Text>
                    </View>
                ) : suggestions.length > 0 ? (
                    <>
                                <View style={styles.workoutHeading}>
                            <View>
                                <Text style={[styles.workoutTitle, { color: colors.text }]}>Workout plan</Text>
                                <Text style={[styles.workoutSubtitle, { color: colors.secondaryText }]}>
                                    {matchedCount} of {totalExercises} movements matched to your history
                                </Text>
                            </View>
                                    <View style={[styles.matchBadge, { backgroundColor: colors.tint + "18" }]}>
                                        <Ionicons name="sparkles-outline" size={13} color={colors.tint} />
                                        <Text style={[styles.matchBadgeText, { color: colors.tint }]}>Personalized</Text>
                                    </View>
                                </View>
                                {suggestions.map((suggestion, index) => (
                                    <View
                                        key={`${suggestion.target.key}-${suggestion.exercise.id}`}
                                        style={[
                                            styles.suggestionCard,
                                            {
                                                backgroundColor: colors.card,
                                                borderColor: colors.border,
                                                borderLeftColor: colors.tint,
                                            },
                                        ]}
                                    >
                                        <View style={[styles.stepNumber, { backgroundColor: colors.tint + "18" }]}>
                                            <Text style={[styles.stepNumberText, { color: colors.tint }]}>{index + 1}</Text>
                                        </View>
                                        <View style={styles.suggestionCopy}>
                                            <Text style={[styles.groupName, { color: colors.secondaryText }]}>{suggestion.target.group.toUpperCase()}</Text>
                                    <Text style={[styles.exerciseName, { color: colors.text }]}>
                                        {suggestion.exercise?.name ?? t("app.suggestions.add_exercise")}
                                    </Text>
                                    <Text style={[styles.evidenceText, { color: colors.secondaryText }]}>
                                        {suggestion.evidence
                                            ? t("app.suggestions.evidence", { date: new Date(suggestion.evidence.performance.start_time).toLocaleDateString() })
                                            : t("app.suggestions.no_previous_load")}
                                    </Text>
                                </View>
                                <View style={[styles.prescription, { backgroundColor: suggestion.load ? colors.tint : colors.secondary }]}>
                                    <Text style={[styles.loadText, { color: suggestion.load ? "#FFF" : colors.secondaryText }]}>
                                        {suggestion.load ? `${suggestion.load}` : "—"}
                                    </Text>
                                    <Text style={[styles.loadUnit, { color: suggestion.load ? "rgba(255,255,255,0.8)" : colors.secondaryText }]}>kg</Text>
                                    <Text style={[styles.repsText, { color: suggestion.load ? "rgba(255,255,255,0.8)" : colors.secondaryText }]}>{suggestion.target.sets} × {suggestion.target.reps}</Text>
                                </View>
                            </View>
                        ))}
                    </>
                ) : (
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
    header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 24 },
    backButton: { padding: 8, marginRight: 10, marginLeft: -8 },
    headerCopy: { flex: 1 },
    eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.4, marginBottom: 6 },
    title: { fontSize: 34, fontWeight: "900", letterSpacing: -1 },
    subtitle: { fontSize: 15, marginTop: 8, lineHeight: 22 },
    sectionLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
    customProgramButton: { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 14 },
    customProgramButtonCopy: { flex: 1, marginHorizontal: 10 },
    customProgramButtonTitle: { color: "#FFF", fontSize: 14, fontWeight: "900" },
    customProgramButtonSubtitle: { color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 3 },
    programList: { gap: 8, marginBottom: 6 },
    programCard: { minHeight: 78, padding: 10, borderRadius: 12, borderWidth: 1.5 },
    programCardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
    programDescription: { fontSize: 12, lineHeight: 18, marginBottom: 18 },
    splitKey: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center", marginBottom: 6 },
    splitName: { fontSize: 14, fontWeight: "800", marginBottom: 3 },
    programPurpose: { fontSize: 10, fontWeight: "800", marginBottom: 2 },
    splitDescription: { fontSize: 11, lineHeight: 15 },
    sessionRow: { gap: 8, paddingBottom: 4, marginBottom: 24 },
    sessionChip: { flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 13, paddingVertical: 10, borderRadius: 20, borderWidth: 1 },
    sessionChipKey: { fontSize: 12, fontWeight: "900" },
    sessionChipText: { fontSize: 12, fontWeight: "700" },
    planCard: { padding: 16, borderRadius: 16, borderWidth: 1, marginBottom: 28 },
    planHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    planHeaderCopy: { flex: 1 },
    planTitle: { fontSize: 24, fontWeight: "900" },
    planSubtitle: { fontSize: 13, marginTop: 5 },
    sessionBadge: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", marginLeft: 12 },
    sessionBadgeText: { color: "#FFF", fontSize: 18, fontWeight: "900" },
    planMeta: { flexDirection: "row", alignItems: "center", gap: 14, flexWrap: "wrap", borderTopWidth: 1, marginTop: 16, paddingTop: 12 },
    metaItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    metaText: { fontSize: 11, fontWeight: "700" },
    loader: { marginTop: 48 },
    workoutHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
    workoutTitle: { fontSize: 20, fontWeight: "900" },
    workoutSubtitle: { fontSize: 12, marginTop: 3 },
    matchBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
    matchBadgeText: { fontSize: 10, fontWeight: "800" },
    suggestionCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4, marginBottom: 10 },
    stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginRight: 14 },
    stepNumberText: { fontSize: 13, fontWeight: "900" },
    suggestionCopy: { flex: 1 },
    groupName: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
    exerciseName: { fontSize: 17, fontWeight: "800" },
    loadText: { fontSize: 16, fontWeight: "900" },
    loadUnit: { fontSize: 9, fontWeight: "800", marginTop: -2 },
    repsText: { fontSize: 10, fontWeight: "700", marginTop: 3 },
    evidenceText: { fontSize: 11, marginTop: 5 },
    prescription: { minWidth: 68, alignItems: "center", paddingHorizontal: 7, paddingVertical: 8, borderRadius: 10, marginLeft: 8 },
    emptyCard: { padding: 22, borderRadius: 14, borderWidth: 1, marginTop: 18 },
    emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 6 },
    emptyText: { fontSize: 14, lineHeight: 21 },
});

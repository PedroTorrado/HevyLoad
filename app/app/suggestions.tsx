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
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { TrainingExerciseTarget, TrainingProgram } from "../../lib/training-program";
import { CustomProgram, getProgramWeeks, loadActiveCustomProgram } from "../../lib/custom-programs";
import { Adjustment, ProgramStatus, syncProgramProgress } from "../../lib/program-progress";
import {
    createEvidenceWindow,
    ExerciseEvidence,
    getBestRecentEvidence,
    matchesTrainingTarget,
    roundLoad,
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
    const [sessionIndex, setSessionIndex] = useState(0);
    const [exercises, setExercises] = useState<Exercise[]>([]);
    const [performances, setPerformances] = useState<TrainingPerformance[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [customProgram, setCustomProgram] = useState<CustomProgram | null>(null);
    const [status, setStatus] = useState<ProgramStatus | null>(null);
    const [editing, setEditing] = useState(false);
    const [edits, setEdits] = useState<Record<string, { exerciseId: string; load: string; sets: string; reps: string }>>({});

    function handleBack() {
        if (router.canGoBack()) router.back();
        else router.replace("/app/dashboard");
    }

    useEffect(() => {
        (async () => {
            try {
                const active = await loadActiveCustomProgram();
                setCustomProgram(active);
                if (!active) return;
                const programStatus = await syncProgramProgress(active);
                setStatus(programStatus);
                setSessionIndex(programStatus.position.sessionIndex);
            } catch (programError) {
                console.error("Custom program load error:", programError);
            }
        })();
    }, []);

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

    const programs = useMemo<(TrainingProgram & { loadPercents?: Record<string, number>; adjustments?: Record<string, Adjustment[]> })[]>(() => {
        if (!customProgram) return [];
        const weeks = getProgramWeeks(customProgram);
        const week = weeks[(status?.position.week ?? 1) - 1] ?? weeks[0];
        const loadPercents: Record<string, number> = {};
        const adjustments: Record<string, Adjustment[]> = {};
        const sessions = week.sessions.map((session, index) => {
            const adapted = status && index === status.position.sessionIndex ? status.nextExercises : null;
            return {
                ...session,
                exercises: (adapted ?? session.exercises).map((exercise) => {
                    if (adapted) {
                        if (exercise.prescription.loadPercent) loadPercents[exercise.key] = exercise.prescription.loadPercent;
                        adjustments[exercise.key] = (exercise as typeof adapted[number]).adjustments;
                    }
                    return { ...exercise, sets: exercise.prescription.sets, reps: exercise.prescription.reps };
                }),
            };
        });
        const custom = {
            key: "custom",
            title: customProgram.name,
            purpose: `Week ${week.week}/${weeks.length} · ${week.phase === "deload" ? "Deload" : "Build"}`,
            description: "Your custom program. Each session adapts to how your last workouts went and how much rest you've had.",
            frequency: `${customProgram.sessionsPerWeek} sessions · ${customProgram.scheduleMode}`,
            sessions,
            loadPercents,
            adjustments,
        };
        return [custom];
    }, [customProgram, status]);

    const selectedProgram = programs[0];
    const selectedSession = selectedProgram?.sessions[sessionIndex % selectedProgram.sessions.length];
    const suggestions = useMemo(() => {
        if (!selectedProgram || !selectedSession) return [];
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
            const selectedExercise = edits[target.key]?.exerciseId
                ? exercises.find((item) => item.id === edits[target.key].exerciseId)
                : undefined;
            const exercise = selectedExercise ?? rankedCandidates[0];
            if (exercise) usedExerciseIds.add(exercise.id);
            const evidence = exercise ? getEvidence(exercise.id) : null;
            const percent = customProgram?.goal === "strength" && (target.movementPattern || target.group === "Deadlift")
                ? 85
                : selectedProgram.loadPercents?.[target.key];
            const load = percent
                ? suggestedLoadFromEvidence(evidence, percent / 100)
                : evidence
                    ? roundLoad(evidence.performance.weight_kg)
                    : null;
            const edit = edits[target.key];
            return {
                target: edit
                    ? { ...target, sets: Number(edit.sets) || target.sets, reps: edit.reps || target.reps }
                    : target,
                exercise,
                candidates,
                load: edit ? (Number(edit.load) || null) : load,
                evidence,
            };
        }).filter((suggestion): suggestion is {
            target: TrainingExerciseTarget;
            exercise: Exercise;
            load: number | null;
            evidence: ExerciseEvidence | null;
            candidates: Exercise[];
        } => Boolean(suggestion.exercise));
    }, [customProgram, edits, exercises, performances, selectedSession, selectedProgram]);
    const sessionAdjustments = selectedProgram?.adjustments ?? {};
    const globalNotes = status ? status.adjustments.filter((a) => a.targetKey === null) : [];
    const matchedCount = suggestions.length;
    const totalExercises = selectedSession?.exercises.length ?? 0;

    function beginEditing() {
        const next: typeof edits = {};
        suggestions.forEach(({ target, exercise, load }) => {
            next[target.key] = {
                exerciseId: exercise.id,
                load: load == null ? "" : String(load),
                sets: String(target.sets),
                reps: target.reps,
            };
        });
        setEdits(next);
        setEditing(true);
    }

    function updateEdit(key: string, field: "exerciseId" | "load" | "sets" | "reps", value: string) {
        setEdits((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
                <View style={styles.header}>
                    <Pressable onPress={handleBack} style={styles.backButton} accessibilityLabel={t("app.suggestions.go_back")}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </Pressable>
                    <View style={styles.headerCopy}>
                        <Text style={[styles.eyebrow, { color: colors.tint }]}>{t("app.suggestions.eyebrow")}</Text>
                        <Text style={[styles.title, { color: colors.text }]}>{t("app.suggestions.title")}</Text>
                        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>{t("app.suggestions.subtitle")}</Text>
                    </View>
                </View>

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
                {customProgram && status && (
                    <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.statusTitle, { color: colors.text }]}>
                            Week {status.position.week} · {status.position.phase === "deload" ? "Deload" : "Build"} · next: {status.position.session.title}
                        </Text>
                        <Text style={[styles.statusLine, { color: colors.secondaryText }]}>
                            {status.recovery.hoursSinceLastWorkout == null
                                ? "No recent workouts"
                                : `Last workout ${status.recovery.hoursSinceLastWorkout < 36 ? `${Math.round(status.recovery.hoursSinceLastWorkout)}h` : `${Math.round(status.recovery.hoursSinceLastWorkout / 24)} days`} ago`}
                            {status.lastMatch ? ` · ${Math.round(status.lastMatch.muscleCoverage * 100)}% muscles on plan` : ""}
                            {status.lastMatch?.avgRpeDelta != null ? ` · RPE ${status.lastMatch.avgRpeDelta >= 0 ? "+" : ""}${status.lastMatch.avgRpeDelta.toFixed(1)} vs target` : ""}
                            {status.position.missedSessions ? ` · ${status.position.missedSessions} missed` : ""}
                        </Text>
                        {globalNotes.map((note) => (
                            <Text key={note.kind} style={[styles.statusNote, { color: colors.tint }]}>• {note.reason}</Text>
                        ))}
                        <Pressable onPress={() => router.push("/app/program-guide")} accessibilityRole="link">
                            <Text style={[styles.statusNote, { color: colors.tint }]}>Why these changes? →</Text>
                        </Pressable>
                    </View>
                )}
                {selectedProgram && selectedSession ? (
                    <>
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
                    </>
                ) : (
                    <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.emptyTitle, { color: colors.text }]}>Create a plan to get started</Text>
                        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                            Your recommendations will follow the sessions you create and update from your completed workouts.
                        </Text>
                    </View>
                )}

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
                            <View style={styles.workoutHeadingCopy}>
                                <Text style={[styles.workoutTitle, { color: colors.text }]}>Workout plan</Text>
                                <Text style={[styles.workoutSubtitle, { color: colors.secondaryText }]}>
                                    {matchedCount} of {totalExercises} movements matched to your history
                                </Text>
                            </View>
                                    <View style={[styles.matchBadge, { backgroundColor: colors.tint + "18" }]}>
                                        <Ionicons name="sparkles-outline" size={13} color={colors.tint} />
                                        <Text style={[styles.matchBadgeText, { color: colors.tint }]}>Personalized</Text>
                                    </View>
                                    <Pressable
                                        onPress={() => editing ? setEditing(false) : beginEditing()}
                                        style={[styles.editButton, { borderColor: colors.border }]}
                                    >
                                        <Ionicons name={editing ? "checkmark-outline" : "create-outline"} size={15} color={colors.tint} />
                                        <Text style={[styles.editButtonText, { color: colors.tint }]}>{editing ? "Done" : "Edit workout"}</Text>
                                    </Pressable>
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
                                    <Pressable
                                        disabled={!editing}
                                        onPress={() => updateEdit(suggestion.target.key, "exerciseId", suggestion.exercise.id)}
                                        style={styles.exerciseNameButton}
                                    >
                                        <Text style={[styles.exerciseName, { color: colors.text }]}>{suggestion.exercise.name}</Text>
                                        {editing && <Ionicons name="chevron-down" size={15} color={colors.tint} />}
                                    </Pressable>
                                    {editing && (
                                        <View style={styles.exercisePicker}>
                                            <Text style={[styles.pickerLabel, { color: colors.secondaryText }]}>Replace exercise</Text>
                                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.exercisePickerRow}>
                                                {suggestion.candidates.map((candidate) => {
                                                    const selected = candidate.id === suggestion.exercise.id;
                                                    return (
                                                        <Pressable
                                                            key={candidate.id}
                                                            onPress={() => updateEdit(suggestion.target.key, "exerciseId", candidate.id)}
                                                            style={[
                                                                styles.exerciseChoice,
                                                                {
                                                                    backgroundColor: selected ? colors.tint : colors.background,
                                                                    borderColor: selected ? colors.tint : colors.border,
                                                                },
                                                            ]}
                                                        >
                                                            <Text style={[styles.exerciseChoiceText, { color: selected ? "#FFF" : colors.text }]}>
                                                                {candidate.name}
                                                            </Text>
                                                        </Pressable>
                                                    );
                                                })}
                                            </ScrollView>
                                        </View>
                                    )}
                                    <Text style={[styles.evidenceText, { color: colors.secondaryText }]}>
                                        {suggestion.evidence
                                            ? t("app.suggestions.evidence", { date: new Date(suggestion.evidence.performance.start_time).toLocaleDateString() })
                                            : t("app.suggestions.no_previous_load")}
                                    </Text>
                                    {(sessionAdjustments[suggestion.target.key] ?? []).map((adjustment) => (
                                        <Text key={adjustment.kind + adjustment.reason} style={[styles.adjustmentBadge, { color: colors.tint, backgroundColor: colors.tint + "18" }]}>
                                            {adjustment.reason}
                                        </Text>
                                    ))}
                                </View>
                                <View style={[styles.prescription, { backgroundColor: suggestion.load ? colors.tint : colors.secondary }]}>
                                    {editing ? (
                                        <TextInput
                                            value={edits[suggestion.target.key]?.load ?? ""}
                                            onChangeText={(value) => updateEdit(suggestion.target.key, "load", value.replace(/[^0-9.]/g, ""))}
                                            keyboardType="decimal-pad"
                                            style={[styles.editInput, { color: "#FFF" }]}
                                            selectTextOnFocus
                                        />
                                    ) : (
                                        <Text style={[styles.loadText, { color: suggestion.load ? "#FFF" : colors.secondaryText }]}>
                                            {suggestion.load ? `${suggestion.load}` : "—"}
                                        </Text>
                                    )}
                                    <Text style={[styles.loadUnit, { color: suggestion.load ? "rgba(255,255,255,0.8)" : colors.secondaryText }]}>kg</Text>
                                    {editing ? (
                                        <View style={styles.editPrescriptionRow}>
                                            <TextInput
                                                value={edits[suggestion.target.key]?.sets ?? ""}
                                                onChangeText={(value) => updateEdit(suggestion.target.key, "sets", value.replace(/\D/g, ""))}
                                                keyboardType="number-pad"
                                                style={[styles.smallEditInput, { color: "#FFF" }]}
                                            />
                                            <Text style={[styles.repsText, { color: "rgba(255,255,255,0.8)" }]}>×</Text>
                                            <TextInput
                                                value={edits[suggestion.target.key]?.reps ?? ""}
                                                onChangeText={(value) => updateEdit(suggestion.target.key, "reps", value)}
                                                style={[styles.smallEditInput, { color: "#FFF" }]}
                                            />
                                        </View>
                                    ) : (
                                        <Text style={[styles.repsText, { color: suggestion.load ? "rgba(255,255,255,0.8)" : colors.secondaryText }]}>{suggestion.target.sets} × {suggestion.target.reps}</Text>
                                    )}
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
    statusCard: { borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 14 },
    statusTitle: { fontSize: 14, fontWeight: "800" },
    statusLine: { fontSize: 12, marginTop: 4 },
    statusNote: { fontSize: 12, marginTop: 6, fontWeight: "600" },
    adjustmentBadge: { fontSize: 11, fontWeight: "600", marginTop: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, alignSelf: "flex-start", overflow: "hidden" },
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
    workoutHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 12 },
    workoutHeadingCopy: { flex: 1, minWidth: 180 },
    editButton: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
    editButtonText: { fontSize: 11, fontWeight: "800" },
    workoutTitle: { fontSize: 20, fontWeight: "900" },
    workoutSubtitle: { fontSize: 12, marginTop: 3 },
    matchBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 12 },
    matchBadgeText: { fontSize: 10, fontWeight: "800" },
    suggestionCard: { flexDirection: "row", alignItems: "flex-start", padding: 14, borderRadius: 14, borderWidth: 1, borderLeftWidth: 4, marginBottom: 10 },
    stepNumber: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", marginRight: 14 },
    stepNumberText: { fontSize: 13, fontWeight: "900" },
    suggestionCopy: { flex: 1, minWidth: 0, overflow: "hidden" },
    groupName: { fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginBottom: 4 },
    exerciseNameButton: { flexDirection: "row", alignItems: "center", gap: 6 },
    exerciseName: { fontSize: 17, fontWeight: "800" },
    exercisePicker: { marginTop: 10 },
    pickerLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 },
    exercisePickerRow: { gap: 6, paddingRight: 8, maxWidth: "100%" },
    exerciseChoice: { maxWidth: 180, borderWidth: 1, borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
    exerciseChoiceText: { fontSize: 11, fontWeight: "700" },
    loadText: { fontSize: 16, fontWeight: "900" },
    editInput: { minWidth: 62, paddingVertical: 0, fontSize: 16, fontWeight: "900", textAlign: "right" },
    loadUnit: { fontSize: 9, fontWeight: "800", marginTop: -2 },
    repsText: { fontSize: 10, fontWeight: "700", marginTop: 3 },
    editPrescriptionRow: { flexDirection: "row", alignItems: "center", gap: 3 },
    smallEditInput: { width: 28, paddingVertical: 0, fontSize: 10, fontWeight: "800", textAlign: "center", borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.65)" },
    evidenceText: { fontSize: 11, marginTop: 5 },
    prescription: { width: 88, flexShrink: 0, alignItems: "center", paddingHorizontal: 8, paddingVertical: 9, borderRadius: 10, marginLeft: 12 },
    emptyCard: { padding: 22, borderRadius: 14, borderWidth: 1, marginTop: 18 },
    emptyTitle: { fontSize: 17, fontWeight: "800", marginBottom: 6 },
    emptyText: { fontSize: 14, lineHeight: 21 },
});

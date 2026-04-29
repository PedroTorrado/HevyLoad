import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { 
    ActivityIndicator, 
    ScrollView, 
    StyleSheet, 
    Text, 
    View, 
    Pressable 
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { useThemeColor } from "../../../lib/theme";
import { useFocusEffect } from "expo-router";
import { format } from "date-fns";

interface Set {
    id: string;
    exercise_id: string;
    weight_kg: number | null;
    reps: number | null;
    distance_km: number | null;
    duration_s: number | null;
    rpe: number | null;
    set_order: number;
    set_type: string;
    exercise: {
        id: string;
        name: string;
        muscle_group: string | null;
    };
    isPR?: boolean;
    isWeightPR?: boolean;
}

interface Workout {
    id: string;
    title: string;
    start_time: string;
    end_time: string | null;
    description: string | null;
}

export default function WorkoutDetails() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(true);
    const [workout, setWorkout] = useState<Workout | null>(null);
    const [sets, setSets] = useState<Set[]>([]);

    useFocusEffect(
        useCallback(() => {
            loadWorkoutDetails();
        }, [id])
    );

    async function loadWorkoutDetails() {
        setLoading(true);
        
        // Load workout
        const { data: workoutData } = await supabase
            .from("workouts")
            .select("*")
            .eq("id", id)
            .single();

        if (workoutData) {
            setWorkout(workoutData);

            // Load sets with exercise info
            const { data: setsData } = await supabase
                .from("sets")
                .select(`
                    *,
                    exercise:exercises(id, name, muscle_group)
                `)
                .eq("workout_id", id)
                .order("set_order", { ascending: true });

            if (setsData) {
                const workoutSets = setsData as any[];
                
                // For each exercise in this workout, check if any set is a PR compared to history BEFORE this workout
                const exerciseIds = Array.from(new Set(workoutSets.map(s => s.exercise.id)));
                
                const { data: historyData } = await supabase
                    .from("sets")
                    .select(`
                        weight_kg,
                        reps,
                        exercise_id,
                        workouts!inner(start_time)
                    `)
                    .in("exercise_id", exerciseIds)
                    .lt("workouts.start_time", workoutData.start_time);

                const historyMap: Record<string, { max1RM: number, maxWeight: number }> = {};
                historyData?.forEach(h => {
                    const oneRM = h.reps > 0 ? h.weight_kg / (1.0278 - (0.0278 * h.reps)) : 0;
                    if (!historyMap[h.exercise_id]) {
                        historyMap[h.exercise_id] = { max1RM: oneRM, maxWeight: h.weight_kg };
                    } else {
                        if (oneRM > historyMap[h.exercise_id].max1RM) historyMap[h.exercise_id].max1RM = oneRM;
                        if (h.weight_kg > historyMap[h.exercise_id].maxWeight) historyMap[h.exercise_id].maxWeight = h.weight_kg;
                    }
                });

                // Mark PRs
                const setsWithPRs = workoutSets.map(s => {
                    const oneRM = s.reps > 0 ? s.weight_kg / (1.0278 - (0.0278 * s.reps)) : 0;
                    const hist = historyMap[s.exercise_id];
                    return {
                        ...s,
                        isPR: hist ? oneRM > hist.max1RM : true,
                        isWeightPR: hist ? s.weight_kg > hist.maxWeight : true
                    };
                });

                setSets(setsWithPRs);
            }
        }

        setLoading(false);
    }

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    };

    if (loading) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.tint} />
            </View>
        );
    }

    if (!workout) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                <Text style={{ color: colors.text }}>{t("app.workout.not_found")}</Text>
                <Pressable onPress={handleBack} style={{ marginTop: 20 }}>
                    <Text style={{ color: colors.tint }}>{t("common.back")}</Text>
                </Pressable>
            </View>
        );
    }

    // Group sets by exercise
    const groupedSets: Record<string, Set[]> = {};
    sets.forEach(set => {
        const name = set.exercise.name;
        if (!groupedSets[name]) groupedSets[name] = [];
        groupedSets[name].push(set);
    });

    const startTime = new Date(workout.start_time);
    const dateStr = format(startTime, "EEEE, d MMMM yyyy");
    const timeStr = format(startTime, "HH:mm");

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>
                <View style={styles.headerInfo}>
                    <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                        {workout.title || t("app.workout.default_title")}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]}>
                        {dateStr}
                    </Text>
                </View>
                <Pressable style={styles.backBtn}>
                    <Ionicons name="ellipsis-horizontal" size={24} color={colors.text} />
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
                {/* Workout Summary */}
                <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.summaryItem}>
                        <Ionicons name="time-outline" size={20} color={colors.secondaryText} />
                        <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>{t("app.workout.start")}</Text>
                        <Text style={[styles.summaryValue, { color: colors.text }]}>{timeStr}</Text>
                    </View>
                    
                    {workout.description && (
                        <View style={[styles.descriptionBox, { borderTopColor: colors.border }]}>
                            <Text style={[styles.descriptionText, { color: colors.text }]}>{workout.description}</Text>
                        </View>
                    )}
                </View>

                {/* Exercises */}
                {Object.entries(groupedSets).map(([exerciseName, exerciseSets]) => (
                    <View key={exerciseName} style={[styles.exerciseSection, { borderBottomColor: colors.border }]}>
                        <View style={styles.exerciseHeader}>
                            <Text style={[styles.exerciseTitle, { color: colors.text }]}>{exerciseName}</Text>
                            <Text style={[styles.muscleGroup, { color: colors.secondaryText }]}>
                                {exerciseSets[0]?.exercise.muscle_group || ""}
                            </Text>
                        </View>

                        <View style={styles.setsTable}>
                            <View style={styles.tableHeader}>
                                <Text style={[styles.colSet, { color: colors.secondaryText }]}>{t("app.workout.set")}</Text>
                                <Text style={[styles.colWeight, { color: colors.secondaryText }]}>{t("app.workout.weight")}</Text>
                                <Text style={[styles.colReps, { color: colors.secondaryText }]}>{t("app.workout.reps")}</Text>
                                <Text style={[styles.colRpe, { color: colors.secondaryText }]}>RPE</Text>
                            </View>

                            {exerciseSets.map((set, index) => (
                                <View key={set.id} style={styles.setRow}>
                                    <View style={[styles.setNumBadge, { backgroundColor: colors.secondary }]}>
                                        <Text style={[styles.setNumText, { color: colors.text }]}>{index + 1}</Text>
                                    </View>
                                    <View style={styles.colWeight}>
                                        <Text style={[styles.setValue, { color: colors.text }]}>
                                            {set.weight_kg !== null ? `${set.weight_kg} kg` : "-"}
                                        </Text>
                                        {set.isWeightPR && (
                                            <View style={styles.miniPrBadge}>
                                                <Text style={styles.miniPrBadgeText}>WEIGHT PR</Text>
                                            </View>
                                        )}
                                    </View>
                                    <Text style={[styles.colReps, styles.setValue, { color: colors.text }]}>
                                        {set.reps !== null ? set.reps : "-"}
                                    </Text>
                                    <View style={styles.colRpe}>
                                        <Text style={[styles.setValue, { color: colors.text }]}>
                                            {set.rpe !== null ? set.rpe : "-"}
                                        </Text>
                                        {set.isPR && (
                                            <View style={[styles.miniPrBadge, { backgroundColor: "#FFD700" }]}>
                                                <Text style={[styles.miniPrBadgeText, { color: "#000" }]}>1RM PR</Text>
                                            </View>
                                        )}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
    headerInfo: { flex: 1, alignItems: "center" },
    headerTitle: { fontSize: 16, fontWeight: "800" },
    headerSubtitle: { fontSize: 12, fontWeight: "600" },

    content: { padding: 16 },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },

    summaryCard: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        marginBottom: 24,
    },
    summaryItem: {
        flexDirection: "row",
        alignItems: "center",
    },
    summaryLabel: { fontSize: 13, fontWeight: "600", marginLeft: 8, flex: 1 },
    summaryValue: { fontSize: 13, fontWeight: "700" },
    descriptionBox: {
        marginTop: 12,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    descriptionText: { fontSize: 14, fontStyle: "italic", lineHeight: 20 },

    exerciseSection: {
        marginBottom: 32,
        paddingBottom: 16,
        borderBottomWidth: 1,
    },
    exerciseHeader: {
        marginBottom: 16,
    },
    exerciseTitle: { fontSize: 18, fontWeight: "800", color: "#000" },
    muscleGroup: { fontSize: 12, fontWeight: "600", textTransform: "uppercase", marginTop: 2 },

    setsTable: { gap: 8 },
    tableHeader: {
        flexDirection: "row",
        paddingHorizontal: 8,
        marginBottom: 4,
    },
    colSet: { width: 40, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
    colWeight: { flex: 1, fontSize: 11, fontWeight: "700", textTransform: "uppercase", textAlign: "center" },
    colReps: { flex: 1, fontSize: 11, fontWeight: "700", textTransform: "uppercase", textAlign: "center" },
    colRpe: { width: 40, fontSize: 11, fontWeight: "700", textTransform: "uppercase", textAlign: "center" },

    setRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 8,
        paddingHorizontal: 8,
    },
    setNumBadge: {
        width: 24,
        height: 24,
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
    },
    setNumText: { fontSize: 12, fontWeight: "800" },
    setValue: { fontSize: 14, fontWeight: "600", textAlign: "center" },
    miniPrBadge: {
        backgroundColor: "#5856D6",
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 4,
        marginTop: 2,
        alignSelf: "center",
    },
    miniPrBadgeText: {
        fontSize: 7,
        fontWeight: "900",
        color: "#FFF",
    },
});

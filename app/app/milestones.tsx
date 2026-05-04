import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useCallback, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { 
    ActivityIndicator, 
    FlatList, 
    StyleSheet, 
    Text, 
    View, 
    Pressable 
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { format, parseISO } from "date-fns";

interface Milestone {
    id: string;
    weight_kg: number;
    reps: number;
    one_rm: number;
    exercise_name: string;
    date: string;
    workout_id: string;
}

export default function Milestones() {
    const router = useRouter();
    const { highlightMonth } = useLocalSearchParams();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(true);
    const [milestones, setMilestones] = useState<Milestone[]>([]);

    useEffect(() => {
        loadAllMilestones();
    }, []);

    async function loadAllMilestones() {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch all workouts with sets and exercises to calculate all-time PRs (paginated)
        let allWorkouts: any[] = [];
        let rangeStart = 0;
        const rangeStep = 1000;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabase
                .from("workouts")
                .select("id, start_time, sets(id, weight_kg, reps, exercise_id, exercises(name))")
                .eq("user_id", user.id)
                .order("start_time", { ascending: true })
                .range(rangeStart, rangeStart + rangeStep - 1);

            if (error) break;
            if (data && data.length > 0) {
                allWorkouts = [...allWorkouts, ...data];
                if (data.length < rangeStep) hasMore = false;
                else rangeStart += rangeStep;
            } else {
                hasMore = false;
            }
        }

        if (allWorkouts.length > 0) {
            const allPRs: Milestone[] = [];
            const exerciseMaxes: Record<string, number> = {};
            const noiseKeywords = ["warm up", "treadmill", "cycling", "spinning", "stretching", "elliptical", "rowing machine"];

            allWorkouts.forEach(w => {
                const dayBestPRs: Record<string, Milestone> = {};

                (w.sets || []).forEach((s: any) => {
                    const weight = s.weight_kg || 0;
                    const reps = s.reps || 0;
                    const name = (s.exercises?.name || "Unknown").toLowerCase();
                    
                    // Filter out noise
                    if (weight <= 0 || reps <= 0) return;
                    if (noiseKeywords.some(k => name.includes(k))) return;

                    const oneRM = reps === 1 ? weight : weight / (1.0278 - (0.0278 * reps));
                    const exId = s.exercise_id;

                    // Only count as PR if it beats all previous workouts
                    if (!exerciseMaxes[exId] || oneRM > exerciseMaxes[exId]) {
                        // Update global max for next workouts
                        exerciseMaxes[exId] = oneRM;

                        // Within the SAME workout, only keep the best set per exercise as the milestone
                        const milestone = {
                            id: s.id,
                            weight_kg: weight,
                            reps: reps,
                            one_rm: Math.round(oneRM * 10) / 10,
                            exercise_name: s.exercises?.name || "Unknown",
                            date: w.start_time,
                            workout_id: w.id
                        };

                        if (!dayBestPRs[exId] || oneRM > dayBestPRs[exId].one_rm) {
                            dayBestPRs[exId] = milestone;
                        }
                    }
                });

                // Add all distinct PRs from this workout to the global list
                Object.values(dayBestPRs).forEach(m => allPRs.push(m));
            });

            // Sort descending by date for the list
            setMilestones(allPRs.reverse());
        }
        setLoading(false);
    }

    const renderMilestoneItem = ({ item }: { item: Milestone }) => {
        const isHighlighted = highlightMonth && format(parseISO(item.date), "MMM") === highlightMonth;

        return (
            <Pressable 
                style={[
                    styles.milestoneCard, 
                    { backgroundColor: colors.card, borderColor: isHighlighted ? colors.tint : colors.border }
                ]}
                onPress={() => router.push(`/app/workout/${item.workout_id}` as any)}
            >
                <View style={styles.cardHeader}>
                    <Text style={[styles.exerciseName, { color: colors.text }]}>{item.exercise_name}</Text>
                    <Text style={[styles.date, { color: colors.secondaryText }]}>{format(parseISO(item.date), "MMMM d, yyyy")}</Text>
                </View>
                <View style={styles.statsRow}>
                    <View style={styles.stat}>
                        <Text style={[styles.statLabel, { color: colors.secondaryText }]}>LIFT</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{item.weight_kg}kg x {item.reps}</Text>
                    </View>
                    <View style={styles.stat}>
                        <Text style={[styles.statLabel, { color: colors.secondaryText }]}>EST. 1RM</Text>
                        <Text style={[styles.statValue, { color: colors.tint }]}>{item.one_rm}kg</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={colors.border} />
                </View>
            </Pressable>
        );
    };

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.text }]}>All Milestones</Text>
                <View style={{ width: 40 }} />
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator size="large" color={colors.tint} /></View>
            ) : (
                <FlatList
                    data={milestones}
                    renderItem={renderMilestoneItem}
                    keyExtractor={item => item.id}
                    contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 20 }]}
                    ListEmptyComponent={
                        <View style={styles.empty}>
                            <Ionicons name="trophy-outline" size={64} color={colors.border} />
                            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No milestones yet. Keep training!</Text>
                        </View>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
    backBtn: { width: 40, height: 40, justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "700", fontFamily: "System" },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    list: { padding: 16, gap: 12 },
    milestoneCard: { padding: 16, borderRadius: 16, borderWidth: 1 },
    cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 },
    exerciseName: { fontSize: 16, fontWeight: "800", flex: 1, marginRight: 8 },
    date: { fontSize: 12, fontWeight: "600" },
    statsRow: { flexDirection: "row", alignItems: "center", gap: 24 },
    stat: { gap: 2 },
    statLabel: { fontSize: 10, fontWeight: "800" },
    statValue: { fontSize: 18, fontWeight: "900" },
    empty: { alignItems: "center", marginTop: 100, gap: 16 },
    emptyText: { fontSize: 16, fontWeight: "600" }
});

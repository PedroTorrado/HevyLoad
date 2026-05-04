import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { 
    ActivityIndicator, 
    FlatList, 
    Pressable, 
    StyleSheet, 
    Text, 
    View, 
    Platform 
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { format, startOfMonth, endOfMonth, eachMonthOfInterval, subMonths, isSameMonth } from "date-fns";

interface Workout {
    id: string;
    title: string;
    start_time: string;
    end_time: string | null;
    description: string | null;
    sets_count?: number;
}

export default function History() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(false);
    const hasLoaded = useRef(false);
    const [workouts, setWorkouts] = useState<Workout[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(new Date());
    const [comparisonData, setComparisonData] = useState<{
        prevMonthWorkouts: number;
        prevMonthSets: number;
        currMonthSets: number;
        trainingSplit: Record<string, number>;
    } | null>(null);

    // Generate last 12 months for the filter
    const monthFilterOptions = eachMonthOfInterval({
        start: subMonths(new Date(), 11),
        end: new Date()
    }).reverse();

    useFocusEffect(
        useCallback(() => {
            loadWorkouts(false);
        }, [selectedMonth])
    );

    useEffect(() => {
        loadWorkouts(true);
        hasLoaded.current = true;
    }, [selectedMonth]);

    async function loadWorkouts(showLoader: boolean) {
        if (showLoader && workouts.length === 0) setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const monthStart = startOfMonth(selectedMonth).toISOString();
        const monthEnd = endOfMonth(selectedMonth).toISOString();

        // 1. Load workouts for current month with muscle group data
        const { data: workoutsData, error } = await supabase
            .from("workouts")
            .select(`
                id, 
                title, 
                start_time, 
                end_time, 
                description,
                sets:sets(count, exercise:exercises(muscle_group))
            `)
            .eq("user_id", user.id)
            .gte("start_time", monthStart)
            .lte("start_time", monthEnd)
            .order("start_time", { ascending: false });

        if (error) {
            console.error("Error loading workouts:", error);
        } else {
            const split: Record<string, number> = {};
            const formattedWorkouts = (workoutsData || []).map((w: any) => {
                let sCount = 0;
                w.sets.forEach((s: any) => {
                    sCount += s.count;
                    const mg = s.exercise?.muscle_group || "Other";
                    split[mg] = (split[mg] || 0) + s.count;
                });
                return {
                    ...w,
                    sets_count: sCount
                };
            });
            setWorkouts(formattedWorkouts);

            // 2. Load comparison data (Previous Month)
            const prevMonth = subMonths(selectedMonth, 1);
            const prevStart = startOfMonth(prevMonth).toISOString();
            const prevEnd = endOfMonth(prevMonth).toISOString();

            const [prevRes] = await Promise.all([
                supabase.from("workouts").select("id, sets(count)").eq("user_id", user.id).gte("start_time", prevStart).lte("start_time", prevEnd)
            ]);
            
            const currMonthSets = formattedWorkouts.reduce((acc, w) => acc + (w.sets_count || 0), 0);
            const prevMonthWorkouts = prevRes.data?.length || 0;
            const prevMonthSets = (prevRes.data || []).reduce((acc: number, w: any) => acc + (w.sets?.[0]?.count || 0), 0);

            setComparisonData({
                prevMonthWorkouts,
                prevMonthSets,
                currMonthSets,
                trainingSplit: split
            });
        }

        setLoading(false);
    }

    const renderInsights = () => {
        if (!comparisonData) return null;

        const isCurrentMonth = isSameMonth(selectedMonth, new Date());
        const today = new Date();
        const daysInMonth = 30; // Approximation
        const daysElapsed = isCurrentMonth ? today.getDate() : daysInMonth;
        
        const workoutsCount = workouts.length;
        const setsCount = comparisonData.currMonthSets;

        const workoutPace = (workoutsCount / daysElapsed) * 7; // workouts/week
        const prevWorkoutPace = (comparisonData.prevMonthWorkouts / 30) * 7;
        const workoutChange = prevWorkoutPace > 0 ? ((workoutPace - prevWorkoutPace) / prevWorkoutPace) * 100 : 0;

        const setPace = (setsCount / daysElapsed) * 7; // sets/week
        const prevSetPace = (comparisonData.prevMonthSets / 30) * 7;
        const setChange = prevSetPace > 0 ? ((setPace - prevSetPace) / prevSetPace) * 100 : 0;

        const project = (val: number) => Math.round((val / daysElapsed) * 30);

        return (
            <View style={[styles.insightsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.insightsHeader}>
                    <Text style={[styles.insightsTitle, { color: colors.text }]}>Monthly Insights</Text>
                    {isCurrentMonth && (
                        <View style={styles.liveBadge}>
                            <View style={styles.liveDot} />
                            <Text style={styles.liveText}>LIVE</Text>
                        </View>
                    )}
                </View>

                <View style={styles.insightsGrid}>
                    <View style={styles.insightItem}>
                        <Text style={[styles.insightLabel, { color: colors.secondaryText }]}>Consistency</Text>
                        <Text style={[styles.insightValue, { color: colors.text }]}>{workoutPace.toFixed(1)} <Text style={styles.insightUnit}>w/wk</Text></Text>
                        <View style={styles.deltaRow}>
                            <Ionicons 
                                name={workoutChange >= 0 ? "arrow-up" : "arrow-down"} 
                                size={12} 
                                color={workoutChange >= 0 ? colors.tint : colors.error} 
                            />
                            <Text style={[styles.deltaText, { color: workoutChange >= 0 ? colors.tint : colors.error }]}>
                                {Math.abs(workoutChange).toFixed(0)}%
                            </Text>
                        </View>
                        {isCurrentMonth && (
                            <Text style={[styles.projectionText, { color: colors.secondaryText }]}>
                                Proj: {project(workoutsCount)} workouts
                            </Text>
                        )}
                    </View>

                    <View style={[styles.dividerVertical, { backgroundColor: colors.border }]} />

                    <View style={styles.insightItem}>
                        <Text style={[styles.insightLabel, { color: colors.secondaryText }]}>Volume</Text>
                        <Text style={[styles.insightValue, { color: colors.text }]}>{setPace.toFixed(0)} <Text style={styles.insightUnit}>sets/wk</Text></Text>
                        <View style={styles.deltaRow}>
                            <Ionicons 
                                name={setChange >= 0 ? "arrow-up" : "arrow-down"} 
                                size={12} 
                                color={setChange >= 0 ? colors.tint : colors.error} 
                            />
                            <Text style={[styles.deltaText, { color: setChange >= 0 ? colors.tint : colors.error }]}>
                                {Math.abs(setChange).toFixed(0)}%
                            </Text>
                        </View>
                        {isCurrentMonth && (
                            <Text style={[styles.projectionText, { color: colors.secondaryText }]}>
                                Proj: {project(setsCount)} sets
                            </Text>
                        )}
                    </View>
                </View>

                {/* Training Split Section */}
                {Object.keys(comparisonData.trainingSplit).length > 0 && (
                    <View style={styles.splitSection}>
                        <Text style={[styles.insightLabel, { color: colors.secondaryText, marginBottom: 8 }]}>Training Split</Text>
                        <View style={styles.splitList}>
                            {Object.entries(comparisonData.trainingSplit)
                                .sort((a, b) => b[1] - a[1])
                                .map(([mg, count]) => (
                                    <View key={mg} style={styles.splitItem}>
                                        <View style={styles.splitMeta}>
                                            <View style={[styles.splitDot, { backgroundColor: getMuscleColor(mg) }]} />
                                            <Text style={[styles.splitName, { color: colors.text }]}>{mg}</Text>
                                        </View>
                                        <Text style={[styles.splitValue, { color: colors.secondaryText }]}>
                                            {count} sets ({Math.round((count / setsCount) * 100)}%)
                                        </Text>
                                    </View>
                                ))
                            }
                        </View>
                    </View>
                )}
            </View>
        );
    };

    function getMuscleColor(mg: string) {
        const colors: Record<string, string> = {
            "Chest": "#90caf9",
            "Back": "#66bb6a",
            "Legs": "#f48fb1",
            "Shoulders": "#ce93d8",
            "Arms": "#ffcc80",
            "Other": "#b0bec5"
        };
        return colors[mg] || colors["Other"];
    }

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    };

    const renderWorkoutItem = ({ item }: { item: Workout }) => {
        const startTime = new Date(item.start_time);
        const dayName = format(startTime, "EEEE");
        const dayNum = format(startTime, "d");
        const timeStr = format(startTime, "HH:mm");

        return (
            <Pressable 
                style={[styles.workoutCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push(`/app/workout/${item.id}` as any)}
            >
                <View style={styles.dateBadge}>
                    <Text style={[styles.dayNum, { color: colors.text }]}>{dayNum}</Text>
                    <Text style={[styles.dayName, { color: colors.secondaryText }]}>{dayName.substring(0, 3)}</Text>
                </View>
                
                <View style={styles.workoutInfo}>
                    <Text style={[styles.workoutTitle, { color: colors.text }]}>{item.title || t("app.history.default_title")}</Text>
                    <View style={styles.workoutMeta}>
                        <Ionicons name="time-outline" size={14} color={colors.secondaryText} />
                        <Text style={[styles.metaText, { color: colors.secondaryText }]}>{timeStr}</Text>
                        
                        {item.description && (
                            <>
                                <View style={[styles.dot, { backgroundColor: colors.border }]} />
                                <Text style={[styles.metaText, { color: colors.secondaryText }]} numberOfLines={1}>
                                    {item.description}
                                </Text>
                            </>
                        )}
                    </View>
                </View>

                <Ionicons name="chevron-forward" size={20} color={colors.border} />
            </Pressable>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.text }]}>{t("app.history.title")}</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Month Selector */}
            <View style={styles.monthSelector}>
                <FlatList
                    data={monthFilterOptions}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.monthList}
                    keyExtractor={(item) => item.toISOString()}
                    renderItem={({ item }) => {
                        const isSelected = isSameMonth(item, selectedMonth);
                        return (
                            <Pressable 
                                onPress={() => setSelectedMonth(item)}
                                style={[
                                    styles.monthTab, 
                                    isSelected && { borderBottomColor: colors.tint }
                                ]}
                            >
                                <Text style={[
                                    styles.monthTabText, 
                                    { color: isSelected ? colors.text : colors.secondaryText },
                                    isSelected && styles.activeMonthText
                                ]}>
                                    {format(item, "MMM yyyy")}
                                </Text>
                            </Pressable>
                        );
                    }}
                />
            </View>

            {loading && workouts.length === 0 ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.tint} />
                </View>
            ) : (
                <FlatList
                    data={workouts}
                    renderItem={renderWorkoutItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
                    ListHeaderComponent={renderInsights}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Ionicons name="calendar-outline" size={64} color={colors.border} />
                            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                                {t("app.history.no_workouts")}
                            </Text>
                        </View>
                    }
                />
            )}
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
        paddingBottom: 10,
        borderBottomWidth: 1,
    },
    backBtn: { width: 40, height: 40, justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "700" },
    
    monthSelector: {
        height: 50,
        borderBottomWidth: 1,
        borderBottomColor: "rgba(0,0,0,0.05)",
    },
    monthList: { paddingHorizontal: 16 },
    monthTab: {
        justifyContent: "center",
        paddingHorizontal: 16,
        borderBottomWidth: 2,
        borderBottomColor: "transparent",
    },
    monthTabText: { fontSize: 14, fontWeight: "600" },
    activeMonthText: { fontWeight: "800" },

    insightsCard: {
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 16,
    },
    insightsHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    insightsTitle: {
        fontSize: 14,
        fontWeight: "800",
        fontFamily: "System",
    },
    liveBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        backgroundColor: "rgba(255,59,48,0.1)",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    liveDot: {
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: "#FF3B30",
    },
    liveText: {
        fontSize: 9,
        fontWeight: "900",
        color: "#FF3B30",
    },
    insightsGrid: {
        flexDirection: "row",
        alignItems: "center",
    },
    insightItem: {
        flex: 1,
    },
    insightLabel: {
        fontSize: 10,
        fontWeight: "700",
        textTransform: "uppercase",
        marginBottom: 4,
    },
    insightValue: {
        fontSize: 20,
        fontWeight: "900",
        fontFamily: "System",
    },
    insightUnit: {
        fontSize: 12,
        fontWeight: "600",
        opacity: 0.6,
    },
    deltaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        marginTop: 2,
    },
    deltaText: {
        fontSize: 11,
        fontWeight: "800",
    },
    projectionText: {
        fontSize: 10,
        fontWeight: "600",
        marginTop: 4,
        fontStyle: "italic",
    },
    dividerVertical: {
        width: 1,
        height: "80%",
        marginHorizontal: 16,
    },
    splitSection: {
        marginTop: 20,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: "rgba(128,128,128,0.1)",
    },
    splitList: {
        gap: 8,
    },
    splitItem: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
    },
    splitMeta: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    splitDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    splitName: {
        fontSize: 12,
        fontWeight: "700",
    },
    splitValue: {
        fontSize: 11,
        fontWeight: "600",
    },

    listContent: { padding: 16, gap: 12 },
    workoutCard: {
        flexDirection: "row",
        alignItems: "center",
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    dateBadge: {
        width: 45,
        alignItems: "center",
        marginRight: 16,
    },
    dayNum: { fontSize: 18, fontWeight: "800" },
    dayName: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },

    workoutInfo: { flex: 1 },
    workoutTitle: { fontSize: 16, fontWeight: "700", marginBottom: 4 },
    workoutMeta: { flexDirection: "row", alignItems: "center" },
    metaText: { fontSize: 12, marginLeft: 4 },
    dot: { width: 3, height: 3, borderRadius: 1.5, marginHorizontal: 8 },

    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    emptyState: { flex: 1, justifyContent: "center", alignItems: "center", marginTop: 100 },
    emptyText: { marginTop: 16, fontSize: 16, fontWeight: "600" },
});

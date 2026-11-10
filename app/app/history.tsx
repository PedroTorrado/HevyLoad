import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator,
    Animated,
    Easing,
    FlatList,
    Platform,
    Pressable,
    StyleProp,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import {
    eachMonthOfInterval,
    endOfMonth,
    format,
    isSameMonth,
    startOfMonth,
    subMonths,
} from "date-fns";

interface Workout {
    id: string;
    title: string;
    start_time: string;
    end_time: string | null;
    description: string | null;
    sets_count?: number;
}

const USE_NATIVE_DRIVER = Platform.OS !== "web";

function FadeInView({
    delay = 0,
    style,
    children,
}: {
    delay?: number;
    style?: StyleProp<ViewStyle>;
    children: ReactNode;
}) {
    const progress = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.timing(progress, {
            toValue: 1,
            duration: 350,
            delay,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: USE_NATIVE_DRIVER,
        }).start();
    }, [delay, progress]);

    return (
        <Animated.View
            style={[
                style,
                {
                    opacity: progress,
                    transform: [
                        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                    ],
                },
            ]}
        >
            {children}
        </Animated.View>
    );
}

function ScalePressable({
    onPress,
    style,
    children,
    accessibilityLabel,
}: {
    onPress?: () => void;
    style?: StyleProp<ViewStyle>;
    children: ReactNode;
    accessibilityLabel?: string;
}) {
    const scale = useRef(new Animated.Value(1)).current;
    const animateTo = (toValue: number) =>
        Animated.spring(scale, { toValue, friction: 6, tension: 220, useNativeDriver: USE_NATIVE_DRIVER }).start();

    return (
        <Pressable
            onPress={onPress}
            onPressIn={() => animateTo(0.98)}
            onPressOut={() => animateTo(1)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
        >
            <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
        </Pressable>
    );
}

export default function History() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(false);
    const [workouts, setWorkouts] = useState<Workout[]>([]);
    const [selectedMonth, setSelectedMonth] = useState(new Date());
    const [comparisonData, setComparisonData] = useState<{
        prevMonthWorkouts: number;
        prevMonthSets: number;
        currMonthSets: number;
        trainingSplit: Record<string, number>;
    } | null>(null);

    const monthFilterOptions = eachMonthOfInterval({
        start: subMonths(new Date(), 11),
        end: new Date(),
    }).reverse();

    if (!monthFilterOptions.some((month) => isSameMonth(month, selectedMonth))) {
        monthFilterOptions.push(selectedMonth);
        monthFilterOptions.sort((a, b) => b.getTime() - a.getTime());
    }

    useFocusEffect(
        useCallback(() => {
            let isMounted = true;

            async function loadWorkouts() {
                if (workouts.length === 0) setLoading(true);
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const user = session?.user;
                    if (!user || !isMounted) {
                        if (isMounted) setLoading(false);
                        return;
                    }

                    const monthStart = startOfMonth(selectedMonth).toISOString();
                    const monthEnd = endOfMonth(selectedMonth).toISOString();
                    const prevMonth = subMonths(selectedMonth, 1);
                    const prevStart = startOfMonth(prevMonth).toISOString();
                    const prevEnd = endOfMonth(prevMonth).toISOString();

                    const [currentRes, previousRes] = await Promise.all([
                        supabase
                            .from("workouts")
                            .select("id, title, start_time, end_time, description")
                            .eq("user_id", user.id)
                            .gte("start_time", monthStart)
                            .lte("start_time", monthEnd)
                            .order("start_time", { ascending: false }),
                        supabase
                            .from("workouts")
                            .select("id, sets(count)")
                            .eq("user_id", user.id)
                            .gte("start_time", prevStart)
                            .lte("start_time", prevEnd),
                    ]);

                    if (!isMounted) return;

                    if (currentRes.error) {
                        console.error("Error loading current workouts:", currentRes.error);
                        setWorkouts([]);
                        setComparisonData(null);
                        return;
                    }

                    let currentSets: any[] = [];
                    const currentWorkoutIds = (currentRes.data || []).map((workout) => workout.id);

                    if (currentWorkoutIds.length > 0) {
                        const setsRes = await supabase
                            .from("sets")
                            .select("workout_id, exercise:exercises(muscle_group)")
                            .in("workout_id", currentWorkoutIds);

                        if (!setsRes.error && setsRes.data) {
                            currentSets = setsRes.data;
                        }
                    } else {
                        const latestRes = await supabase
                            .from("workouts")
                            .select("start_time")
                            .eq("user_id", user.id)
                            .order("start_time", { ascending: false })
                            .limit(1)
                            .maybeSingle();

                        if (latestRes.data && isMounted) {
                            const latestMonth = startOfMonth(new Date(latestRes.data.start_time));
                            if (!isSameMonth(latestMonth, selectedMonth)) {
                                setSelectedMonth(latestMonth);
                                return;
                            }
                        }
                    }

                    if (!isMounted) return;

                    const split: Record<string, number> = {};
                    const formattedWorkouts = (currentRes.data || []).map((w: any) => {
                        let sCount = 0;
                        currentSets
                            .filter((set) => set.workout_id === w.id)
                            .forEach((set: any) => {
                                sCount += 1;
                                const muscleGroup = Array.isArray(set.exercise)
                                    ? set.exercise[0]?.muscle_group
                                    : set.exercise?.muscle_group;
                                const mg = muscleGroup || "Other";
                                split[mg] = (split[mg] || 0) + 1;
                            });
                        return { ...w, sets_count: sCount };
                    });

                    setWorkouts(formattedWorkouts);

                    const previousWorkouts = previousRes.data || [];
                    setComparisonData({
                        prevMonthWorkouts: previousWorkouts.length,
                        prevMonthSets: previousWorkouts.reduce(
                            (acc: number, w: any) => acc + (Number(w.sets?.[0]?.count) || 0),
                            0
                        ),
                        currMonthSets: formattedWorkouts.reduce((acc, w) => acc + (w.sets_count || 0), 0),
                        trainingSplit: split,
                    });
                } catch (error: any) {
                    if (!error?.message?.includes("aborted")) {
                        console.error("History load error:", error);
                    }
                    if (isMounted) {
                        setWorkouts([]);
                        setComparisonData(null);
                    }
                } finally {
                    if (isMounted) setLoading(false);
                }
            }

            loadWorkouts();

            return () => {
                isMounted = false;
            };
        }, [selectedMonth])
    );

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    };

    function getMuscleColor(mg: string) {
        const muscleColors: Record<string, string> = {
            Chest: "#60A5FA",
            Back: "#34D399",
            Legs: "#F472B6",
            Shoulders: "#A78BFA",
            Arms: "#FBBF24",
            Other: "#9CA3AF",
        };
        return muscleColors[mg] || muscleColors["Other"];
    }

    const renderInsights = () => {
        if (!comparisonData) return null;

        const isCurrentMonth = isSameMonth(selectedMonth, new Date());
        const today = new Date();
        const daysInMonth = 30;
        const daysElapsed = isCurrentMonth ? Math.max(1, today.getDate()) : daysInMonth;

        const workoutsCount = workouts.length;
        const setsCount = comparisonData.currMonthSets;

        const workoutPace = (workoutsCount / daysElapsed) * 7;
        const prevWorkoutPace = (comparisonData.prevMonthWorkouts / 30) * 7;
        const workoutChange = prevWorkoutPace > 0 ? ((workoutPace - prevWorkoutPace) / prevWorkoutPace) * 100 : 0;

        const setPace = (setsCount / daysElapsed) * 7;
        const prevSetPace = (comparisonData.prevMonthSets / 30) * 7;
        const setChange = prevSetPace > 0 ? ((setPace - prevSetPace) / prevSetPace) * 100 : 0;

        const project = (val: number) => Math.round((val / daysElapsed) * 30);

        return (
            <FadeInView delay={50} style={styles.insightsWrapper}>
                <View style={[styles.insightsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.insightsHeader}>
                        <View style={styles.insightsTitleRow}>
                            <View style={[styles.insightsIcon, { backgroundColor: colors.tint + "1F" }]}>
                                <Ionicons name="analytics" size={15} color={colors.tint} />
                            </View>
                            <Text style={[styles.insightsTitle, { color: colors.text }]}>
                                {t("app.history_insights.title")}
                            </Text>
                        </View>

                        {isCurrentMonth && (
                            <View style={[styles.liveBadge, { backgroundColor: colors.tint + "18", borderColor: colors.tint + "35" }]}>
                                <View style={[styles.liveDot, { backgroundColor: colors.tint }]} />
                                <Text style={[styles.liveText, { color: colors.tint }]}>
                                    {t("app.history_insights.live")}
                                </Text>
                            </View>
                        )}
                    </View>

                    <View style={styles.insightsGrid}>
                        {/* Consistency */}
                        <View style={styles.insightItem}>
                            <Text style={[styles.insightLabel, { color: colors.secondaryText }]}>
                                {t("app.history_insights.consistency")}
                            </Text>
                            <Text style={[styles.insightValue, { color: colors.text }]}>
                                {workoutPace.toFixed(1)}
                                <Text style={[styles.insightUnit, { color: colors.secondaryText }]}> /wk</Text>
                            </Text>
                            <View style={styles.deltaRow}>
                                <Ionicons
                                    name={workoutChange >= 0 ? "arrow-up" : "arrow-down"}
                                    size={11}
                                    color={workoutChange >= 0 ? colors.tint : colors.error}
                                />
                                <Text style={[styles.deltaText, { color: workoutChange >= 0 ? colors.tint : colors.error }]}>
                                    {Math.abs(workoutChange).toFixed(0)}%
                                </Text>
                            </View>
                            {isCurrentMonth && (
                                <Text style={[styles.projectionText, { color: colors.secondaryText }]}>
                                    {t("app.history_insights.projection_workouts", { count: project(workoutsCount) })}
                                </Text>
                            )}
                        </View>

                        <View style={[styles.dividerVertical, { backgroundColor: colors.border }]} />

                        {/* Volume */}
                        <View style={styles.insightItem}>
                            <Text style={[styles.insightLabel, { color: colors.secondaryText }]}>
                                {t("app.history_insights.volume")}
                            </Text>
                            <Text style={[styles.insightValue, { color: colors.text }]}>
                                {setPace.toFixed(0)}
                                <Text style={[styles.insightUnit, { color: colors.secondaryText }]}> /wk</Text>
                            </Text>
                            <View style={styles.deltaRow}>
                                <Ionicons
                                    name={setChange >= 0 ? "arrow-up" : "arrow-down"}
                                    size={11}
                                    color={setChange >= 0 ? colors.tint : colors.error}
                                />
                                <Text style={[styles.deltaText, { color: setChange >= 0 ? colors.tint : colors.error }]}>
                                    {Math.abs(setChange).toFixed(0)}%
                                </Text>
                            </View>
                            {isCurrentMonth && (
                                <Text style={[styles.projectionText, { color: colors.secondaryText }]}>
                                    {t("app.history_insights.projection_sets", { count: project(setsCount) })}
                                </Text>
                            )}
                        </View>
                    </View>

                    {/* Split */}
                    {Object.keys(comparisonData.trainingSplit).length > 0 && (
                        <View style={[styles.splitSection, { borderTopColor: colors.border + "80" }]}>
                            <Text style={[styles.splitSectionTitle, { color: colors.secondaryText }]}>
                                {t("app.history_insights.training_split")}
                            </Text>
                            <View style={styles.splitList}>
                                {Object.entries(comparisonData.trainingSplit)
                                    .sort((a, b) => b[1] - a[1])
                                    .map(([mg, count]) => {
                                        const pct = setsCount > 0 ? Math.round((count / setsCount) * 100) : 0;
                                        const dotColor = getMuscleColor(mg);
                                        return (
                                            <View key={mg} style={styles.splitItem}>
                                                <View style={styles.splitMeta}>
                                                    <View style={[styles.splitDot, { backgroundColor: dotColor }]} />
                                                    <Text style={[styles.splitName, { color: colors.text }]}>{mg}</Text>
                                                </View>
                                                <Text style={[styles.splitValue, { color: colors.secondaryText }]}>
                                                    {count} sets · {pct}%
                                                </Text>
                                            </View>
                                        );
                                    })}
                            </View>
                        </View>
                    )}
                </View>
            </FadeInView>
        );
    };

    const renderWorkoutItem = ({ item, index }: { item: Workout; index: number }) => {
        const startTime = new Date(item.start_time);
        const dayName = format(startTime, "EEE");
        const dayNum = format(startTime, "d");
        const timeStr = format(startTime, "HH:mm");

        return (
            <FadeInView delay={Math.min(300, index * 40)}>
                <ScalePressable
                    onPress={() => router.push(`/app/workout/${item.id}` as any)}
                    style={[styles.workoutCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    accessibilityLabel={item.title}
                >
                    <View style={[styles.dateBadge, { backgroundColor: colors.tint + "12", borderColor: colors.tint + "28" }]}>
                        <Text style={[styles.dayNum, { color: colors.tint }]}>{dayNum}</Text>
                        <Text style={[styles.dayName, { color: colors.tint }]}>{dayName}</Text>
                    </View>

                    <View style={styles.workoutInfo}>
                        <Text style={[styles.workoutTitle, { color: colors.text }]} numberOfLines={1}>
                            {item.title || t("app.history.default_title")}
                        </Text>
                        <View style={styles.workoutMeta}>
                            <Ionicons name="time-outline" size={13} color={colors.secondaryText} />
                            <Text style={[styles.metaText, { color: colors.secondaryText }]}>{timeStr}</Text>

                            {typeof item.sets_count === "number" && (
                                <>
                                    <View style={[styles.metaDot, { backgroundColor: colors.border }]} />
                                    <Ionicons name="layers-outline" size={13} color={colors.secondaryText} />
                                    <Text style={[styles.metaText, { color: colors.secondaryText }]}>
                                        {item.sets_count} {t("app.workout.sets")}
                                    </Text>
                                </>
                            )}

                            {item.description ? (
                                <>
                                    <View style={[styles.metaDot, { backgroundColor: colors.border }]} />
                                    <Text style={[styles.metaText, styles.metaDesc, { color: colors.secondaryText }]} numberOfLines={1}>
                                        {item.description}
                                    </Text>
                                </>
                            ) : null}
                        </View>
                    </View>

                    <Ionicons name="chevron-forward" size={16} color={colors.secondaryText} />
                </ScalePressable>
            </FadeInView>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable 
                    onPress={handleBack} 
                    style={styles.backBtn} 
                    accessibilityRole="button"
                    accessibilityLabel={t("common.back")}
                >
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>

                <View style={styles.headerInfo}>
                    <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                        {t("app.history.title")}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
                        {format(selectedMonth, "MMMM yyyy")} · {workouts.length} {workouts.length === 1 ? "workout" : "workouts"}
                    </Text>
                </View>

                <View style={styles.backBtn} />
            </View>

            {/* Horizontal Month Bar */}
            <View style={[styles.monthSelector, { borderBottomColor: colors.border }]}>
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
                                    isSelected && { borderBottomColor: colors.tint },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.monthTabText,
                                        { color: isSelected ? colors.text : colors.secondaryText },
                                        isSelected && styles.activeMonthText,
                                    ]}
                                >
                                    {format(item, "MMM yyyy")}
                                </Text>
                            </Pressable>
                        );
                    }}
                />
            </View>

            {loading && workouts.length === 0 ? (
                <View style={[styles.center, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.tint} />
                </View>
            ) : (
                <FlatList
                    data={workouts}
                    renderItem={renderWorkoutItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}
                    ListHeaderComponent={renderInsights}
                    ListEmptyComponent={
                        <FadeInView style={styles.emptyState}>
                            <View style={[styles.emptyIconCircle, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Ionicons name="calendar-outline" size={36} color={colors.secondaryText} />
                            </View>
                            <Text style={[styles.emptyTitle, { color: colors.text }]}>
                                {t("app.history.no_workouts")}
                            </Text>
                            <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
                                {format(selectedMonth, "MMMM yyyy")}
                            </Text>

                            {!isSameMonth(selectedMonth, new Date()) && (
                                <Pressable
                                    onPress={() => setSelectedMonth(new Date())}
                                    style={[styles.emptyActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                                    accessibilityRole="button"
                                    accessibilityLabel="View Current Month"
                                >
                                    <Text style={[styles.emptyActionText, { color: colors.tint }]}>
                                        View Current Month
                                    </Text>
                                </Pressable>
                            )}
                        </FadeInView>
                    }
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },

    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    backBtn: { 
        width: 40, 
        height: 40, 
        justifyContent: "center", 
        alignItems: "center" 
    },
    headerInfo: { 
        flex: 1, 
        alignItems: "center", 
        paddingHorizontal: 8 
    },
    headerTitle: { 
        fontSize: 16, 
        fontWeight: "800", 
        fontFamily: "System" 
    },
    headerSubtitle: { 
        fontSize: 12, 
        fontWeight: "600", 
        fontFamily: "System", 
        marginTop: 1 
    },

    monthSelector: {
        height: 48,
        borderBottomWidth: 1,
    },
    monthList: { paddingHorizontal: 12 },
    monthTab: {
        justifyContent: "center",
        paddingHorizontal: 14,
        borderBottomWidth: 2,
        borderBottomColor: "transparent",
    },
    monthTabText: { fontSize: 13, fontWeight: "700", fontFamily: "System" },
    activeMonthText: { fontWeight: "900" },

    listContent: {
        padding: 16,
        width: "100%",
        maxWidth: 920,
        alignSelf: "center",
        gap: 10,
    },

    insightsWrapper: { marginBottom: 6 },
    insightsCard: {
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    insightsHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    insightsTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    insightsIcon: {
        width: 26,
        height: 26,
        borderRadius: 8,
        justifyContent: "center",
        alignItems: "center",
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
        paddingHorizontal: 7,
        paddingVertical: 3,
        borderRadius: 6,
        borderWidth: 1,
    },
    liveDot: {
        width: 5,
        height: 5,
        borderRadius: 2.5,
    },
    liveText: {
        fontSize: 9,
        fontWeight: "900",
        letterSpacing: 0.5,
        fontFamily: "System",
        textTransform: "uppercase",
    },
    insightsGrid: {
        flexDirection: "row",
        alignItems: "flex-start",
    },
    insightItem: { flex: 1 },
    insightLabel: {
        fontSize: 9,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 4,
        fontFamily: "System",
    },
    insightValue: {
        fontSize: 20,
        fontWeight: "900",
        fontFamily: "System",
        letterSpacing: -0.5,
    },
    insightUnit: {
        fontSize: 12,
        fontWeight: "700",
    },
    deltaRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        marginTop: 4,
    },
    deltaText: {
        fontSize: 11,
        fontWeight: "800",
        fontFamily: "System",
    },
    projectionText: {
        fontSize: 11,
        fontWeight: "600",
        marginTop: 4,
        fontFamily: "System",
    },
    dividerVertical: {
        width: 1,
        alignSelf: "stretch",
        marginHorizontal: 16,
        opacity: 0.7,
    },

    splitSection: {
        marginTop: 16,
        paddingTop: 14,
        borderTopWidth: 1,
    },
    splitSectionTitle: {
        fontSize: 9,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 10,
        fontFamily: "System",
    },
    splitList: { gap: 8 },
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
        fontSize: 13,
        fontWeight: "700",
        fontFamily: "System",
    },
    splitValue: {
        fontSize: 12,
        fontWeight: "600",
        fontFamily: "System",
    },

    workoutCard: {
        flexDirection: "row",
        alignItems: "center",
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        gap: 12,
    },
    dateBadge: {
        width: 44,
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    dayNum: { fontSize: 16, fontWeight: "900", fontFamily: "System", lineHeight: 18 },
    dayName: {
        fontSize: 9,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        fontFamily: "System",
    },

    workoutInfo: { flex: 1 },
    workoutTitle: { fontSize: 15, fontWeight: "800", fontFamily: "System", marginBottom: 3 },
    workoutMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
    metaText: { fontSize: 12, fontWeight: "600", fontFamily: "System" },
    metaDesc: { maxWidth: 140 },
    metaDot: { width: 3, height: 3, borderRadius: 1.5, marginHorizontal: 2 },

    emptyState: {
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 56,
        gap: 6,
    },
    emptyIconCircle: {
        width: 68,
        height: 68,
        borderRadius: 34,
        borderWidth: 1,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 8,
    },
    emptyTitle: { fontSize: 15, fontWeight: "800", fontFamily: "System" },
    emptySubtitle: { fontSize: 13, fontWeight: "600", fontFamily: "System" },
    emptyActionBtn: {
        marginTop: 14,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 12,
        borderWidth: 1,
    },
    emptyActionText: {
        fontSize: 13,
        fontWeight: "700",
        fontFamily: "System",
    },
});
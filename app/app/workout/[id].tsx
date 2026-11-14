import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator,
    Animated,
    Easing,
    Platform,
    Pressable,
    ScrollView,
    StyleProp,
    StyleSheet,
    Text,
    View,
    ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { useThemeColor } from "../../../lib/theme";
import { format } from "date-fns";
import Svg, { Polyline } from "react-native-svg";
import type { RoutePoint } from "../../../lib/route";

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
    route_data: RoutePoint[] | null;
    activity_data: {
        averageHeartRate?: number | null;
        maxHeartRate?: number | null;
        averageSpeed?: number | null;
        maxSpeed?: number | null;
        distanceKm?: number | null;
        durationSeconds?: number | null;
        splits?: { kilometer: number; pace: string }[];
    } | null;
}

const GOLD = "#FFD700";
const USE_NATIVE_DRIVER = Platform.OS !== "web";

/** Fades + slides its children in on mount, optionally after a delay (used for staggered cards). */
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
            duration: 380,
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
                        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                    ],
                },
            ]}
        >
            {children}
        </Animated.View>
    );
}

/** Small PR pill that pops in with a spring. */
function PrBadge({ label, color, delay = 0 }: { label: string; color: string; delay?: number }) {
    const scale = useRef(new Animated.Value(0.6)).current;
    const opacity = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.parallel([
            Animated.spring(scale, {
                toValue: 1,
                friction: 5,
                tension: 140,
                delay,
                useNativeDriver: USE_NATIVE_DRIVER,
            }),
            Animated.timing(opacity, {
                toValue: 1,
                duration: 220,
                delay,
                useNativeDriver: USE_NATIVE_DRIVER,
            }),
        ]).start();
    }, [delay, opacity, scale]);

    return (
        <Animated.View
            style={[
                styles.prBadge,
                { backgroundColor: color + "20", borderColor: color + "55", opacity, transform: [{ scale }] },
            ]}
        >
            <Ionicons name="trophy" size={8} color={color} />
            <Text style={[styles.prBadgeText, { color }]}>{label}</Text>
        </Animated.View>
    );
}

/** Pressable that gently scales down while pressed. */
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
            onPressIn={() => animateTo(0.97)}
            onPressOut={() => animateTo(1)}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
        >
            <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
        </Pressable>
    );
}

function formatDuration(start: string, end: string | null): string | null {
    if (!end) return null;
    const minutes = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000);
    if (!isFinite(minutes) || minutes <= 0) return null;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function getSetTypeMarker(setType: string | null | undefined, errorColor: string) {
    switch ((setType ?? "normal").toLowerCase()) {
        case "warmup":
            return { label: "W", color: "#FF9F0A" };
        case "dropset":
            return { label: "D", color: "#BF5AF2" };
        case "failure":
            return { label: "F", color: errorColor };
        default:
            return null;
    }
}

function formatPace(distanceKm: number, durationSeconds: number): string | null {
    if (!distanceKm || distanceKm <= 0 || !durationSeconds || durationSeconds <= 0) return null;
    const secondsPerKm = durationSeconds / distanceKm;
    return `${Math.floor(secondsPerKm / 60)}:${String(Math.round(secondsPerKm % 60)).padStart(2, "0")} /km`;
}

function RouteMap({ route, color }: { route: RoutePoint[]; color: string }) {
    if (route.length < 2) return null;
    const width = 340;
    const height = 220;
    const latitudes = route.map((point) => point.latitude);
    const longitudes = route.map((point) => point.longitude);
    const minLat = Math.min(...latitudes);
    const maxLat = Math.max(...latitudes);
    const minLon = Math.min(...longitudes);
    const maxLon = Math.max(...longitudes);
    const latRange = maxLat - minLat || 0.0001;
    const lonRange = maxLon - minLon || 0.0001;
    const points = route
        .filter((_, index) => index % Math.max(1, Math.ceil(route.length / 500)) === 0)
        .map((point) => `${((point.longitude - minLon) / lonRange) * (width - 24) + 12},${height - (((point.latitude - minLat) / latRange) * (height - 24) + 12)}`)
        .join(" ");
    return (
        <View style={styles.routeCard}>
            <Text style={styles.routeTitle}>GPS route</Text>
            <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
                <Polyline points={points} fill="none" stroke={color} strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
            </Svg>
        </View>
    );
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
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setLoading(false);
            return;
        }
        
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
                
                // Fetch history for these exercises (paginated)
                let historyData: any[] = [];
                let hRangeStart = 0;
                const hRangeStep = 1000;
                let hHasMore = true;

                while (hHasMore) {
                    const { data, error } = await supabase
                        .from("sets")
                        .select(`
                            weight_kg,
                            reps,
                            exercise_id,
                            workouts!inner(start_time)
                        `)
                        .in("exercise_id", exerciseIds)
                        .lt("workouts.start_time", workoutData.start_time)
                        .range(hRangeStart, hRangeStart + hRangeStep - 1);

                    if (error) break;
                    if (data && data.length > 0) {
                        historyData = [...historyData, ...data];
                        if (data.length < hRangeStep) hHasMore = false;
                        else hRangeStart += hRangeStep;
                    } else {
                        hHasMore = false;
                    }
                }

                const historyMap: Record<string, { max1RM: number, maxWeight: number }> = {};
                historyData.forEach(h => {
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
                <Ionicons name="barbell-outline" size={40} color={colors.secondaryText} />
                <Text style={[styles.emptyText, { color: colors.text }]}>{t("app.workout.not_found")}</Text>
                <Pressable
                    onPress={handleBack}
                    style={[styles.emptyBackBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                >
                    <Text style={[styles.emptyBackText, { color: colors.tint }]}>{t("common.back")}</Text>
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
    const durationStr = formatDuration(workout.start_time, workout.end_time);

    const totalVolume = Math.round(
        sets.reduce((sum, s) => sum + (s.weight_kg ?? 0) * (s.reps ?? 0), 0)
    );
    const distanceKm = sets.reduce((sum, s) => sum + (s.distance_km ?? 0), 0) || Number(workout.activity_data?.distanceKm ?? 0);
    const durationSeconds = sets.reduce((sum, s) => sum + (s.duration_s ?? 0), 0) || Number(workout.activity_data?.durationSeconds ?? 0);
    const averagePace = formatPace(distanceKm, durationSeconds);
    const activityData = workout.activity_data;
    const isRunningWorkout = Boolean(
        workout.route_data?.length
        || distanceKm > 0
        || /run|running|corrida/i.test(workout.title)
        || sets.some((set) => /run|running|corrida/i.test(set.exercise?.name ?? "")),
    );
    const prCount = sets.filter(s => s.isPR || s.isWeightPR).length;

    const summaryStats = [
        durationStr
            ? { key: "duration", icon: "time-outline" as const, label: t("app.workout.duration"), value: durationStr }
            : { key: "start", icon: "time-outline" as const, label: t("app.workout.start"), value: timeStr },
        isRunningWorkout
            ? { key: "distance", icon: "navigate-outline" as const, label: "Distance", value: `${distanceKm.toFixed(2)} km` }
            : { key: "volume", icon: "barbell-outline" as const, label: t("app.workout.volume"), value: `${totalVolume.toLocaleString()} kg` },
        ...(averagePace ? [{ key: "pace", icon: "speedometer-outline" as const, label: "Avg pace", value: averagePace }] : []),
        ...(activityData?.averageHeartRate ? [{ key: "heart", icon: "heart-outline" as const, label: "Avg heart rate", value: `${Math.round(activityData.averageHeartRate)} bpm` }] : []),
        ...(isRunningWorkout
            ? []
            : [
                { key: "sets", icon: "layers-outline" as const, label: t("app.workout.sets"), value: `${sets.length}` },
                { key: "prs", icon: "trophy-outline" as const, label: t("app.workout.prs"), value: `${prCount}`, highlight: prCount > 0 },
            ]),
    ];

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn} accessibilityLabel={t("common.back")}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>

                <View style={styles.headerInfo}>
                    <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                        {workout.title || t("app.workout.default_title")}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
                        {dateStr} · {timeStr}
                    </Text>
                </View>

                {/* Spacer keeps the title centred */}
                <View style={styles.backBtn} />
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}>
                {/* Summary stats */}
                <View style={styles.statsGrid}>
                    {summaryStats.map((stat, i) => (
                        <FadeInView
                            key={stat.key}
                            delay={i * 50}
                            style={[
                                styles.statCard,
                                stat.highlight
                                    ? { backgroundColor: GOLD + "15", borderColor: GOLD + "40" }
                                    : { backgroundColor: colors.card, borderColor: colors.border },
                            ]}
                        >
                            <Ionicons
                                name={stat.icon}
                                size={16}
                                color={stat.highlight ? GOLD : colors.secondaryText}
                                style={styles.statIcon}
                            />
                            <Text style={[styles.statValue, { color: stat.highlight ? GOLD : colors.text }]}>
                                {stat.value}
                            </Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{stat.label}</Text>
                        </FadeInView>
                    ))}
                </View>

                {workout.route_data && workout.route_data.length > 1 && (
                    <FadeInView delay={180}>
                        <RouteMap route={workout.route_data} color={colors.tint} />
                    </FadeInView>
                )}
                {isRunningWorkout && activityData && (
                    <View style={[styles.runMetricsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {activityData.maxHeartRate ? <Text style={[styles.runMetricText, { color: colors.text }]}>Max heart rate: {Math.round(activityData.maxHeartRate)} bpm</Text> : null}
                        {activityData.averageSpeed ? <Text style={[styles.runMetricText, { color: colors.text }]}>Average speed: {Number(activityData.averageSpeed).toFixed(2)} m/s</Text> : null}
                        {activityData.maxSpeed ? <Text style={[styles.runMetricText, { color: colors.text }]}>Max speed: {Number(activityData.maxSpeed).toFixed(2)} m/s</Text> : null}
                        {activityData.splits?.length ? <Text style={[styles.runMetricText, { color: colors.text }]}>Splits: {activityData.splits.map((split) => `${split.kilometer} km ${split.pace}`).join(" · ")}</Text> : null}
                    </View>
                )}

                {/* Notes */}
                {workout.description ? (
                    <FadeInView
                        delay={200}
                        style={[styles.notesCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    >
                        <View style={[styles.notesAccent, { backgroundColor: colors.tint }]} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.notesLabel, { color: colors.secondaryText }]}>
                                {t("app.workout.notes")}
                            </Text>
                            <Text style={[styles.notesText, { color: colors.text }]}>{workout.description}</Text>
                        </View>
                    </FadeInView>
                ) : null}

                {!isRunningWorkout && <Text style={[styles.sectionTitle, { color: colors.accentText }]}>
                    {t("app.workout.exercises")} · {Object.keys(groupedSets).length}
                </Text>}

                {!isRunningWorkout && Object.entries(groupedSets).map(([exerciseName, exerciseSets], exIndex) => {
                    const exercise = exerciseSets[0]?.exercise;
                    const cardDelay = 250 + exIndex * 70;
                    let workingSetNumber = 0;

                    return (
                        <FadeInView key={exerciseName} delay={cardDelay} style={styles.exerciseWrapper}>
                            <View style={[styles.exerciseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <ScalePressable
                                    onPress={() => exercise && router.push(`/app/exercise/${exercise.id}` as any)}
                                    style={[styles.exerciseHeader, { borderBottomColor: colors.border }]}
                                    accessibilityLabel={exerciseName}
                                >
                                    <View style={[styles.exerciseIcon, { backgroundColor: colors.tint + "1F" }]}>
                                        <Ionicons name="barbell" size={16} color={colors.tint} />
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={[styles.exerciseTitle, { color: colors.text }]} numberOfLines={1}>
                                            {exerciseName}
                                        </Text>
                                        {exercise?.muscle_group ? (
                                            <Text style={[styles.muscleGroup, { color: colors.secondaryText }]}>
                                                {exercise.muscle_group}
                                            </Text>
                                        ) : null}
                                    </View>
                                    <Ionicons name="chevron-forward" size={16} color={colors.secondaryText} />
                                </ScalePressable>

                                <View style={styles.tableHeader}>
                                    <Text style={[styles.colSet, styles.colLabel, styles.colLabelLeft, { color: colors.secondaryText }]}>{t("app.workout.set")}</Text>
                                    <Text style={[styles.colWeight, styles.colLabel, { color: colors.secondaryText }]}>{t("app.workout.weight")}</Text>
                                    <Text style={[styles.colReps, styles.colLabel, { color: colors.secondaryText }]}>{t("app.workout.reps")}</Text>
                                    <Text style={[styles.colRpe, styles.colLabel, { color: colors.secondaryText }]}>RPE</Text>
                                </View>

                                {exerciseSets.map((set, index) => {
                                    const marker = getSetTypeMarker(set.set_type, colors.error);
                                    if (!marker || marker.label !== "W") workingSetNumber += 1;
                                    const hasPR = set.isPR || set.isWeightPR;
                                    const isLast = index === exerciseSets.length - 1;
                                    const badgeDelay = cardDelay + 250 + index * 40;

                                    return (
                                        <View
                                            key={set.id}
                                            style={[
                                                styles.setRow,
                                                !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border + "80" },
                                                hasPR && { backgroundColor: GOLD + "0D" },
                                            ]}
                                        >
                                            <View style={styles.colSet}>
                                                <View
                                                    style={[
                                                        styles.setNumBadge,
                                                        marker
                                                            ? { backgroundColor: marker.color + "22" }
                                                            : { backgroundColor: colors.secondary },
                                                    ]}
                                                >
                                                    <Text style={[styles.setNumText, { color: marker ? marker.color : colors.text }]}>
                                                        {marker?.label === "W" ? "W" : workingSetNumber}
                                                    </Text>
                                                </View>
                                            </View>

                                            <View style={styles.colWeight}>
                                                <Text style={[styles.setValue, { color: colors.text }]}>
                                                    {set.weight_kg !== null ? set.weight_kg : "-"}
                                                    {set.weight_kg !== null && (
                                                        <Text style={[styles.setUnit, { color: colors.secondaryText }]}> kg</Text>
                                                    )}
                                                </Text>
                                                {set.isWeightPR && (
                                                    <PrBadge label={t("app.workout.weight_pr")} color={colors.tint} delay={badgeDelay} />
                                                )}
                                            </View>

                                            <View style={styles.colReps}>
                                                <Text style={[styles.setValue, { color: colors.text }]}>
                                                    {set.reps !== null ? set.reps : "-"}
                                                </Text>
                                                {set.isPR && (
                                                    <PrBadge label={t("app.workout.one_rm_pr")} color={GOLD} delay={badgeDelay + 60} />
                                                )}
                                            </View>

                                            <View style={styles.colRpe}>
                                                <Text style={[styles.setValue, { color: set.rpe !== null ? colors.text : colors.secondaryText }]}>
                                                    {set.rpe !== null ? set.rpe : "-"}
                                                </Text>
                                            </View>
                                        </View>
                                    );
                                })}
                            </View>
                        </FadeInView>
                    );
                })}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },

    // Header (mirrors exercise detail screen)
    header: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
    headerInfo: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
    headerTitle: { fontSize: 16, fontWeight: "800", fontFamily: "System" },
    headerSubtitle: { fontSize: 12, fontWeight: "600", fontFamily: "System", marginTop: 1 },

    content: {
        padding: 16,
        width: "100%",
        maxWidth: 920,
        alignSelf: "center",
    },

    // Summary stats (mirrors dashboard stat cards)
    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 16 },
    statCard: {
        flex: 1,
        flexBasis: "40%",
        minWidth: 140,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    statIcon: { marginBottom: 10 },
    statValue: { fontSize: 20, fontWeight: "900", fontFamily: "System", letterSpacing: -0.5 },
    statLabel: {
        fontSize: 9,
        fontWeight: "800",
        marginTop: 4,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        fontFamily: "System",
        opacity: 0.8,
    },

    // Notes
    notesCard: {
        flexDirection: "row",
        gap: 12,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: 8,
        overflow: "hidden",
    },
    notesAccent: { width: 3, borderRadius: 2 },
    notesLabel: {
        fontSize: 9,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6,
        fontFamily: "System",
    },
    routeCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#2C2C2E",
        padding: 12,
        marginBottom: 8,
        backgroundColor: "#1C1C1E",
        overflow: "hidden",
    },
    routeTitle: {
        color: "#A1A1AA",
        fontSize: 11,
        fontWeight: "800",
        letterSpacing: 1,
        textTransform: "uppercase",
        marginBottom: 4,
    },
    runMetricsCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 8, gap: 8 },
    runMetricText: { fontSize: 14, fontWeight: "600" },
    notesText: { fontSize: 14, lineHeight: 21, fontWeight: "500", fontFamily: "System" },

    sectionTitle: {
        fontSize: 13,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginTop: 24,
        marginBottom: 16,
        fontFamily: "System",
    },

    // Exercise cards
    exerciseWrapper: { marginBottom: 16 },
    exerciseCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    exerciseHeader: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    exerciseIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: "center",
        alignItems: "center",
    },
    exerciseTitle: { fontSize: 16, fontWeight: "800", fontFamily: "System" },
    muscleGroup: {
        fontSize: 10,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginTop: 2,
        fontFamily: "System",
    },

    // Sets table
    tableHeader: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 6,
    },
    colLabel: {
        fontSize: 9,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 1,
        textAlign: "center",
        fontFamily: "System",
    },
    colLabelLeft: { textAlign: "left" },
    colSet: { width: 44, alignItems: "flex-start" },
    colWeight: { flex: 1, alignItems: "center" },
    colReps: { flex: 1, alignItems: "center" },
    colRpe: { width: 44, alignItems: "center" },

    setRow: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 10,
        paddingHorizontal: 16,
        minHeight: 48,
    },
    setNumBadge: {
        width: 26,
        height: 26,
        borderRadius: 8,
        justifyContent: "center",
        alignItems: "center",
    },
    setNumText: { fontSize: 12, fontWeight: "900", fontFamily: "System" },
    setValue: { fontSize: 15, fontWeight: "800", textAlign: "center", fontFamily: "System" },
    setUnit: { fontSize: 11, fontWeight: "600" },

    // PR pill (mirrors exercise detail prBadge)
    prBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        borderWidth: 1,
        marginTop: 4,
    },
    prBadgeText: { fontSize: 8, fontWeight: "900", letterSpacing: 0.3, fontFamily: "System" },

    // Not-found state
    emptyText: { fontSize: 16, fontWeight: "800", marginTop: 12, fontFamily: "System" },
    emptyBackBtn: {
        marginTop: 20,
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
    },
    emptyBackText: { fontSize: 14, fontWeight: "800", fontFamily: "System" },
});

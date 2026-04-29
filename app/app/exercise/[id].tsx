import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { 
    ActivityIndicator, 
    ScrollView, 
    StyleSheet, 
    Text, 
    View, 
    Pressable,
    Dimensions
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../../lib/supabase";
import { useThemeColor } from "../../../lib/theme";
import { useFocusEffect } from "expo-router";
import { format, parseISO } from "date-fns";
import Svg, { Path, Circle, Line, Defs, LinearGradient, Stop, G, Rect, Text as SvgText } from "react-native-svg";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { 
    useSharedValue, 
    useAnimatedStyle, 
    withSpring, 
    runOnJS 
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";

interface Exercise {
    id: string;
    name: string;
    muscle_group: string | null;
}

interface Set {
    id: string;
    weight_kg: number;
    reps: number;
    start_time: string; // From joined workout
    workout_id: string;
}

export default function ExerciseDetails() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(true);
    const [exercise, setExercise] = useState<Exercise | null>(null);
    const [sets, setSets] = useState<Set[]>([]);
    const [stats, setStats] = useState({
        oneRM: 0,
        bestSet: { weight: 0, reps: 0 },
        totalSets: 0,
        maxWeight: 0
    });

    // Chart Settings
    const [chartMode, setChartMode] = useState<"1rm" | "weight" | "both">("1rm");
    const [timeSpan, setTimeSpan] = useState<"1m" | "6m" | "1y" | "all">("all");
    const [isFeatured, setIsFeatured] = useState(false);

    // Interaction State
    const [activeIndex, setActiveIndex] = useState<number | null>(null);
    const touchX = useSharedValue(0);
    const isInteracting = useSharedValue(false);

    useFocusEffect(
        useCallback(() => {
            loadExerciseData();
        }, [id])
    );

    async function loadExerciseData() {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        
        // Load exercise info and profile (to check featured)
        const [exRes, profileRes] = await Promise.all([
            supabase.from("exercises").select("*").eq("id", id).single(),
            supabase.from("profiles").select("featured_exercise_ids").eq("id", user.id).single()
        ]);

        if (exRes.data) {
            setExercise(exRes.data);
            if (profileRes.data) {
                const featured = (profileRes.data.featured_exercise_ids || []).includes(id as string);
                setIsFeatured(featured);
            }
        }

        // Load all sets for this exercise
        const { data: setsData, count } = await supabase
            .from("sets")
            .select(`
                id,
                weight_kg,
                reps,
                workout_id,
                workouts!inner(start_time)
            `, { count: "exact" })
            .eq("exercise_id", id)
            .order("weight_kg", { ascending: false }) // Prioritize heavy sets for stats
            .limit(10000);

        if (setsData) {
            let formattedSets: Set[] = setsData.map((s: any) => ({
                id: s.id,
                weight_kg: s.weight_kg || 0,
                reps: s.reps || 0,
                workout_id: s.workout_id,
                start_time: s.workouts.start_time
            }));

            // Sort by start_time ascending
            formattedSets.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
            setSets(formattedSets);

            // Calculate stats
            let max1RM = 0;
            let bestWeight = 0;
            let bestRepsForMaxWeight = 0;

            formattedSets.forEach(s => {
                const weight = s.weight_kg;
                const reps = s.reps;
                let oneRM = 0;
                
                if (reps === 1) {
                    oneRM = weight;
                } else if (reps > 1) {
                    oneRM = weight / (1.0278 - (0.0278 * reps));
                }

                if (oneRM > max1RM) max1RM = oneRM;
                if (weight > bestWeight) {
                    bestWeight = weight;
                    bestRepsForMaxWeight = reps;
                }
            });

            setStats({
                oneRM: Math.round(max1RM * 10) / 10,
                bestSet: { weight: bestWeight, reps: bestRepsForMaxWeight },
                totalSets: count || formattedSets.length,
                maxWeight: bestWeight
            });
        }

        setLoading(false);
    }

    // Chart Data Preparation with PR Detection and Filtering
    const chartData = useMemo(() => {
        if (sets.length === 0) return [];

        // First, group ALL sets by date to detect all-time PRs
        const allWorkoutGroups: Record<string, { oneRM: number, weight: number, workout_id: string }> = {};
        
        sets.forEach(s => {
            const date = format(parseISO(s.start_time), "yyyy-MM-dd");
            const weight = s.weight_kg;
            const reps = s.reps;
            let oneRM = 0;
            
            if (reps === 1) {
                oneRM = weight;
            } else if (reps > 1) {
                oneRM = weight / (1.0278 - (0.0278 * reps));
            }
            
            if (!allWorkoutGroups[date]) {
                allWorkoutGroups[date] = { oneRM, weight, workout_id: s.workout_id };
            } else {
                if (oneRM > allWorkoutGroups[date].oneRM) allWorkoutGroups[date].oneRM = oneRM;
                if (weight > allWorkoutGroups[date].weight) allWorkoutGroups[date].weight = weight;
            }
        });

        const allSorted = Object.entries(allWorkoutGroups)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, vals]) => ({ 
                date, 
                ...vals,
                isPR: false,
                isWeightPR: false
            }));

        // Detect PRs (All-time high at that point in time)
        let runningMax1RM = 0;
        let runningMaxWeight = 0;
        allSorted.forEach(d => {
            if (d.oneRM > runningMax1RM) {
                runningMax1RM = d.oneRM;
                d.isPR = true;
            }
            if (d.weight > runningMaxWeight) {
                runningMaxWeight = d.weight;
                d.isWeightPR = true;
            }
        });

        // Now filter the results by timeSpan
        let filteredData = [...allSorted];
        if (timeSpan !== "all") {
            const cutoff = new Date();
            if (timeSpan === "1m") cutoff.setMonth(cutoff.getMonth() - 1);
            else if (timeSpan === "6m") cutoff.setMonth(cutoff.getMonth() - 6);
            else if (timeSpan === "1y") cutoff.setFullYear(cutoff.getFullYear() - 1);
            
            filteredData = allSorted.filter(d => new Date(d.date) >= cutoff);
        }

        return filteredData;
    }, [sets, timeSpan]);

    const chartWidth = Dimensions.get("window").width - 32;
    const chartHeight = 250;
    const padding = 35;

    const { points1RM, pointsWeight, yRange } = useMemo(() => {
        if (chartData.length < 2) return { points1RM: [], pointsWeight: [], yRange: [0, 100] };

        const allVals = [
            ...chartData.map(d => d.oneRM),
            ...chartData.map(d => d.weight)
        ];
        const max = Math.max(...allVals);
        const min = Math.min(...allVals);
        const r = max - min === 0 ? 20 : (max - min) * 1.3;
        const baseMin = Math.max(0, min - (r * 0.15));

        const pts1RM = chartData.map((d, i) => ({
            x: (i / (chartData.length - 1)) * (chartWidth - 2 * padding) + padding,
            y: chartHeight - ((d.oneRM - baseMin) / r) * (chartHeight - 2 * padding) - padding
        }));

        const ptsWeight = chartData.map((d, i) => ({
            x: (i / (chartData.length - 1)) * (chartWidth - 2 * padding) + padding,
            y: chartHeight - ((d.weight - baseMin) / r) * (chartHeight - 2 * padding) - padding
        }));

        return { points1RM: pts1RM, pointsWeight: ptsWeight, yRange: [baseMin, max] };
    }, [chartData, chartWidth]);

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    };

    async function toggleFeatured() {
        if (!exercise) return;

        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data: profile } = await supabase
            .from("profiles")
            .select("featured_exercise_ids")
            .eq("id", user.id)
            .single();

        let currentFeatured = profile?.featured_exercise_ids || [];
        let newFeatured;

        if (currentFeatured.includes(id as string)) {
            newFeatured = currentFeatured.filter((i: string) => i !== id);
        } else {
            newFeatured = [...currentFeatured, id];
        }

        const { error } = await supabase
            .from("profiles")
            .update({ featured_exercise_ids: newFeatured })
            .eq("id", user.id);

        if (!error) {
            setIsFeatured(!isFeatured);
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
    }

    const updateActiveIndex = useCallback((x: number) => {
        if (chartData.length < 2) return;
        
        const availableWidth = chartWidth - 2 * padding;
        const normalizedX = (x - padding) / availableWidth;
        const index = Math.max(0, Math.min(chartData.length - 1, Math.round(normalizedX * (chartData.length - 1))));
        
        setActiveIndex(current => {
            if (current !== index) {
                Haptics.selectionAsync();
                return index;
            }
            return current;
        });
    }, [chartData, chartWidth]);

    const panGesture = useMemo(() => Gesture.Pan()
        .runOnJS(true)
        .onBegin((e) => {
            updateActiveIndex(e.x);
        })
        .onUpdate((e) => {
            updateActiveIndex(e.x);
        }), [updateActiveIndex]);

    const tapGesture = useMemo(() => Gesture.Tap()
        .runOnJS(true)
        .onEnd((e) => {
            updateActiveIndex(e.x);
        }), [updateActiveIndex]);

    const composedGesture = useMemo(() => Gesture.Race(panGesture, tapGesture), [panGesture, tapGesture]);

    const renderChart = () => {
        if (chartData.length < 2) {
            return (
                <View style={[styles.emptyChart, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="stats-chart-outline" size={40} color={colors.border} />
                    <Text style={[styles.emptyChartText, { color: colors.secondaryText }]}>
                        More data needed for progress chart
                    </Text>
                </View>
            );
        }

        const path1RM = `M ${points1RM.map(p => `${p.x},${p.y}`).join(" L ")}`;
        const pathWeight = `M ${pointsWeight.map(p => `${p.x},${p.y}`).join(" L ")}`;
        
        const activeData = activeIndex !== null ? chartData[activeIndex] : null;

        return (
            <GestureHandlerRootView>
                <View style={[styles.chartWrapper, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {/* Time Span Filter */}
                    <View style={styles.filterRow}>
                        {(["1m", "6m", "1y", "all"] as const).map((t) => (
                            <Pressable 
                                key={t} 
                                style={[styles.filterBtn, timeSpan === t && { backgroundColor: colors.tint }]}
                                onPress={() => {
                                    setTimeSpan(t);
                                    setActiveIndex(null);
                                }}
                            >
                                <Text style={[styles.filterBtnText, { color: timeSpan === t ? "#FFF" : colors.secondaryText }]}>
                                    {t.toUpperCase()}
                                </Text>
                            </Pressable>
                        ))}
                    </View>

                    <View style={styles.chartHeader}>
                        <Pressable 
                            style={{ flex: 1 }}
                            onPress={() => activeData && router.push(`/app/workout/${activeData.workout_id}` as any)}
                            disabled={!activeData}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                                <Text style={[styles.chartSub, { color: colors.text }]}>
                                    {activeData 
                                        ? format(parseISO(activeData.date), "MMMM d, yyyy")
                                        : "Drag or Tap chart to view details"}
                                </Text>
                                {activeData && <Ionicons name="chevron-forward" size={12} color={colors.secondaryText} />}
                            </View>
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                                {activeData?.isPR && (chartMode === "1rm" || chartMode === "both") && (
                                    <View style={styles.prBadge}>
                                        <Ionicons name="trophy" size={10} color="#FFD700" />
                                        <Text style={styles.prBadgeText}>NEW 1RM PR</Text>
                                    </View>
                                )}
                                {activeData?.isWeightPR && (chartMode === "weight" || chartMode === "both") && (
                                    <View style={[styles.prBadge, { backgroundColor: "#FF950020" }]}>
                                        <Ionicons name="trophy" size={10} color="#FF9500" />
                                        <Text style={[styles.prBadgeText, { color: "#FF9500" }]}>NEW WEIGHT PR</Text>
                                    </View>
                                )}
                            </View>
                        </Pressable>
                        {activeData && (
                            <Pressable 
                                style={styles.activeValuesRow}
                                onPress={() => router.push(`/app/workout/${activeData.workout_id}` as any)}
                            >
                                {(chartMode === "1rm" || chartMode === "both") && (
                                    <View style={styles.valCol}>
                                        <Text style={[styles.valLabel, { color: colors.secondaryText }]}>EST. 1RM</Text>
                                        <Text style={[styles.activeVal, { color: colors.tint }]}>{Math.round(activeData.oneRM * 10) / 10}kg</Text>
                                    </View>
                                )}
                                {(chartMode === "weight" || chartMode === "both") && (
                                    <View style={styles.valCol}>
                                        <Text style={[styles.valLabel, { color: colors.secondaryText }]}>HEAVIEST</Text>
                                        <Text style={[styles.activeVal, { color: "#5856D6" }]}>{activeData.weight}kg</Text>
                                    </View>
                                )}
                            </Pressable>
                        )}
                    </View>

                    <GestureDetector gesture={composedGesture}>
                        <View style={{ width: chartWidth, height: chartHeight }}>
                            <Svg width={chartWidth} height={chartHeight}>
                                <Defs>
                                    <LinearGradient id="grad1rm" x1="0" y1="0" x2="0" y2="1">
                                        <Stop offset="0" stopColor={colors.tint} stopOpacity="0.1" />
                                        <Stop offset="1" stopColor={colors.tint} stopOpacity="0" />
                                    </LinearGradient>
                                </Defs>

                                {/* Grid Lines and Labels */}
                                {[0, 0.5, 1].map((p, i) => {
                                    const yPos = padding + (chartHeight - 2 * padding) * p;
                                    const val = yRange[1] - (yRange[1] - yRange[0]) * p;
                                    return (
                                        <G key={i}>
                                            <Line 
                                                x1={padding} 
                                                y1={yPos} 
                                                x2={chartWidth - padding} 
                                                y2={yPos} 
                                                stroke={colors.border} 
                                                strokeWidth="1"
                                                strokeDasharray="4,4"
                                            />
                                            <SvgText
                                                x={padding - 5}
                                                y={yPos + 4}
                                                fontSize="10"
                                                fill={colors.secondaryText}
                                                textAnchor="end"
                                                fontWeight="600"
                                                fontFamily="System"
                                            >
                                                {Math.round(val)}
                                            </SvgText>
                                        </G>
                                    );
                                })}

                                {/* Actual Weight Path */}
                                {(chartMode === "weight" || chartMode === "both") && (
                                    <Path d={pathWeight} fill="none" stroke="#5856D6" strokeWidth="2" strokeOpacity={chartMode === "both" ? 0.5 : 1} />
                                )}

                                {/* 1RM Path */}
                                {(chartMode === "1rm" || chartMode === "both") && (
                                    <Path d={path1RM} fill="none" stroke={colors.tint} strokeWidth="3" />
                                )}
                                
                                {/* PR Indicators */}
                                {(chartMode === "1rm" || chartMode === "both") && chartData.map((d, i) => (
                                    d.isPR && (
                                        <Circle 
                                            key={`pr-1rm-${i}`}
                                            cx={points1RM[i].x} 
                                            cy={points1RM[i].y} 
                                            r="4" 
                                            fill="#FFD700" 
                                            stroke={colors.card}
                                            strokeWidth="1"
                                        />
                                    )
                                ))}
                                {(chartMode === "weight" || chartMode === "both") && chartData.map((d, i) => (
                                    d.isWeightPR && (
                                        <Circle 
                                            key={`pr-weight-${i}`}
                                            cx={pointsWeight[i].x} 
                                            cy={pointsWeight[i].y} 
                                            r="4" 
                                            fill="#FF9500" 
                                            stroke={colors.card}
                                            strokeWidth="1"
                                        />
                                    )
                                ))}

                                {activeIndex !== null && (
                                    <G>
                                        <Line 
                                            x1={points1RM[activeIndex].x} 
                                            y1={padding} 
                                            x2={points1RM[activeIndex].x} 
                                            y2={chartHeight - padding} 
                                            stroke={colors.border} 
                                            strokeWidth="1"
                                        />
                                        {(chartMode === "1rm" || chartMode === "both") && (
                                            <G>
                                                <Circle cx={points1RM[activeIndex].x} cy={points1RM[activeIndex].y} r="6" fill={colors.tint} />
                                                <Rect 
                                                    x={points1RM[activeIndex].x - 25} 
                                                    y={points1RM[activeIndex].y - 25} 
                                                    width="50" 
                                                    height="18" 
                                                    rx="4" 
                                                    fill={colors.tint} 
                                                />
                                                <SvgText 
                                                    x={points1RM[activeIndex].x} 
                                                    y={points1RM[activeIndex].y - 12} 
                                                    fontSize="10" 
                                                    fill="#FFF" 
                                                    textAnchor="middle" 
                                                    fontWeight="bold"
                                                    fontFamily="System"
                                                >
                                                    {Math.round(activeData?.oneRM || 0)}kg
                                                </SvgText>
                                            </G>
                                        )}
                                        {(chartMode === "weight" || chartMode === "both") && (
                                            <G>
                                                <Circle cx={pointsWeight[activeIndex].x} cy={pointsWeight[activeIndex].y} r="6" fill="#5856D6" />
                                                {chartMode === "weight" && (
                                                    <G>
                                                        <Rect 
                                                            x={pointsWeight[activeIndex].x - 25} 
                                                            y={pointsWeight[activeIndex].y - 25} 
                                                            width="50" 
                                                            height="18" 
                                                            rx="4" 
                                                            fill="#5856D6" 
                                                        />
                                                        <SvgText 
                                                            x={pointsWeight[activeIndex].x} 
                                                            y={pointsWeight[activeIndex].y - 12} 
                                                            fontSize="10" 
                                                            fill="#FFF" 
                                                            textAnchor="middle" 
                                                            fontWeight="bold"
                                                            fontFamily="System"
                                                        >
                                                            {Math.round(activeData?.weight || 0)}kg
                                                        </SvgText>
                                                    </G>
                                                )}
                                            </G>
                                        )}
                                    </G>
                                )}
                            </Svg>
                        </View>
                    </GestureDetector>

                    {activeData && (
                        <Pressable 
                            style={styles.viewWorkoutBtn}
                            onPress={() => router.push(`/app/workout/${activeData.workout_id}` as any)}
                        >
                            <Text style={[styles.viewWorkoutText, { color: colors.tint }]}>View Workout</Text>
                            <Ionicons name="chevron-forward" size={14} color={colors.tint} />
                        </Pressable>
                    )}

                    {/* Mode Selector */}
                    <View style={styles.modeSelector}>
                        <Pressable 
                            style={[styles.modeBtn, chartMode === "1rm" && { backgroundColor: colors.tint + "20" }]}
                            onPress={() => {
                                setChartMode("1rm");
                                setActiveIndex(null);
                            }}
                        >
                            <View style={[styles.modeDot, { backgroundColor: colors.tint }]} />
                            <Text style={[styles.modeText, { color: colors.text }]}>1RM</Text>
                        </Pressable>
                        <Pressable 
                            style={[styles.modeBtn, chartMode === "weight" && { backgroundColor: "#5856D620" }]}
                            onPress={() => {
                                setChartMode("weight");
                                setActiveIndex(null);
                            }}
                        >
                            <View style={[styles.modeDot, { backgroundColor: "#5856D6" }]} />
                            <Text style={[styles.modeText, { color: colors.text }]}>Weight</Text>
                        </Pressable>
                        <Pressable 
                            style={[styles.modeBtn, chartMode === "both" && { backgroundColor: colors.secondary }]}
                            onPress={() => {
                                setChartMode("both");
                                setActiveIndex(null);
                            }}
                        >
                            <Text style={[styles.modeText, { color: colors.text, marginLeft: 0 }]}>Both</Text>
                        </Pressable>
                    </View>

                    {/* Legend */}
                    <View style={styles.legend}>
                        <View style={styles.legendItem}>
                            <View style={[styles.legendLine, { backgroundColor: colors.tint }]} />
                            <Text style={[styles.legendText, { color: colors.secondaryText }]}>1RM</Text>
                            <View style={[styles.legendDot, { backgroundColor: "#FFD700", marginLeft: 4 }]} />
                            <Text style={[styles.legendText, { color: colors.secondaryText, fontSize: 8 }]}>PR</Text>
                        </View>
                        <View style={styles.legendItem}>
                            <View style={[styles.legendLine, { backgroundColor: "#5856D6" }]} />
                            <Text style={[styles.legendText, { color: colors.secondaryText }]}>Weight</Text>
                            <View style={[styles.legendDot, { backgroundColor: "#FF9500", marginLeft: 4 }]} />
                            <Text style={[styles.legendText, { color: colors.secondaryText, fontSize: 8 }]}>PR</Text>
                        </View>
                    </View>

                    <View style={styles.chartFooter}>
                        <Text style={[styles.footerDate, { color: colors.secondaryText }]}>
                            {format(parseISO(chartData[0].date), "MMM d")}
                        </Text>
                        <Text style={[styles.footerDate, { color: colors.secondaryText }]}>
                            {format(parseISO(chartData[chartData.length-1].date), "MMM d")}
                        </Text>
                    </View>
                </View>
            </GestureHandlerRootView>
        );
    };

    if (loading) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.tint} />
            </View>
        );
    }

    if (!exercise) {
        return (
            <View style={[styles.center, { backgroundColor: colors.background }]}>
                <Text style={{ color: colors.text }}>Exercise not found</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>
                <View style={styles.headerInfo}>
                    <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
                        {exercise.name}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]}>
                        {exercise.muscle_group || "Full Body"}
                    </Text>
                </View>
                <Pressable onPress={toggleFeatured} style={styles.featureBtn}>
                    <Ionicons 
                        name={isFeatured ? "star" : "star-outline"} 
                        size={24} 
                        color={isFeatured ? "#FFD700" : colors.secondaryText} 
                    />
                </Pressable>
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
                {/* Stats Grid */}
                <View style={styles.statsGrid}>
                    <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.secondaryText }]}>Est. 1RM</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{stats.oneRM} kg</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.secondaryText }]}>Max Weight</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{stats.maxWeight} kg</Text>
                    </View>
                </View>

                <View style={styles.statsGrid}>
                    <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.secondaryText }]}>Best Set</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{stats.bestSet.weight}kg x {stats.bestSet.reps}</Text>
                    </View>
                    <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.statLabel, { color: colors.secondaryText }]}>Total Sets</Text>
                        <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalSets}</Text>
                    </View>
                </View>

                {/* Chart */}
                {renderChart()}

                {/* History List */}
                <Text style={[styles.sectionTitle, { color: colors.text }]}>History</Text>
                {sets.slice().reverse().map((set, index) => {
                    const currentSetDate = format(parseISO(set.start_time), "yyyy-MM-dd");
                    const prevSet = sets[sets.length - index];
                    const prevSetDate = prevSet ? format(parseISO(prevSet.start_time), "yyyy-MM-dd") : null;
                    const showDate = index === 0 || currentSetDate !== prevSetDate;
                    
                    return (
                        <View key={set.id}>
                            {showDate && (
                                <Text style={[styles.dateHeader, { color: colors.secondaryText }]}>
                                    {format(parseISO(set.start_time), "MMMM d, yyyy")}
                                </Text>
                            )}
                            <Pressable 
                                style={[styles.setRow, { borderBottomColor: colors.border }]}
                                onPress={() => router.push(`/app/workout/${set.workout_id}` as any)}
                            >
                                <View>
                                    <Text style={[styles.setInfo, { color: colors.text }]}>
                                        {set.weight_kg} kg x {set.reps}
                                    </Text>
                                    <Text style={[styles.oneRMDetail, { color: colors.secondaryText }]}>
                                        Calculated 1RM: {Math.round((set.reps > 0 ? set.weight_kg / (1.0278 - (0.0278 * set.reps)) : 0) * 10) / 10} kg
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={colors.border} />
                            </Pressable>
                        </View>
                    );
                })}
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
    featureBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
    headerInfo: { flex: 1, alignItems: "center" },
    headerTitle: { fontSize: 16, fontWeight: "800", fontFamily: "System" },
    headerSubtitle: { fontSize: 12, fontWeight: "600", fontFamily: "System" },

    content: { padding: 16 },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },

    statsGrid: { flexDirection: "row", gap: 12, marginBottom: 12 },
    statBox: {
        flex: 1,
        padding: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    statLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 4, fontFamily: "System" },
    statValue: { fontSize: 18, fontWeight: "800", fontFamily: "System" },

    chartWrapper: {
        marginTop: 12,
        marginBottom: 24,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    filterRow: {
        flexDirection: "row",
        gap: 8,
        marginBottom: 20,
    },
    filterBtn: {
        flex: 1,
        height: 28,
        borderRadius: 14,
        justifyContent: "center",
        alignItems: "center",
    },
    filterBtnText: {
        fontSize: 10,
        fontWeight: "800",
        fontFamily: "System",
    },
    chartHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 16,
        minHeight: 50,
    },
    chartSub: { fontSize: 13, fontWeight: "700", fontFamily: "System" },
    prBadge: {
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        backgroundColor: "#FFD70020",
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
    },
    prBadgeText: {
        fontSize: 9,
        fontWeight: "900",
        color: "#FFD700",
        fontFamily: "System",
    },
    activeValuesRow: {
        flexDirection: "row",
        gap: 16,
    },
    valCol: {
        alignItems: "flex-end",
    },
    valLabel: {
        fontSize: 9,
        fontWeight: "800",
        marginBottom: 2,
        fontFamily: "System",
    },
    activeVal: { fontSize: 20, fontWeight: "900", fontFamily: "System" },

    modeSelector: {
        flexDirection: "row",
        marginTop: 20,
        gap: 8,
    },
    modeBtn: {
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        height: 36,
        borderRadius: 18,
    },
    modeDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    modeText: {
        fontSize: 11,
        fontWeight: "800",
        fontFamily: "System",
    },

    legend: {
        flexDirection: "row",
        flexWrap: "wrap",
        gap: 12,
        marginTop: 16,
        paddingTop: 16,
        borderTopWidth: 1,
        borderTopColor: "rgba(128,128,128,0.1)",
    },
    legendItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
    },
    legendLine: {
        width: 12,
        height: 3,
        borderRadius: 2,
    },
    legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    legendText: {
        fontSize: 10,
        fontWeight: "700",
        fontFamily: "System",
    },

    chartFooter: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginTop: 10,
    },
    footerDate: { fontSize: 11, fontWeight: "700", fontFamily: "System" },

    viewWorkoutBtn: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        paddingVertical: 8,
        marginTop: 4,
        gap: 4,
    },
    viewWorkoutText: {
        fontSize: 13,
        fontWeight: "700",
        color: "#5856D6",
        fontFamily: "System",
    },

    emptyChart: {
        height: 200,
        borderRadius: 16,
        borderWidth: 1,
        justifyContent: "center",
        alignItems: "center",
        marginVertical: 12,
        borderStyle: "dashed",
    },
    emptyChartText: { marginTop: 12, fontSize: 14, fontWeight: "600", fontFamily: "System" },

    sectionTitle: { fontSize: 18, fontWeight: "800", marginTop: 20, marginBottom: 16, fontFamily: "System" },
    dateHeader: { fontSize: 13, fontWeight: "700", marginTop: 20, marginBottom: 12, fontFamily: "System" },
    setRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 14,
        borderBottomWidth: 1,
    },
    setInfo: { fontSize: 16, fontWeight: "700", fontFamily: "System" },
    oneRMDetail: { fontSize: 12, fontWeight: "600", marginTop: 2, fontFamily: "System" },
});


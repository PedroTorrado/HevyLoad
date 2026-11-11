import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View, Platform, ActivityIndicator, Image, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { usePreferences } from "../../lib/preferences";
import { getLocalYYYYMMDD } from "../../lib/date-utils";
import type { CalendarSessionDetails } from "../../lib/program-calendar";

type PressState = { pressed: boolean; hovered?: boolean };
type TodayWorkout = {
    id: string;
    title: string;
    mode: string;
    status: "planned" | "completed" | "skipped";
    details: CalendarSessionDetails;
};

/** Shared press / hover feedback so every tappable dashboard card feels interactive. */
const pressFeedback = ({ pressed, hovered }: PressState) => ({
    opacity: pressed ? 0.75 : hovered ? 0.9 : 1,
    transform: [{ scale: pressed ? 0.98 : 1 }],
});

function formatWorkoutMeta(workout: any) {
    const sets: any[] = workout.sets || [];
    const volume = Math.round(sets.reduce((sum, s) => sum + (Number(s.weight_kg) || 0) * (Number(s.reps) || 0), 0));
    const minutes = workout.end_time
        ? Math.round((new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()) / 60000)
        : 0;
    const duration = minutes > 0 ? (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`) : null;
    return { setCount: sets.length, volume, duration };
}

type WorkoutCalendarProps = {
    workouts: { id: string; start_time: string; title?: string | null; volume: number; durationMinutes: number; isRun?: boolean; runKm?: number; runSeconds?: number }[];
    colors: ReturnType<typeof useThemeColor>;
    onWorkoutPress: (workoutId: string) => void;
    title: string;
    lessLabel: string;
    moreLabel: string;
    weekdayLabels: [string, string, string];
    volumeLabel: string;
    timeLabel: string;
    rollingLabel: string;
    yearLabel: string;
};

function WorkoutCalendar({
    workouts,
    colors,
    onWorkoutPress,
    title,
    lessLabel,
    moreLabel,
    weekdayLabels,
    volumeLabel,
    timeLabel,
    rollingLabel,
    yearLabel,
}: WorkoutCalendarProps) {
    const activityMatrixRef = useRef<ScrollView>(null);
    const [metric, setMetric] = useState<"volume" | "duration">("volume");
    const [selectedPeriod, setSelectedPeriod] = useState<"rolling" | number>("rolling");
    const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
    const workoutTotals = new Map<string, number>();
    const workoutsByDate = new Map<string, { id: string; start_time: string; title?: string | null; isRun?: boolean }[]>();
    const runTotals = new Map<string, { km: number; seconds: number }>();
    workouts.forEach((workout) => {
        const date = getLocalYYYYMMDD(new Date(workout.start_time));
        if (workout.isRun) {
            const prev = runTotals.get(date) || { km: 0, seconds: 0 };
            runTotals.set(date, {
                km: prev.km + (workout.runKm || 0),
                seconds: prev.seconds + (workout.runSeconds || workout.durationMinutes * 60),
            });
        } else {
            const value = metric === "volume" ? workout.volume : workout.durationMinutes;
            workoutTotals.set(date, (workoutTotals.get(date) || 0) + value);
            // Running inside a strength session: count only the run sets themselves.
            if ((workout.runKm || 0) > 0 || (workout.runSeconds || 0) > 0) {
                const prev = runTotals.get(date) || { km: 0, seconds: 0 };
                runTotals.set(date, {
                    km: prev.km + (workout.runKm || 0),
                    seconds: prev.seconds + (workout.runSeconds || 0),
                });
            }
        }
        const dateWorkouts = workoutsByDate.get(date) || [];
        dateWorkouts.push(workout);
        workoutsByDate.set(date, dateWorkouts);
    });

    const today = new Date();
    const selectedYear = typeof selectedPeriod === "number" ? selectedPeriod : null;
    const rangeStart = selectedYear
        ? new Date(selectedYear, 0, 1)
        : new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    const rangeEnd = selectedYear ? new Date(selectedYear, 11, 31) : today;
    rangeStart.setHours(0, 0, 0, 0);
    rangeEnd.setHours(23, 59, 59, 999);
    const monday = new Date(rangeStart);
    monday.setHours(0, 0, 0, 0);
    const firstDayOfWeek = monday.getDay();
    monday.setDate(monday.getDate() - (firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1));

    const currentMonday = new Date(rangeEnd);
    currentMonday.setHours(0, 0, 0, 0);
    const currentDayOfWeek = currentMonday.getDay();
    currentMonday.setDate(currentMonday.getDate() - (currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1));
    const weekCount = Math.floor((currentMonday.getTime() - monday.getTime()) / (7 * 24 * 60 * 60 * 1000)) + 1;

    const weeks = Array.from({ length: weekCount }, (_, weekIndex) =>
        Array.from({ length: 7 }, (_, dayIndex) => {
            const date = new Date(monday);
            date.setDate(monday.getDate() + weekIndex * 7 + dayIndex);
            const key = getLocalYYYYMMDD(date);
            const isInRange = date >= rangeStart && date <= rangeEnd;
            const run = isInRange ? runTotals.get(key) : undefined;
            return {
                key,
                value: isInRange ? workoutTotals.get(key) || 0 : 0,
                runKm: run?.km || 0,
                runMinutes: run ? Math.round(run.seconds / 60) : 0,
                /** Seconds per km; null when no distance was logged. */
                pace: run && run.km > 0 && run.seconds > 0 ? run.seconds / run.km : null,
                date,
            };
        })
    );

    useEffect(() => {
        activityMatrixRef.current?.scrollToEnd({ animated: false });
    }, [selectedPeriod, weeks.length]);

    const maxValue = Math.max(...weeks.flat().map((day) => day.value), 1);
    const paces = weeks.flat().map((day) => day.pace).filter((p): p is number => p !== null);
    const fastestPace = paces.length ? Math.min(...paces) : 0;
    const slowestPace = paces.length ? Math.max(...paces) : 0;
    const getCellColor = (value: number) => {
        if (value === 0) return colors.secondary;
        const intensity = value / maxValue;
        if (intensity <= 0.25) return "#BFDBFE";
        if (intensity <= 0.5) return "#60A5FA";
        if (intensity <= 0.75) return "#2563EB";
        return "#1E3A8A";
    };
    /** Purple scale for runs, by pace: faster (lower sec/km) = darker. */
    const getRunColor = (pace: number | null) => {
        if (pace === null) return "#C084FC";
        const intensity = slowestPace === fastestPace ? 1 : (slowestPace - pace) / (slowestPace - fastestPace);
        if (intensity <= 0.25) return "#C084FC";
        if (intensity <= 0.5) return "#A855F7";
        if (intensity <= 0.75) return "#7E22CE";
        return "#581C87";
    };
    const formatPace = (pace: number) => {
        const total = Math.round(pace);
        return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} /km`;
    };
    const isInRangeDay = (day: { date: Date }) => day.date >= rangeStart && day.date <= rangeEnd;
    const getDayColor = (day: { value: number; runMinutes: number; pace: number | null; key: string }) => {
        if (day.value > 0) return getCellColor(day.value);
        if (day.runMinutes > 0 || workoutsByDate.get(day.key)?.some((w) => w.isRun)) return getRunColor(day.pace);
        return colors.secondary;
    };

    const getDayAtPoint = (x: number, y: number) => {
        const weekIndex = Math.floor(x / 17);
        const dayIndex = Math.floor((y - 16) / 17);
        const day = weeks[weekIndex]?.[dayIndex];
        return day && day.date >= rangeStart && day.date <= rangeEnd && workoutsByDate.has(day.key) ? day : null;
    };

    const panResponder = useMemo(() => PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
            setSelectedDayKey(getDayAtPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)?.key || null);
        },
        onPanResponderMove: (event) => {
            setSelectedDayKey(getDayAtPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)?.key || null);
        },
        onPanResponderRelease: (event) => {
            setSelectedDayKey(
                getDayAtPoint(event.nativeEvent.locationX, event.nativeEvent.locationY)?.key
                || selectedDayKey
                || null
            );
        },
    }), [onWorkoutPress, selectedDayKey, weeks, workoutsByDate]);

    const selectedDay = weeks.flat().find((day) => day.key === selectedDayKey);
    const selectedWorkout = selectedDay ? workoutsByDate.get(selectedDay.key)?.[0] : undefined;
    const selectedDateLabel = selectedDay?.date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
        year: "numeric",
    });

    return (
        <View style={styles.activitySection}>
            <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{title}</Text>
            <View style={[styles.activityCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.activityControls}>
                    {(["volume", "duration"] as const).map((option) => (
                        <Pressable
                            key={option}
                            onPress={() => setMetric(option)}
                            style={[
                                styles.activityToggle,
                                metric === option && { backgroundColor: colors.tint },
                            ]}
                        >
                            <Text style={[styles.activityToggleText, { color: metric === option ? "#FFF" : colors.secondaryText }]}>
                                {option === "volume" ? volumeLabel : timeLabel}
                            </Text>
                        </Pressable>
                    ))}
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.activityPeriods}
                >
                    <Pressable
                        onPress={() => setSelectedPeriod("rolling")}
                        style={[styles.activityPeriod, selectedPeriod === "rolling" && { backgroundColor: colors.secondary }]}
                    >
                        <Text style={[styles.activityPeriodText, { color: colors.text }]}>{rollingLabel}</Text>
                    </Pressable>
                    {Array.from(new Set(workouts.map((workout) => new Date(workout.start_time).getFullYear())))
                        .sort((a, b) => b - a)
                        .map((year) => (
                            <Pressable
                                key={year}
                                onPress={() => setSelectedPeriod(year)}
                                style={[styles.activityPeriod, selectedPeriod === year && { backgroundColor: colors.secondary }]}
                            >
                                <Text style={[styles.activityPeriodText, { color: colors.text }]}>{yearLabel} {year}</Text>
                            </Pressable>
                        ))}
                </ScrollView>
                <Pressable
                    disabled={!selectedWorkout}
                    onPress={() => selectedWorkout && onWorkoutPress(selectedWorkout.id)}
                    style={[
                        styles.activitySelection,
                        {
                            borderColor: selectedWorkout ? colors.tint : colors.border,
                            backgroundColor: selectedWorkout ? colors.secondary : "transparent",
                        },
                    ]}
                >
                    <View style={styles.activitySelectionHeader}>
                        <Text style={[styles.activitySelectionDate, { color: selectedWorkout ? colors.tint : colors.text }]}>
                            {selectedWorkout
                                ? `${workoutsByDate.get(selectedDay!.key)!.map((w) => w.title || "Workout").join(" + ")} · ${selectedDateLabel}`
                                : selectedDateLabel || "Select a workout day"}
                        </Text>
                        {selectedWorkout && <Ionicons name="arrow-forward-circle" size={17} color={colors.tint} />}
                    </View>
                    {selectedDay && (
                        <Text style={[styles.activitySelectionValue, { color: colors.secondaryText }]}>
                            {[
                                selectedDay.value > 0 ? `${Math.round(selectedDay.value)} ${metric === "volume" ? "kg" : "min"}` : "",
                                selectedDay.runMinutes > 0
                                    ? `Run ${selectedDay.runKm > 0 ? `${selectedDay.runKm.toFixed(2)} km · ` : ""}${selectedDay.runMinutes} min${selectedDay.pace ? ` · ${formatPace(selectedDay.pace)}` : ""}`
                                    : "",
                            ].filter(Boolean).join(" · ") || `0 ${metric === "volume" ? "kg" : "min"}`}
                            {selectedWorkout ? " · Tap the date to open workout" : ""}
                        </Text>
                    )}
                </Pressable>
                <View style={styles.activityGrid}>
                    <View style={styles.activityDayLabels}>
                        <View style={styles.activityMonthSpacer} />
                        <Text style={[styles.activityDayLabel, styles.activityMondayLabel, { color: colors.secondaryText }]}>{weekdayLabels[0]}</Text>
                        <Text style={[styles.activityDayLabel, styles.activityWednesdayLabel, { color: colors.secondaryText }]}>{weekdayLabels[1]}</Text>
                        <Text style={[styles.activityDayLabel, styles.activityFridayLabel, { color: colors.secondaryText }]}>{weekdayLabels[2]}</Text>
                    </View>
                    <ScrollView
                        ref={activityMatrixRef}
                        horizontal
                        showsHorizontalScrollIndicator
                        persistentScrollbar
                        style={styles.activityMatrixScroll}
                        contentContainerStyle={styles.activityMatrixContent}
                        onContentSizeChange={() => activityMatrixRef.current?.scrollToEnd({ animated: false })}
                    >
                        <View style={styles.activityWeeks} {...panResponder.panHandlers}>
                            {weeks.map((week, weekIndex) => {
                                const firstVisibleDay = week.find((day) => day.date >= rangeStart && day.date <= rangeEnd);
                                const previousVisibleDay = weeks[weekIndex - 1]?.find(
                                    (day) => day.date >= rangeStart && day.date <= rangeEnd
                                );
                                const monthLabel = firstVisibleDay &&
                                    (!previousVisibleDay || firstVisibleDay.date.getMonth() !== previousVisibleDay.date.getMonth())
                                    ? firstVisibleDay.date.toLocaleString(undefined, { month: "short" })
                                    : "";

                                return (
                                <View key={weekIndex} style={styles.activityWeek}>
                                    <Text style={[styles.activityMonthLabel, { color: colors.secondaryText }]}>
                                        {monthLabel}
                                    </Text>
                                    <View style={styles.activityCells}>
                                        {week.map((day) => {
                                            const dateWorkouts = workoutsByDate.get(day.key) || [];
                                            const workout = dateWorkouts[0];
                                            const isSelectable = day.date >= rangeStart && day.date <= rangeEnd && !!workout;
                                            return (
                                            <Pressable
                                                key={day.key}
                                                accessible
                                                accessibilityLabel={`${day.key}: ${day.value} ${metric === "volume" ? "kg volume" : "minutes"}`}
                                                disabled={!isSelectable}
                                                hitSlop={6}
                                                onHoverIn={() => isSelectable && setSelectedDayKey(day.key)}
                                                onPressIn={() => isSelectable && setSelectedDayKey(day.key)}
                                                style={styles.activityCellWrapper}
                                            >
                                                <View style={[
                                                    styles.activityCell,
                                                    isInRangeDay(day) && day.value > 0 && (day.runMinutes > 0 || day.runKm > 0) && styles.activityCellMixed,
                                                    selectedDayKey === day.key && styles.activityCellSelected,
                                                    { backgroundColor: isInRangeDay(day) ? getDayColor(day) : colors.secondary },
                                                ]} />
                                            </Pressable>
                                            );
                                        })}
                                    </View>
                                </View>
                                );
                            })}
                        </View>
                    </ScrollView>
                </View>
                <View style={styles.activityLegend}>
                    <Text style={[styles.activityLegendText, { color: colors.secondaryText }]}>{lessLabel}</Text>
                    {[0, 0.25, 0.5, 0.75, 1].map((level) => (
                        <View key={level} style={[styles.activityCell, { backgroundColor: level === 0 ? colors.secondary : getCellColor(level * maxValue) }]} />
                    ))}
                    <Text style={[styles.activityLegendText, { color: colors.secondaryText }]}>{moreLabel}</Text>
                    <Text style={[styles.activityLegendText, { color: colors.secondaryText, marginLeft: 10 }]}>Run pace: slower</Text>
                    {["#C084FC", "#A855F7", "#7E22CE", "#581C87"].map((shade) => (
                        <View key={shade} style={[styles.activityCell, { backgroundColor: shade }]} />
                    ))}
                    <Text style={[styles.activityLegendText, { color: colors.secondaryText }]}>faster</Text>
                </View>
            </View>
        </View>
    );
}

export default function Dashboard() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();
    const scheme = useColorScheme();
    const { plateType } = usePreferences();

    const PlateVisualizer = ({ weight }: { weight: number }) => {
        const BAR_WEIGHT = 20;
        const remaining = Math.max(0, weight - BAR_WEIGHT);
        const sideWeight = remaining / 2;

        const plates: any[] = [];
        let w = sideWeight;

        const PLATE_CONFIGS = [
            { weight: 25, color: "#FF3B30", height: 44, width: 8 },
            { weight: 20, color: "#0A84FF", height: 44, width: 8 },
            { weight: 15, color: "#FFCC00", height: 38, width: 7 },
            { weight: 10, color: "#4CD964", height: 32, width: 6 },
            { weight: 5, color: "#FFFFFF", height: 26, width: 5 },
            { weight: 2.5, color: "#888888", height: 20, width: 4 },
            { weight: 1.25, color: "#666666", height: 16, width: 3 },
        ];

        const availableConfigs = PLATE_CONFIGS.filter(c => {
            if (plateType === 25 && c.weight === 20) return false;
            if (plateType === 20 && c.weight === 25) return false;
            return true;
        });

        availableConfigs.sort((a, b) => b.weight - a.weight).forEach(config => {
            const count = Math.floor(w / config.weight);
            for (let i = 0; i < count; i++) {
                plates.push(config);
            }
            w = Math.round((w - count * config.weight) * 100) / 100;
        });

        return (
            <View style={styles.plateVisualizer}>
                <View style={[styles.barbell, { backgroundColor: colors.border }]} />
                <View style={styles.platesContainer}>
                    {plates.slice(0, 8).map((p, i) => (
                        <View 
                            key={i} 
                            style={[
                                styles.plate, 
                                { 
                                    backgroundColor: p.color, 
                                    height: p.height, 
                                    width: p.width,
                                    borderColor: "rgba(0,0,0,0.1)",
                                    borderWidth: 0.5
                                }
                            ]} 
                        />
                    ))}
                </View>
            </View>
        );
    };
    
    // Initialize loading as false to prevent immediate flicker
    const [loading, setLoading] = useState(false);
    const hasLoaded = useRef(false);
    const [userName, setUserName] = useState("User");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [stats, setStats] = useState({
        totalWorkouts: 0,
        totalVolume: 0,
        workoutsThisWeek: 0,
        workoutsLast7Days: 0,
        weeklyTonnage: 0,
        powerliftingTotal: 0
    });
    const [recentWorkouts, setRecentWorkouts] = useState<any[]>([]);
    const [activityWorkouts, setActivityWorkouts] = useState<{ id: string; start_time: string; title?: string | null; volume: number; durationMinutes: number }[]>([]);
    const [sbdLifts, setSbdLifts] = useState<{name: string, value: number, id: string, type: string}[]>([]);
    const [otherLifts, setOtherLifts] = useState<{name: string, value: number, id: string}[]>([]);
    const [todayWorkouts, setTodayWorkouts] = useState<TodayWorkout[]>([]);

    const firstName = userName.split(" ")[0] || "User";

    useFocusEffect(
        useCallback(() => {
            loadDashboardData(false); // Never show full-screen loader on focus
        }, [])
    );

    // Initial load
    useEffect(() => {
        loadDashboardData(true);
        hasLoaded.current = true;
    }, []);

    async function loadDashboardData(showLoader: boolean) {
        if (showLoader && stats.totalWorkouts === 0) setLoading(true);
        
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            // 1. Fetch Profile, Workouts, and Exercises
            const [profileRes, workoutsRes, exercisesRes, totalCountRes, todaySessionsRes] = await Promise.all([
                supabase.from("profiles").select("full_name, avatar_url, featured_exercise_ids").eq("id", user.id).single(),
                supabase.from("workouts").select("id, start_time, end_time, title, sets(weight_kg, reps, exercise_id, duration_s, distance_km)").eq("user_id", user.id).order("start_time", { ascending: false }).limit(1000),
                supabase.from("exercises").select("id, name").eq("user_id", user.id),
                supabase.from("workouts").select("id", { count: 'exact', head: true }).eq("user_id", user.id),
                supabase.from("calendar_sessions").select("id, title, mode, status, details").eq("user_id", user.id).eq("session_date", getLocalYYYYMMDD()).order("title")
            ]);
            setTodayWorkouts(todaySessionsRes.error ? [] : (todaySessionsRes.data ?? []).map((session) => ({
                id: session.id,
                title: session.title,
                mode: session.mode,
                status: session.status,
                details: (session.details ?? {}) as CalendarSessionDetails,
            })));

            if (profileRes.data) {
                setUserName(profileRes.data.full_name || user.user_metadata?.full_name || "User");
                setAvatarUrl(profileRes.data.avatar_url);
            }

            let thisWeekCount = 0;
            if (workoutsRes.data) {
                const workouts = workoutsRes.data;
                const now = new Date();
                const day = now.getDay();
                const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
                const startOfWeek = new Date(now.setDate(diff));
                startOfWeek.setHours(0, 0, 0, 0);
                const startOfLast7Days = new Date();
                startOfLast7Days.setDate(startOfLast7Days.getDate() - 6);
                startOfLast7Days.setHours(0, 0, 0, 0);

                thisWeekCount = workouts.filter(w => new Date(w.start_time) >= startOfWeek).length;
                const last7DaysCount = workouts.filter(w => new Date(w.start_time) >= startOfLast7Days).length;

                setStats(prev => ({
                    ...prev,
                    totalWorkouts: totalCountRes.count || workouts.length,
                    workoutsThisWeek: thisWeekCount,
                    workoutsLast7Days: last7DaysCount,
                }));
                setRecentWorkouts(workouts.slice(0, 3));
            }

            if (exercisesRes.data) {
                // 2. Identify target exercises (SBD + Featured)
                const featuredIds = profileRes.data?.featured_exercise_ids || [];
                const sbdMap = {
                    squat: ["squat", "agachamento", "sentadilla", "kniebeuge", "accosciata"],
                    bench: ["bench", "supino", "press de banca", "bankdrücken", "panca"],
                    deadlift: ["deadlift", "peso morto", "peso muerto", "kreuzheben", "stacco"]
                };

                const targetExerciseIds = new Set<string>(featuredIds);

                Object.entries(sbdMap).forEach(([key, keywords]) => {
                    const alreadyStarredSBD = Array.from(targetExerciseIds).some(fid => {
                        const ex = exercisesRes.data!.find(e => e.id === fid);
                        return ex && keywords.some(k => ex.name.toLowerCase().includes(k));
                    });

                    if (!alreadyStarredSBD) {
                        const matches = exercisesRes.data!.filter(ex => 
                            keywords.some(k => ex.name.toLowerCase().includes(k))
                        );
                        
                        if (matches.length > 0) {
                            const sortedMatches = matches.sort((a, b) => {
                                const aName = a.name.toLowerCase();
                                const bName = b.name.toLowerCase();
                                const aBarbell = aName.includes("barbell") || aName.includes("barra");
                                const bBarbell = bName.includes("barbell") || bName.includes("barra");
                                if (aBarbell && !bBarbell) return -1;
                                if (!aBarbell && bBarbell) return 1;
                                return aName.length - bName.length;
                            });
                            targetExerciseIds.add(sortedMatches[0].id);
                        }
                    }
                });

                // 3. Fetch MAX sets for target exercises and ALL sets for volume
                const targetIdsArray = Array.from(targetExerciseIds);
                
                // Fetch workouts with their sets to ensure we get user's data correctly
                const workoutsWithSets = workoutsRes.data;

                let totalVolume = 0;
                let weeklyTonnage = 0;
                const now = new Date();
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                startOfWeek.setHours(0, 0, 0, 0);

                const exerciseMaxes: Record<string, { name: string, weight: number }> = {};
                targetIdsArray.forEach(id => {
                    const ex = exercisesRes.data!.find(e => e.id === id);
                    if (ex) exerciseMaxes[id] = { name: ex.name, weight: 0 };
                });

                if (workoutsWithSets) {
                    const runKeywords = ["run", "jog", "treadmill", "corrida", "correr", "carrera", "passadeira", "laufen", "corsa"];
                    const runExerciseIds = new Set(
                        exercisesRes.data!
                            .filter((ex) => runKeywords.some((k) => ex.name.toLowerCase().includes(k)))
                            .map((ex) => ex.id)
                    );
                    const treadmillIds = new Set(
                        exercisesRes.data!
                            .filter((ex) => ["treadmill", "passadeira", "cinta"].some((k) => ex.name.toLowerCase().includes(k)))
                            .map((ex) => ex.id)
                    );
                    setActivityWorkouts(workoutsWithSets.map((workout: any) => {
                        // Treadmill sets at 0 km (e.g. walking warm-ups) don't count as running.
                        const sets = (workout.sets || []).filter(
                            (set: any) => !(treadmillIds.has(set.exercise_id) && !(Number(set.distance_km) > 0))
                        );
                        const runSets = sets.filter((set: any) => runExerciseIds.has(set.exercise_id));
                        return {
                        id: workout.id,
                        start_time: workout.start_time,
                        title: workout.title,
                        runKm: runSets.reduce((t: number, s: any) => t + (Number(s.distance_km) || 0), 0),
                        runSeconds: runSets.reduce((t: number, s: any) => t + (Number(s.duration_s) || 0), 0),
                        isRun: (workout.sets || []).length > 0
                            ? sets.length > 0 && sets.every((set: any) => runExerciseIds.has(set.exercise_id))
                            : runKeywords.some((k) => (workout.title || "").toLowerCase().includes(k)),
                        volume: (workout.sets || []).reduce((total: number, set: any) =>
                            total + (Number(set.weight_kg) || 0) * (Number(set.reps) || 0), 0),
                        durationMinutes: workout.end_time
                            ? Math.max(0, (new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()) / 60000)
                            : 0,
                        };
                    }));
                    workoutsWithSets.forEach(w => {
                        const workoutDate = new Date(w.start_time);
                        const isThisWeek = workoutDate >= startOfWeek;

                        w.sets.forEach((set: any) => {
                            const weight = set.weight_kg || 0;
                            const reps = set.reps || 0;
                            const vol = weight * reps;
                            totalVolume += vol;
                            if (isThisWeek) weeklyTonnage += vol;

                            if (targetExerciseIds.has(set.exercise_id)) {
                                if (weight > (exerciseMaxes[set.exercise_id]?.weight || 0)) {
                                    exerciseMaxes[set.exercise_id].weight = weight;
                                }
                            }
                        });
                    });
                }

                // Categorize Lifts
                const sbdLiftsData: any[] = [];
                const otherLiftsData: any[] = [];
                let plTotal = 0;

                Object.entries(exerciseMaxes).forEach(([id, data]) => {
                    const nameLower = data.name.toLowerCase();
                    let type = "";
                    if (sbdMap.squat.some(k => nameLower.includes(k))) type = "squat";
                    else if (sbdMap.bench.some(k => nameLower.includes(k))) type = "bench";
                    else if (sbdMap.deadlift.some(k => nameLower.includes(k))) type = "deadlift";

                    if (type) {
                        sbdLiftsData.push({ id, name: data.name, value: data.weight, type });
                        plTotal += data.weight;
                    } else {
                        otherLiftsData.push({ id, name: data.name, value: data.weight });
                    }
                });

                // Sort SBD (Squat -> Bench -> Deadlift)
                sbdLiftsData.sort((a, b) => {
                    const order = { squat: 0, bench: 1, deadlift: 2 };
                    return (order as any)[a.type] - (order as any)[b.type];
                });

                setSbdLifts(sbdLiftsData);
                setOtherLifts(otherLiftsData.sort((a, b) => a.name.localeCompare(b.name)));
                setStats(prev => ({ 
                    ...prev, 
                    totalVolume: Math.round(totalVolume), 
                    weeklyTonnage: Math.round(weeklyTonnage),
                    powerliftingTotal: Math.round(plTotal)
                }));
            }
        } catch (e) {
            console.error("Dashboard load error:", e);
        } finally {
            setLoading(false);
        }
    }

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return t("app.dashboard.greeting_morning");
        else if (hour < 18) return t("app.dashboard.greeting_afternoon");
        else return t("app.dashboard.greeting_evening");
    }

    const NAV_ITEMS = [
        {
            title: t("app.dashboard.modules.analytics.title"),
            desc: t("app.dashboard.modules.analytics.desc"),
            route: "/app/analytics",
            icon: "stats-chart" as const,
            color: colors.tint,
        },
        {
            title: t("app.dashboard.modules.exercises.title"),
            desc: t("app.dashboard.modules.exercises.desc"),
            route: "/app/exercises",
            icon: "barbell" as const,
            color: "#5856D6",
        },
        {
            title: t("app.dashboard.modules.history.title"),
            desc: t("app.dashboard.modules.history.desc"),
            route: "/app/history",
            icon: "list" as const,
            color: colors.text,
        },
        {
            title: t("app.dashboard.modules.calendar.title"),
            desc: t("app.dashboard.modules.calendar.desc"),
            route: "/app/program-calendar",
            icon: "calendar" as const,
            color: "#A855F7",
        },
        {
            title: t("app.dashboard.import_card.title"),
            desc: t("app.dashboard.import_card.subtitle"),
            route: "/app/import",
            icon: "cloud-upload" as const,
            color: "#FF9500",
        },
    ];

    function renderTodayWorkout(workout: TodayWorkout) {
        const exercises = workout.details.exercises ?? [];
        const icon = workout.mode === "running" ? "walk-outline" : workout.mode === "weight_training" ? "barbell-outline" : "fitness-outline";
        return (
            <Pressable
                key={workout.id}
                onPress={() => router.push("/app/program-calendar" as any)}
                style={(state) => [styles.todayWorkoutCard, { backgroundColor: colors.secondaryBackground, borderColor: colors.border }, pressFeedback(state)]}
            >
                <View style={[styles.todayWorkoutIcon, { backgroundColor: workout.status === "completed" ? colors.success : colors.tint }]}>
                    <Ionicons name={icon} size={19} color="#fff" />
                </View>
                <View style={styles.todayWorkoutCopy}>
                    <Text style={[styles.todayWorkoutTitle, { color: colors.text }]}>{workout.title}</Text>
                    <Text style={[styles.todayWorkoutMeta, { color: colors.secondaryText }]}>
                        {workout.mode.replace("_", " ")} · {workout.status}
                    </Text>
                    {workout.details.distance_km || workout.details.duration_minutes ? (
                        <Text style={[styles.todayWorkoutSummary, { color: colors.text }]}>
                            {workout.details.distance_km ? `${workout.details.distance_km} km` : ""}
                            {workout.details.duration_minutes ? `${workout.details.distance_km ? " · " : ""}${workout.details.duration_minutes} min` : ""}
                            {workout.details.pace ? ` · ${workout.details.pace}` : ""}
                        </Text>
                    ) : null}
                    {exercises.slice(0, 3).map((exercise, index) => (
                        <View key={`${exercise.name}-${index}`} style={styles.todayExerciseRow}>
                            <Text style={[styles.todayExerciseName, { color: colors.text }]} numberOfLines={1}>{exercise.name}</Text>
                            <Text style={[styles.todayExercisePrescription, { color: colors.secondaryText }]}>
                                {exercise.sets ?? "-"} × {exercise.reps ?? "-"}
                            </Text>
                            <Text style={[styles.todayExerciseLoad, { color: colors.tint }]}>{exercise.load || "—"}</Text>
                        </View>
                    ))}
                    {exercises.length > 3 ? <Text style={[styles.todayMore, { color: colors.tint }]}>+{exercises.length - 3} more exercises</Text> : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.secondaryText} />
            </Pressable>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
                <View style={[styles.pageFrame, { paddingTop: insets.top + 20 }]}>
                    
                    {/* Header */}
                    <View style={styles.header}>
                        <Image 
                            source={require("../../assets/images/logo512.png")} 
                            style={styles.headerLogo} 
                            resizeMode="contain" 
                        />
                        <Pressable style={[styles.profileBtn, { backgroundColor: colors.secondary }]} onPress={() => router.push("/app/profile" as any)}>
                            {avatarUrl ? (
                                <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
                            ) : (
                                <Ionicons name="person-circle-outline" size={32} color={colors.text} />
                            )}
                        </Pressable>
                    </View>

                    {/* Powerlifting Total Banner */}
                    {stats.powerliftingTotal > 0 && (
                        <Pressable
                            onPress={() => router.push("/app/analytics" as any)}
                            style={(state) => [styles.totalBanner, { backgroundColor: colors.card, borderColor: colors.border }, pressFeedback(state)]}
                        >
                            <View>
                                <Text style={[styles.totalLabel, { color: colors.secondaryText }]}>{t("app.dashboard.sbd_total")}</Text>
                                <Text style={[styles.totalValue, { color: colors.text }]}>{stats.powerliftingTotal.toLocaleString()} <Text style={styles.unit}>kg</Text></Text>
                            </View>
                            <View style={[styles.totalBadge, { backgroundColor: colors.tint + "20" }]}>
                                <Ionicons name="trophy" size={24} color={colors.tint} />
                            </View>
                        </Pressable>
                    )}

                    {/* Stats Grid */}
                    <View style={styles.statsGrid}>
                        <Pressable
                            onPress={() => router.push("/app/history" as any)}
                            style={(state) => [styles.statCard, { backgroundColor: colors.card }, pressFeedback(state)]}
                        >
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalWorkouts}</Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{t("app.dashboard.stats.workouts")}</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => router.push("/app/history" as any)}
                            style={(state) => [styles.statCard, { backgroundColor: colors.card }, pressFeedback(state)]}
                        >
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.workoutsThisWeek}</Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{t("app.dashboard.stats.this_week")}</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => router.push("/app/history" as any)}
                            style={(state) => [styles.statCard, { backgroundColor: colors.card }, pressFeedback(state)]}
                        >
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.workoutsLast7Days}</Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{t("app.dashboard.stats.last_7_days")}</Text>
                        </Pressable>
                        <Pressable
                            onPress={() => router.push("/app/analytics" as any)}
                            style={(state) => [styles.statCard, { flex: 2, backgroundColor: colors.card }, pressFeedback(state)]}
                        >
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.weeklyTonnage.toLocaleString()} kg</Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{t("app.dashboard.weekly_tonnage")}</Text>
                        </Pressable>
                    </View>

                    <View style={styles.todaySection}>
                        <View style={styles.todayHeader}>
                            <View style={styles.todayHeadingCopy}>
                                <Text style={[styles.sectionTitle, { color: colors.accentText, marginBottom: 0 }]}>Today&apos;s workout</Text>
                                <Text style={[styles.todayDate, { color: colors.secondaryText }]}>
                                    {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
                                </Text>
                            </View>
                            <Pressable onPress={() => router.push("/app/program-calendar" as any)} style={(state) => [styles.todayCalendarButton, { backgroundColor: colors.tint + "14" }, pressFeedback(state)]}>
                                <Ionicons name="calendar-outline" size={17} color={colors.tint} />
                            </Pressable>
                        </View>
                        {todayWorkouts.length ? todayWorkouts.map(renderTodayWorkout) : (
                            <Pressable onPress={() => router.push("/app/program-calendar" as any)} style={(state) => [styles.todayEmpty, { backgroundColor: colors.card, borderColor: colors.border }, pressFeedback(state)]}>
                                <View style={[styles.todayEmptyIcon, { backgroundColor: colors.tint + "14" }]}>
                                    <Ionicons name="calendar-outline" size={21} color={colors.tint} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={[styles.todayEmptyTitle, { color: colors.text }]}>No workout scheduled</Text>
                                    <Text style={[styles.todayEmptyText, { color: colors.secondaryText }]}>Open Program Calendar to plan today&apos;s session.</Text>
                                </View>
                                <Ionicons name="chevron-forward" size={18} color={colors.secondaryText} />
                            </Pressable>
                        )}
                    </View>

                    {/* The Big 3 Showdown */}
                    {sbdLifts.length > 0 && (
                        <View style={styles.big3Section}>
                            <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{t("app.dashboard.big_three")}</Text>
                            <View style={styles.big3Grid}>
                                {sbdLifts.map((lift) => {
                                    const liftColors: any = {
                                        squat: { bg: "#FF3B30", icon: "arrow-down-circle" },
                                        bench: { bg: "#007AFF", icon: "reorder-horizontal" },
                                        deadlift: { bg: "#5856D6", icon: "arrow-up-circle" }
                                    };
                                    const theme = liftColors[lift.type] || { bg: colors.tint, icon: "barbell" };
                                    
                                    return (
                                        <Pressable 
                                            key={lift.id} 
                                            style={(state) => [styles.big3Card, { backgroundColor: theme.bg + "15", borderColor: theme.bg + "30" }, pressFeedback(state)]}
                                            onPress={() => router.push(`/app/exercise/${lift.id}` as any)}
                                        >
                                            <View style={[styles.big3Icon, { backgroundColor: theme.bg }]}>
                                                <Ionicons name={theme.icon} size={16} color="#FFF" />
                                            </View>
                                            <Text style={[styles.big3Name, { color: colors.secondaryText }]}>{lift.type.toUpperCase()}</Text>
                                            <Text style={[styles.big3Value, { color: colors.text }]}>{lift.value}<Text style={styles.big3Unit}>kg</Text></Text>
                                            <PlateVisualizer weight={lift.value} />
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    )}

                    {/* Other Featured Lifts */}
                    {otherLifts.length > 0 && (
                        <View style={styles.maxSection}>
                            <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{t("app.dashboard.accessories")}</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.maxGrid}>
                                {otherLifts.map((lift) => (
                                    <Pressable 
                                        key={lift.id} 
                                        style={(state) => [styles.maxCard, { backgroundColor: colors.card }, pressFeedback(state)]}
                                        onPress={() => router.push(`/app/exercise/${lift.id}` as any)}
                                    >
                                        <Text style={[styles.maxLiftName, { color: colors.secondaryText }]} numberOfLines={1}>{lift.name}</Text>
                                        <Text style={[styles.maxLiftValue, { color: colors.text }]}>{lift.value} <Text style={styles.unit}>kg</Text></Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        </View>
                    )}

                    {loading && stats.totalWorkouts === 0 ? (
                        <View style={{ height: 200, justifyContent: 'center', alignItems: 'center' }}>
                            <ActivityIndicator size="small" color={colors.secondaryText} />
                        </View>
                    ) : (
                        <>
                            {activityWorkouts.length > 0 && (
                                <WorkoutCalendar
                                    workouts={activityWorkouts}
                                    colors={colors}
                                    onWorkoutPress={(workoutId) => router.push(`/app/workout/${workoutId}` as any)}
                                    title={t("app.dashboard.activity.title")}
                                    lessLabel={t("app.dashboard.activity.less")}
                                    moreLabel={t("app.dashboard.activity.more")}
                                    weekdayLabels={[
                                        t("app.dashboard.activity.monday"),
                                        t("app.dashboard.activity.wednesday"),
                                        t("app.dashboard.activity.friday"),
                                    ]}
                                    volumeLabel={t("app.dashboard.activity.volume")}
                                    timeLabel={t("app.dashboard.activity.time")}
                                    rollingLabel={t("app.dashboard.activity.rolling")}
                                    yearLabel={t("app.dashboard.activity.year")}
                                />
                            )}

                            {/* Main Action / Import Card */}
                            {stats.totalWorkouts === 0 ? (
                                <Pressable style={[styles.importCard, { backgroundColor: scheme === 'dark' ? '#333' : '#000' }]} onPress={() => router.push("/app/import" as any)}>
                                    <View style={styles.importContent}>
                                        <Text style={styles.importTitle}>{t("app.dashboard.import_card.title")}</Text>
                                        <Text style={styles.importSubtitle}>{t("app.dashboard.import_card.subtitle")}</Text>
                                        <View style={styles.importBtn}>
                                            <Text style={styles.importBtnText}>{t("app.dashboard.import_card.action")}</Text>
                                        </View>
                                    </View>
                                    <Ionicons name="cloud-upload-outline" size={60} color="rgba(255,255,255,0.2)" />
                                </Pressable>
                            ) : (
                                <View style={styles.recentSection}>
                                    <View style={styles.recentHeader}>
                                        <Text style={[styles.sectionTitle, { color: colors.accentText, marginBottom: 0 }]}>{t("app.dashboard.sections.recent_workouts")}</Text>
                                        <Pressable
                                            onPress={() => router.push("/app/history" as any)}
                                            hitSlop={8}
                                            style={(state) => [styles.seeAllBtn, pressFeedback(state)]}
                                        >
                                            <Text style={[styles.seeAllText, { color: colors.tint }]}>{t("app.dashboard.sections.see_all")}</Text>
                                            <Ionicons name="chevron-forward" size={12} color={colors.tint} />
                                        </Pressable>
                                    </View>
                                    <View style={[styles.recentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                        {recentWorkouts.map((workout, index) => {
                                            const meta = formatWorkoutMeta(workout);
                                            const isLast = index === recentWorkouts.length - 1;
                                            return (
                                                <Pressable
                                                    key={workout.id}
                                                    onPress={() => router.push(`/app/workout/${workout.id}` as any)}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={workout.title || "Workout"}
                                                    style={({ pressed, hovered }: PressState) => [
                                                        styles.workoutItem,
                                                        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
                                                        (pressed || hovered) && { backgroundColor: colors.secondary + (pressed ? "" : "80") },
                                                    ]}
                                                >
                                                    <View style={[styles.workoutIcon, { backgroundColor: colors.tint + "1F" }]}>
                                                        <Ionicons name="fitness" size={20} color={colors.tint} />
                                                    </View>
                                                    <View style={{ flex: 1 }}>
                                                        <Text style={[styles.workoutTitle, { color: colors.text }]} numberOfLines={1}>{workout.title || "Workout"}</Text>
                                                        <Text style={[styles.workoutDate, { color: colors.secondaryText }]} numberOfLines={1}>
                                                            {new Date(workout.start_time).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
                                                            {meta.duration ? ` · ${meta.duration}` : ""}
                                                            {` · ${meta.setCount} ${t("app.workout.sets").toLowerCase()}`}
                                                            {meta.volume > 0 ? ` · ${meta.volume.toLocaleString()} kg` : ""}
                                                        </Text>
                                                    </View>
                                                    <Ionicons name="chevron-forward" size={16} color={colors.secondaryText} />
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                </View>
                            )}

                            {/* Modules Grid */}
                            <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{t("app.dashboard.sections.quick_actions")}</Text>
                            <View style={styles.modulesGrid}>
                                {NAV_ITEMS.map((item) => (
                                    <Pressable key={item.title} style={(state) => [styles.navCard, { backgroundColor: colors.background, borderColor: colors.border }, pressFeedback(state)]} onPress={() => router.push(item.route as any)}>
                                        <View style={[styles.iconBadge, { backgroundColor: item.color + "10" }]}>
                                            <Ionicons name={item.icon} size={24} color={item.color} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                            <Text style={[styles.navTitle, { color: colors.text }]}>{item.title}</Text>
                                            <Text style={[styles.navDesc, { color: colors.secondaryText }]}>{item.desc}</Text>
                                        </View>
                                        <Ionicons name="chevron-forward" size={18} color={colors.border} />
                                    </Pressable>
                                ))}
                            </View>
                        </>
                    )}

                    <Pressable 
                        style={styles.signOutBtn} 
                        onPress={() => supabase.auth.signOut()}
                    >
                        <Text style={[styles.signOutText, { color: colors.error }]}>{t("common.signout")}</Text>
                    </Pressable>

                </View>
                <View style={{ height: insets.bottom + 40 }} />
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    pageFrame: { width: "100%", maxWidth: 1120, alignSelf: "center", paddingHorizontal: 24 },
    
    header: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 32,
        width: "100%",
    },
    headerLogo: {
        width: 55,
        height: 55,
    },
    profileBtn: { 
        width: 40,
        height: 40,
        borderRadius: 20,
        justifyContent: "center",
        alignItems: "center",
        overflow: "hidden",
    },
    avatarImg: {
        width: 40,
        height: 40,
        borderRadius: 20,
    },

    statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 32 },
    statCard: {
        flex: 1,
        minWidth: 120,
        padding: 16,
        borderRadius: 16,
    },
    statValue: { fontSize: 18, fontWeight: "900", fontFamily: "System", letterSpacing: -0.5 },
    statLabel: { fontSize: 9, fontWeight: "800", marginTop: 4, textTransform: "uppercase", fontFamily: "System", opacity: 0.8 },
    todaySection: { gap: 12, marginBottom: 30 },
    todayHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    todayHeadingCopy: { gap: 5 },
    todayDate: { fontSize: 13 },
    todayCalendarButton: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    todayWorkoutCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 16, borderRadius: 18, borderWidth: 1, borderLeftWidth: 3, borderLeftColor: "#007AFF", shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
    todayWorkoutIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    todayWorkoutCopy: { flex: 1, gap: 6 },
    todayWorkoutTitle: { fontSize: 15, fontWeight: "800" },
    todayWorkoutMeta: { fontSize: 11, textTransform: "capitalize" },
    todayWorkoutSummary: { fontSize: 13, fontWeight: "800", paddingTop: 1 },
    todayExerciseRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 5, borderTopWidth: 1, borderTopColor: "rgba(128,128,128,0.16)" },
    todayExerciseName: { flex: 1, fontSize: 12, fontWeight: "700" },
    todayExercisePrescription: { fontSize: 11 },
    todayExerciseLoad: { minWidth: 52, fontSize: 12, fontWeight: "900", textAlign: "right" },
    todayMore: { fontSize: 11, fontWeight: "800", paddingTop: 2 },
    todayEmpty: { flexDirection: "row", alignItems: "center", gap: 11, padding: 14, borderRadius: 16, borderWidth: 1 },
    todayEmptyIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    todayEmptyTitle: { fontSize: 14, fontWeight: "800" },
    todayEmptyText: { fontSize: 12, marginTop: 3 },

    totalBanner: {
        flexDirection: "row",
        flexWrap: "wrap",
        justifyContent: "space-between",
        alignItems: "center",
        padding: 24,
        borderRadius: 20,
        marginBottom: 20,
        borderWidth: 1,
    },
    totalLabel: { fontSize: 12, fontWeight: "900", letterSpacing: 1.5, marginBottom: 4, fontFamily: "System" },
    totalValue: { fontSize: 42, fontWeight: "900", fontFamily: "System", letterSpacing: -1 },
    totalBadge: {
        width: 56,
        height: 56,
        borderRadius: 28,
        justifyContent: "center",
        alignItems: "center",
    },

    big3Section: { marginBottom: 32 },
    big3Grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    big3Card: {
        flex: 1,
        minWidth: 150,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1.5,
        alignItems: "center",
    },
    big3Icon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 12,
    },
    big3Name: { fontSize: 9, fontWeight: "900", letterSpacing: 1, marginBottom: 4, fontFamily: "System" },
    big3Value: { fontSize: 22, fontWeight: "900", fontFamily: "System" },
    big3Unit: { fontSize: 12, fontWeight: "600", opacity: 0.6 },
    plateVisualizer: {
        height: 50,
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        marginTop: 14,
        justifyContent: "center",
    },
    barbell: {
        height: 4,
        width: "100%",
        position: "absolute",
        borderRadius: 2,
    },
    platesContainer: {
        flexDirection: "row",
        alignItems: "center",
        gap: 1.5,
    },
    plate: {
        borderRadius: 2,
    },

    maxSection: { marginBottom: 32 },
    maxGrid: { gap: 12, paddingRight: 24 },
    maxCard: {
        width: 130,
        padding: 16,
        borderRadius: 16,
        justifyContent: "center",
    },
    maxLiftName: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", marginBottom: 4, fontFamily: "System" },
    maxLiftValue: { fontSize: 20, fontWeight: "900", fontFamily: "System" },
    unit: { fontSize: 14, fontWeight: "600", opacity: 0.6, fontFamily: "System" },

    activitySection: { marginBottom: 32 },
    activityCard: {
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
    },
    activityGrid: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "center",
    },
    activityMatrixContent: {
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingRight: 4,
        paddingBottom: 12,
    },
    activityMatrixScroll: {
        flex: 1,
    },
    activityDayLabels: {
        position: "relative",
        width: 28,
        height: 143,
        marginRight: 8,
    },
    activityMonthSpacer: {
        height: 16,
    },
    activityControls: {
        flexDirection: "row",
        alignSelf: "flex-end",
        gap: 6,
        marginBottom: 12,
    },
    activityToggle: {
        borderRadius: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
    },
    activityToggleText: {
        fontSize: 11,
        fontWeight: "700",
    },
    activityPeriods: {
        gap: 6,
        paddingBottom: 14,
    },
    activityPeriod: {
        borderRadius: 6,
        paddingHorizontal: 9,
        paddingVertical: 5,
    },
    activityPeriodText: {
        fontSize: 11,
        fontWeight: "600",
    },
    activitySelection: {
        minHeight: 38,
        justifyContent: "center",
        paddingHorizontal: 10,
        paddingVertical: 6,
        marginBottom: 8,
        borderRadius: 6,
        borderWidth: 1,
    },
    activitySelectionDate: {
        fontSize: 12,
        fontWeight: "700",
    },
    activitySelectionHeader: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
    },
    activitySelectionValue: {
        fontSize: 10,
        marginTop: 2,
    },
    activityDayLabel: {
        position: "absolute",
        left: 0,
        fontSize: 9,
        lineHeight: 12,
    },
    activityMondayLabel: { top: 16 },
    activityWednesdayLabel: { top: 50 },
    activityFridayLabel: { top: 84 },
    activityWeeks: {
        flexDirection: "row",
        gap: 4,
        alignSelf: "center",
    },
    activityWeek: {
        position: "relative",
        width: 13,
        height: 131,
    },
    activityCells: {
        gap: 4,
        marginTop: 16,
    },
    activityMonthLabel: {
        position: "absolute",
        left: 0,
        height: 16,
        width: 40,
        fontSize: 10,
        lineHeight: 14,
        zIndex: 1,
    },
    activityCell: {
        width: 13,
        height: 13,
        borderRadius: 2,
    },
    /** Lifting day that also included a run. */
    activityCellMixed: {
        borderColor: "#A855F7",
        borderWidth: 2,
    },
    activityCellSelected: {
        borderColor: "#FFFFFF",
        borderWidth: 2,
    },
    activityCellWrapper: {
        position: "relative",
        width: 13,
        height: 13,
        alignItems: "center",
        justifyContent: "center",
        overflow: "visible",
    },
    activityLegend: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 5,
        marginTop: 14,
    },
    activityLegendText: {
        fontSize: 9,
        marginHorizontal: 2,
    },

    importCard: {
        borderRadius: 16,
        padding: 24,
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 32,
    },
    importContent: { flex: 1 },
    importTitle: { color: "#FFF", fontSize: 20, fontWeight: "800", marginBottom: 4, fontFamily: "System" },
    importSubtitle: { color: "rgba(255,255,255,0.6)", fontSize: 14, marginBottom: 16, fontFamily: "System" },
    importBtn: {
        backgroundColor: "#FFF",
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 6,
        alignSelf: "flex-start",
    },
    importBtnText: { color: "#000", fontWeight: "700", fontSize: 14, fontFamily: "System" },

    sectionTitle: { fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginBottom: 16, fontFamily: "System" },
    
    recentSection: { marginBottom: 32 },
    recentHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 16,
    },
    seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
    seeAllText: { fontSize: 12, fontWeight: "800", fontFamily: "System" },
    recentCard: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
    workoutItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        paddingHorizontal: 16,
    },
    workoutIcon: {
        width: 40,
        height: 40,
        borderRadius: 10,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 16,
    },
    workoutTitle: { fontSize: 16, fontWeight: "700", fontFamily: "System" },
    workoutDate: { fontSize: 12, marginTop: 2, fontFamily: "System" },

    modulesGrid: { gap: 12, marginBottom: 40 },
    navCard: {
        flexDirection: "row",
        alignItems: "center",
        borderWidth: 1,
        padding: 16,
        borderRadius: 12,
    },
    iconBadge: {
        width: 48,
        height: 48,
        borderRadius: 10,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 16,
    },
    navTitle: { fontSize: 16, fontWeight: "700", fontFamily: "System" },
    navDesc: { fontSize: 13, marginTop: 2, fontFamily: "System" },

    signOutBtn: {
        alignItems: "center",
        padding: 20,
    },
    signOutText: { fontWeight: "600", fontFamily: "System" }
});

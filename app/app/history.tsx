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
    exercises_count?: number;
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

        const { data: workoutsData, error } = await supabase
            .from("workouts")
            .select(`
                id, 
                title, 
                start_time, 
                end_time, 
                description
            `)
            .eq("user_id", user.id)
            .gte("start_time", monthStart)
            .lte("start_time", monthEnd)
            .order("start_time", { ascending: false });

        if (error) {
            console.error("Error loading workouts:", error);
        } else {
            setWorkouts(workoutsData || []);
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

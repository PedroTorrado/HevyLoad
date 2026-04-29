import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { 
    ActivityIndicator, 
    ScrollView, 
    StyleSheet, 
    Text, 
    View, 
    Pressable,
    Dimensions,
    Platform
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { format, subMonths, eachMonthOfInterval, startOfMonth, endOfMonth, parseISO } from "date-fns";
import Svg, { Rect, G, Text as SvgText } from "react-native-svg";

export default function Analytics() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(false);
    const hasLoaded = useRef(false);
    const [monthlyStats, setMonthlyStats] = useState<any[]>([]);
    const [muscleDist, setMuscleDist] = useState<any[]>([]);

    useFocusEffect(
        useCallback(() => {
            loadAnalytics(false);
        }, [])
    );

    useEffect(() => {
        loadAnalytics(true);
        hasLoaded.current = true;
    }, []);

    async function loadAnalytics(showLoader: boolean) {
        if (showLoader && monthlyStats.length === 0) setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const now = new Date();
        const sixMonthsAgo = subMonths(now, 5);
        
        // Run requests in parallel
        const [workoutsRes, setsRes] = await Promise.all([
            supabase.from("workouts").select("id, start_time").eq("user_id", user.id).gte("start_time", startOfMonth(sixMonthsAgo).toISOString()).order("start_time", { ascending: true }),
            supabase.from("sets").select("id, exercise:exercises(muscle_group)").eq("user_id", user.id).limit(10000)
        ]);

        if (workoutsRes.data) {
            const months = eachMonthOfInterval({
                start: sixMonthsAgo,
                end: now
            });

            const stats = months.map(month => {
                const monthStr = format(month, "yyyy-MM");
                const count = workoutsRes.data.filter(w => format(parseISO(w.start_time), "yyyy-MM") === monthStr).length;
                return {
                    label: format(month, "MMM"),
                    value: count
                };
            });
            setMonthlyStats(stats);
        }

        if (setsRes.data) {
            const dist: Record<string, number> = {};
            setsRes.data.forEach((s: any) => {
                const mg = s.exercise?.muscle_group || "Other";
                dist[mg] = (dist[mg] || 0) + 1;
            });
            const distArray = Object.entries(dist)
                .map(([name, count]) => ({ name, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 5);
            setMuscleDist(distArray);
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

    const renderFrequencyChart = () => {
        const width = Dimensions.get("window").width - 64;
        const height = 150;
        const barWidth = 30;
        const gap = (width - barWidth * monthlyStats.length) / (monthlyStats.length + 1);

        const maxValue = Math.max(...monthlyStats.map(s => s.value), 1);

        return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>Workout Frequency</Text>
                <View style={styles.chartArea}>
                    <Svg width={width} height={height}>
                        {monthlyStats.map((s, i) => {
                            const barHeight = (s.value / maxValue) * (height - 40);
                            const x = gap + i * (barWidth + gap);
                            return (
                                <G key={i}>
                                    <Rect
                                        x={x}
                                        y={height - barHeight - 20}
                                        width={barWidth}
                                        height={barHeight}
                                        fill={colors.tint}
                                        rx="4"
                                    />
                                    <SvgText
                                        x={x + barWidth / 2}
                                        y={height - 5}
                                        fontSize="10"
                                        fill={colors.secondaryText}
                                        textAnchor="middle"
                                    >
                                        {s.label}
                                    </SvgText>
                                    <SvgText
                                        x={x + barWidth / 2}
                                        y={height - barHeight - 25}
                                        fontSize="10"
                                        fontWeight="700"
                                        fill={colors.text}
                                        textAnchor="middle"
                                    >
                                        {s.value}
                                    </SvgText>
                                </G>
                            );
                        })}
                    </Svg>
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Analytics</Text>
                <View style={{ width: 40 }} />
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.tint} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
                    {renderFrequencyChart()}

                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>Muscle Distribution (Sets)</Text>
                        <View style={styles.distList}>
                            {muscleDist.map((item, index) => (
                                <View key={item.name} style={styles.distRow}>
                                    <View style={styles.distInfo}>
                                        <Text style={[styles.distName, { color: colors.text }]}>{item.name}</Text>
                                        <Text style={[styles.distCount, { color: colors.secondaryText }]}>{item.count} sets</Text>
                                    </View>
                                    <View style={[styles.barBg, { backgroundColor: colors.secondary }]}>
                                        <View 
                                            style={[
                                                styles.barFill, 
                                                { 
                                                    backgroundColor: colors.tint, 
                                                    width: `${(item.count / muscleDist[0].count) * 100}%` 
                                                }
                                            ]} 
                                        />
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>

                    {/* Quick Stats */}
                    <View style={styles.quickStatsRow}>
                        <View style={[styles.quickStatBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Ionicons name="trophy-outline" size={24} color={colors.tint} />
                            <Text style={[styles.quickStatLabel, { color: colors.secondaryText }]}>Longest Streak</Text>
                            <Text style={[styles.quickStatValue, { color: colors.text }]}>12 Days</Text>
                        </View>
                        <View style={[styles.quickStatBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Ionicons name="flame-outline" size={24} color="#FF9500" />
                            <Text style={[styles.quickStatLabel, { color: colors.secondaryText }]}>Total Volume</Text>
                            <Text style={[styles.quickStatValue, { color: colors.text }]}>45.2k kg</Text>
                        </View>
                    </View>
                </ScrollView>
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

    content: { padding: 16, gap: 16 },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },

    card: {
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    cardTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 16 },
    chartArea: { alignItems: "center" },

    distList: { gap: 16 },
    distRow: { gap: 8 },
    distInfo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    distName: { fontSize: 14, fontWeight: "700" },
    distCount: { fontSize: 12, fontWeight: "500" },
    barBg: { height: 8, borderRadius: 4, width: "100%", overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 4 },

    quickStatsRow: { flexDirection: "row", gap: 12 },
    quickStatBox: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        alignItems: "center",
        gap: 4,
    },
    quickStatLabel: { fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
    quickStatValue: { fontSize: 18, fontWeight: "800" },
});

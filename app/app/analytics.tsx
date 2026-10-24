import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { 
    ActivityIndicator, 
    ScrollView, 
    StyleSheet, 
    Text, 
    View, 
    Pressable,
    useWindowDimensions
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { format, eachMonthOfInterval, parseISO } from "date-fns";
import { BarChart, LineChart } from "react-native-gifted-charts";

export default function Analytics() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();
    const { width: windowWidth } = useWindowDimensions();

    const [loading, setLoading] = useState(false);
    const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
    const [monthlyStats, setMonthlyStats] = useState<any[]>([]);
    const [muscleDist, setMuscleDist] = useState<any[]>([]);
    const [topExercises, setTopExercises] = useState<any[]>([]);
    const [prHistory, setPrHistory] = useState<any[]>([]);
    const [volumeTrend, setVolumeTrend] = useState<any[]>([]);
    const [strengthTrend, setStrengthTrend] = useState<any[]>([]);
    const [strengthStats, setStrengthStats] = useState<{
        dots: number;
        wilks: number;
        total: number;
        bodyweight: number;
        sbd: { squat: number, bench: number, deadlift: number }
    } | null>(null);

    const availableYears = useMemo(() => {
        const currentYear = new Date().getFullYear();
        return [currentYear, currentYear - 1, currentYear - 2, currentYear - 3, currentYear - 4];
    }, []);

    useFocusEffect(
        useCallback(() => {
            loadAnalytics(true);
        }, [selectedYear])
    );

    async function loadAnalytics(showLoader: boolean) {
        if (showLoader) setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setLoading(false);
            return;
        }

        const startOfYearDate = new Date(selectedYear, 0, 1);
        const endOfYearDate = new Date(selectedYear, 11, 31, 23, 59, 59);
        const startOfSelection = startOfYearDate.toISOString();
        const endOfSelection = endOfYearDate.toISOString();
        
        const [workoutsRes, profileRes] = await Promise.all([
            supabase.from("workouts").select("id, start_time").eq("user_id", user.id).gte("start_time", startOfSelection).lte("start_time", endOfSelection).order("start_time", { ascending: true }),
            supabase.from("profiles").select("bodyweight, gender").eq("id", user.id).single()
        ]);

        if (workoutsRes.error) {
            console.error("Error loading analytics workouts:", workoutsRes.error);
        }
        if (profileRes.error && profileRes.error.code !== "PGRST116") {
            console.error("Error loading analytics profile:", profileRes.error);
        }

        // These two datasets are independent. Fetching them concurrently avoids
        // making users wait for the full workout history before SBD data starts.
        const [workoutsWithSets, sbdData] = await Promise.all([
            (async () => {
                const result: any[] = [];
                const pageSize = 1000;
                for (let rangeStart = 0; ; rangeStart += pageSize) {
                    const { data, error } = await supabase
                        .from("workouts")
                        .select("id, start_time, sets(id, weight_kg, reps, exercise_id, exercises(id, name, muscle_group))")
                        .eq("user_id", user.id)
                        .gte("start_time", startOfSelection)
                        .lte("start_time", endOfSelection)
                        .order("start_time", { ascending: true })
                        .range(rangeStart, rangeStart + pageSize - 1);

                    if (error) {
                        console.error("Error loading analytics sets:", error);
                        break;
                    }
                    result.push(...(data ?? []));
                    if (!data || data.length < pageSize) break;
                }
                return result;
            })(),
            (async () => {
                const result: any[] = [];
                const pageSize = 1000;
                for (let rangeStart = 0; ; rangeStart += pageSize) {
                    const { data, error } = await supabase
                        .from("sets")
                        .select("weight_kg, reps, exercise:exercises(name), workouts!inner(user_id, start_time)")
                        .eq("workouts.user_id", user.id)
                        .lte("workouts.start_time", endOfSelection)
                        .range(rangeStart, rangeStart + pageSize - 1);

                    if (error) {
                        console.error("Error loading analytics SBD data:", error);
                        break;
                    }
                    result.push(...(data ?? []));
                    if (!data || data.length < pageSize) break;
                }
                return result;
            })(),
        ]);

        const months = eachMonthOfInterval({ start: startOfYearDate, end: endOfYearDate });

        if (workoutsRes.data) {
            const stats = months.map(month => {
                const monthStr = format(month, "yyyy-MM");
                const count = workoutsRes.data.filter(w => format(parseISO(w.start_time), "yyyy-MM") === monthStr).length;
                return { label: format(month, "MMM"), value: count };
            });
            setMonthlyStats(stats);
        }

        if (workoutsWithSets.length > 0) {
            const mgDist: Record<string, number> = {};
            const exFreq: Record<string, { name: string, count: number }> = {};
            const volTrend: Record<string, number> = {};
            const monthlySBD: Record<string, { squat: number, bench: number, deadlift: number }> = {};
            const prCountByMonth: Record<string, number> = {};
            const exerciseMaxes: Record<string, number> = {};

            const allSets: any[] = [];
            workoutsWithSets.forEach(w => {
                (w.sets || []).forEach((s: any) => {
                    allSets.push({ ...s, start_time: w.start_time });
                });
            });

            allSets.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

            allSets.forEach((s: any) => {
                const mg = s.exercises?.muscle_group || "Other";
                mgDist[mg] = (mgDist[mg] || 0) + 1;

                const exId = s.exercise_id || s.exercises?.id;
                if (exId) {
                    if (!exFreq[exId]) exFreq[exId] = { name: s.exercises?.name || "Unknown", count: 0 };
                    exFreq[exId].count++;
                }

                const mKey = format(parseISO(s.start_time), "yyyy-MM");
                const weight = s.weight_kg || 0;
                volTrend[mKey] = (volTrend[mKey] || 0) + (weight * (s.reps || 0));

                const oneRM = s.reps === 1 ? weight : weight / (1.0278 - (0.0278 * s.reps));
                
                const name = s.exercises?.name?.toLowerCase() || "";
                if (!monthlySBD[mKey]) monthlySBD[mKey] = { squat: 0, bench: 0, deadlift: 0 };
                
                if (name.includes("squat") && !name.includes("jump") && !name.includes("hack")) {
                    if (oneRM > monthlySBD[mKey].squat) monthlySBD[mKey].squat = oneRM;
                } else if (name.includes("bench press")) {
                    if (oneRM > monthlySBD[mKey].bench) monthlySBD[mKey].bench = oneRM;
                } else if (name.includes("deadlift") && !name.includes("romanian") && !name.includes("rdl")) {
                    if (oneRM > monthlySBD[mKey].deadlift) monthlySBD[mKey].deadlift = oneRM;
                }

                if (exId && (!exerciseMaxes[exId] || oneRM > exerciseMaxes[exId])) {
                    exerciseMaxes[exId] = oneRM;
                    prCountByMonth[mKey] = (prCountByMonth[mKey] || 0) + 1;
                }
            });

            setMuscleDist(Object.entries(mgDist).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5));
            setTopExercises(Object.values(exFreq).sort((a, b) => b.count - a.count).slice(0, 5));

            setVolumeTrend(months.map(m => ({
                label: format(m, "MMM"),
                value: Math.round((volTrend[format(m, "yyyy-MM")] || 0) / 1000)
            })));

            setStrengthTrend(months.map(m => {
                const monthKey = format(m, "yyyy-MM");
                const sbd = monthlySBD[monthKey] || { squat: 0, bench: 0, deadlift: 0 };
                const total1RM = sbd.squat + sbd.bench + sbd.deadlift;
                return { label: format(m, "MMM"), value: Math.round(total1RM) };
            }));

            setPrHistory(months.map(m => ({
                label: format(m, "MMM"),
                value: prCountByMonth[format(m, "yyyy-MM")] || 0,
                frontColor: colors.tint
            })));
        }

        if (profileRes.data && profileRes.data.bodyweight && sbdData.length > 0) {
            const bw = profileRes.data.bodyweight;
            const isMale = profileRes.data.gender === "male";
            const maxes = { squat: 0, bench: 0, deadlift: 0 };

            sbdData.forEach((s: any) => {
                const name = s.exercise?.name?.toLowerCase();
                if (!name) return;
                const weight = s.weight_kg || 0;
                const reps = s.reps || 0;
                const oneRM = reps === 1 ? weight : weight / (1.0278 - (0.0278 * reps));
                
                if (name.includes("squat") && !name.includes("jump") && !name.includes("hack")) {
                    if (oneRM > maxes.squat) maxes.squat = oneRM;
                } else if (name.includes("bench press")) {
                    if (oneRM > maxes.bench) maxes.bench = oneRM;
                } else if (name.includes("deadlift") && !name.includes("romanian") && !name.includes("rdl")) {
                    if (oneRM > maxes.deadlift) maxes.deadlift = oneRM;
                }
            });

            const total = maxes.squat + maxes.bench + maxes.deadlift;
            if (total > 0) {
                setStrengthStats({
                    dots: calculateDOTS(total, bw),
                    wilks: calculateWilks(total, bw, isMale),
                    total: Math.round(total),
                    bodyweight: bw,
                    sbd: {
                        squat: Math.round(maxes.squat),
                        bench: Math.round(maxes.bench),
                        deadlift: Math.round(maxes.deadlift)
                    }
                });
            }
        }
        setLoading(false);
    }

    function calculateDOTS(total: number, bw: number) {
        const a=47.46178854, b=8.472061379, c=0.07369410346, d=-0.002395190333, e=0.0000332659846, f=-0.00000019333;
        const den = a + b*bw + c*bw**2 + d*bw**3 + e*bw**4 + f*bw**5;
        return den > 0 ? Math.round(total * (500/den) * 100) / 100 : 0;
    }

    function calculateWilks(total: number, bw: number, isMale: boolean) {
        const coeff = isMale 
            ? { a: -216.0475144, b: 16.2606339, c: -0.002388645, d: -0.00113732, e: 7.01863e-6, f: -1.291e-8 }
            : { a: 594.31747775582, b: -27.23842536447, c: 0.82112226871, d: -0.00930733913, e: 4.731582e-5, f: -9.054e-8 };
        const den = coeff.a + coeff.b*bw + coeff.c*bw**2 + coeff.d*bw**3 + coeff.e*bw**4 + coeff.f*bw**5;
        return den > 0 ? Math.round(total * (500/den) * 100) / 100 : 0;
    }

    const handleBack = () => router.canGoBack() ? router.back() : router.replace("/app/dashboard");

    // Gifted charts position the final x-axis label beyond the nominal chart
    // width. Leave room for the y-axis and the final label so it stays inside
    // the card on narrow screens.
    const chartWidth = Math.max(260, Math.min(windowWidth - 132, 1040));
    const chartSpacing = Math.max(24, (chartWidth - 60) / 11);
    const compactChartData = (data: any[]) => data.map((item) => ({
        ...item,
        label: String(item.label).slice(0, 2),
    }));
    const renderMonthLabels = () => (
        <View style={styles.monthLabels}>
            {monthlyStats.map((month) => (
                <Text key={month.label} style={[styles.monthLabel, { color: colors.secondaryText }]}>
                    {String(month.label).slice(0, 2)}
                </Text>
            ))}
        </View>
    );

    const renderFrequencyChart = () => {
        if (monthlyStats.length === 0) return null;
        const maxValue = Math.max(...monthlyStats.map(s => s.value), 1);

        return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>{t("app.analytics.workout_frequency")}</Text>
                <View style={styles.chartViewport}>
                    <BarChart
                            data={compactChartData(monthlyStats)}
                            height={130}
                            width={chartWidth}
                            maxValue={maxValue * 1.6}
                            barWidth={16}
                            initialSpacing={30}
                            spacing={chartSpacing}
                            barBorderRadius={3}
                            frontColor={colors.tint}
                            noOfSections={3}
                            yAxisThickness={0}
                            xAxisThickness={0}
                            yAxisLabelWidth={30}
                            yAxisTextStyle={{ color: colors.secondaryText, fontSize: 8, fontFamily: 'System' }}
                            xAxisLabelTextStyle={{ color: "transparent", fontSize: 0, fontFamily: 'System' }}
                            disableScroll
                            endSpacing={16}
                    />
                    {renderMonthLabels()}
                </View>
            </View>
        );
    };

    const renderVolumeTrend = () => {
        if (volumeTrend.length === 0) return null;
        const maxValue = Math.max(...volumeTrend.map(v => v.value), 10);

        return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>{t("app.analytics.volume_trend")}</Text>
                <View style={styles.chartViewport}>
                    <LineChart
                            data={compactChartData(volumeTrend)}
                            height={130}
                            width={chartWidth}
                            maxValue={maxValue * 1.6}
                            initialSpacing={30}
                            spacing={chartSpacing}
                            color={colors.tint}
                            thickness={3}
                            startFillColor={colors.tint}
                            startOpacity={0.2}
                            endOpacity={0.01}
                            areaChart
                            noOfSections={3}
                            yAxisThickness={0}
                            xAxisThickness={0}
                            yAxisLabelWidth={30}
                            yAxisTextStyle={{ color: colors.secondaryText, fontSize: 8, fontFamily: 'System' }}
                            xAxisLabelTextStyle={{ color: "transparent", fontSize: 0, fontFamily: 'System' }}
                            hideDataPoints={false}
                            dataPointsRadius={4}
                            disableScroll
                            endSpacing={16}
                    />
                    {renderMonthLabels()}
                </View>
            </View>
        );
    };

    const renderStrengthTrend = () => {
        if (strengthTrend.length === 0) return null;
        const maxValue = Math.max(...strengthTrend.map(v => v.value), 10);

        return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>{t("app.analytics.strength_trend")}</Text>
                <View style={styles.chartViewport}>
                    <BarChart
                            data={compactChartData(strengthTrend)}
                            height={130}
                            width={chartWidth}
                            maxValue={maxValue * 1.6}
                            barWidth={16}
                            initialSpacing={30}
                            spacing={chartSpacing}
                            barBorderRadius={3}
                            frontColor={colors.tint}
                            noOfSections={3}
                            yAxisThickness={0}
                            xAxisThickness={0}
                            yAxisLabelWidth={30}
                            yAxisTextStyle={{ color: colors.secondaryText, fontSize: 8, fontFamily: 'System' }}
                            xAxisLabelTextStyle={{ color: "transparent", fontSize: 0, fontFamily: 'System' }}
                            topLabelTextStyle={{ color: colors.text, fontSize: 8, fontWeight: '800', fontFamily: 'System' }}
                            disableScroll
                            endSpacing={16}
                    />
                    {renderMonthLabels()}
                </View>
            </View>
        );
    };

    const renderPRHistory = () => {
        if (prHistory.length === 0) return null;
        const maxValue = Math.max(...prHistory.map(v => v.value), 10);

        return (
            <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.cardHeaderWithAction}>
                    <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>{t("app.analytics.milestones")}</Text>
                    <Pressable onPress={() => router.push("/app/milestones")}>
                        <Text style={[styles.viewAllBtn, { color: colors.tint }]}>{t("app.analytics.view_all")}</Text>
                    </Pressable>
                </View>
                <View style={styles.chartViewport}>
                    <BarChart
                            data={compactChartData(prHistory)}
                            height={130}
                            width={chartWidth}
                            maxValue={maxValue * 1.6}
                            barWidth={16}
                            initialSpacing={30}
                            spacing={chartSpacing}
                            barBorderRadius={3}
                            frontColor={colors.tint}
                            noOfSections={3}
                            yAxisThickness={0}
                            xAxisThickness={0}
                            yAxisLabelWidth={30}
                            yAxisTextStyle={{ color: colors.secondaryText, fontSize: 8, fontFamily: 'System' }}
                            xAxisLabelTextStyle={{ color: "transparent", fontSize: 0, fontFamily: 'System' }}
                            topLabelTextStyle={{ color: colors.text, fontSize: 8, fontWeight: '800', fontFamily: 'System' }}
                            disableScroll
                            endSpacing={16}
                            onPress={(item: any) => {
                                router.push({
                                    pathname: "/app/milestones",
                                    params: { highlightMonth: item.label }
                                });
                            }}
                    />
                    {renderMonthLabels()}
                </View>
            </View>
        );
    };

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn}><Ionicons name="chevron-back" size={28} color={colors.text} /></Pressable>
                <Text style={[styles.headerTitle, { color: colors.text }]}>{t("app.analytics.title")}</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={[styles.yearSelector, { borderBottomColor: colors.border }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.yearList}>
                    {availableYears.map(year => (
                        <Pressable 
                            key={year} 
                            onPress={() => setSelectedYear(year)}
                            style={[styles.yearTab, selectedYear === year && { backgroundColor: colors.tint }]}
                        >
                            <Text style={[styles.yearText, { color: selectedYear === year ? "#FFF" : colors.secondaryText }]}>{year}</Text>
                        </Pressable>
                    ))}
                </ScrollView>
            </View>

            {loading ? (
                <View style={styles.center}><ActivityIndicator size="large" color={colors.tint} /></View>
            ) : (
                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 20 }]}>
                    {renderFrequencyChart()}
                    {renderVolumeTrend()}
                    {renderStrengthTrend()}
                    {strengthStats && (
                        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>{t("app.analytics.strength_standards")}</Text>
                            <View style={styles.strengthGrid}>
                                <View style={styles.scoreBox}><Text style={[styles.scoreLabel, { color: colors.tint }]}>{t("app.analytics.score")}</Text><Text style={[styles.scoreValue, { color: colors.text }]}>{strengthStats.dots}</Text></View>
                                <View style={styles.scoreBox}><Text style={[styles.scoreLabel, { color: "#5856D6" }]}>WILKS</Text><Text style={[styles.scoreValue, { color: colors.text }]}>{strengthStats.wilks}</Text></View>
                            </View>
                            <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
                                <View style={styles.totalItem}><Text style={[styles.totalLabel, { color: colors.secondaryText }]}>Total</Text><Text style={[styles.totalValue, { color: colors.text }]}>{strengthStats.total}kg</Text></View>
                                <View style={styles.totalItem}><Text style={[styles.totalLabel, { color: colors.secondaryText }]}>BW</Text><Text style={[styles.totalValue, { color: colors.text }]}>{strengthStats.bodyweight}kg</Text></View>
                                <View style={styles.totalItem}><Text style={[styles.totalLabel, { color: colors.secondaryText }]}>Ratio</Text><Text style={[styles.totalValue, { color: colors.text }]}>{(strengthStats.total / strengthStats.bodyweight).toFixed(2)}x</Text></View>
                            </View>
                            <View style={styles.sbdBreakdown}>
                                <View style={styles.sbdItem}><Text style={[styles.sbdLabel, { color: "#f48fb1" }]}>S</Text><Text style={[styles.sbdValue, { color: colors.text }]}>{strengthStats.sbd.squat}</Text></View>
                                <View style={styles.sbdItem}><Text style={[styles.sbdLabel, { color: "#90caf9" }]}>B</Text><Text style={[styles.sbdValue, { color: colors.text }]}>{strengthStats.sbd.bench}</Text></View>
                                <View style={styles.sbdItem}><Text style={[styles.sbdLabel, { color: "#66bb6a" }]}>D</Text><Text style={[styles.sbdValue, { color: colors.text }]}>{strengthStats.sbd.deadlift}</Text></View>
                            </View>
                        </View>
                    )}
                    {renderPRHistory()}
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>{t("app.analytics.most_frequent")}</Text>
                        <View style={styles.distList}>
                            {topExercises.map((item, index) => (
                                <View key={index} style={styles.distRow}>
                                    <View style={styles.distInfo}><Text style={[styles.distName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text><Text style={[styles.distCount, { color: colors.secondaryText }]}>{item.count} sets</Text></View>
                                    <View style={[styles.barBg, { backgroundColor: colors.secondary }]}>
                                        {topExercises.length > 0 && topExercises[0].count > 0 && (
                                            <View style={[styles.barFill, { backgroundColor: colors.tint, width: `${(item.count / topExercises[0].count) * 100}%` }]} />
                                        )}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <Text style={[styles.cardTitle, { color: colors.secondaryText }]}>{t("app.analytics.muscle_distribution")}</Text>
                        <View style={styles.distList}>
                            {muscleDist.map((item, index) => (
                                <View key={item.name} style={styles.distRow}>
                                    <View style={styles.distInfo}><Text style={[styles.distName, { color: colors.text }]}>{item.name}</Text><Text style={[styles.distCount, { color: colors.secondaryText }]}>{item.count} sets</Text></View>
                                    <View style={[styles.barBg, { backgroundColor: colors.secondary }]}>
                                        {muscleDist.length > 0 && muscleDist[0].count > 0 && (
                                            <View style={[styles.barFill, { backgroundColor: colors.tint, width: `${(item.count / muscleDist[0].count) * 100}%` }]} />
                                        )}
                                    </View>
                                </View>
                            ))}
                        </View>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1 },
    backBtn: { width: 40, height: 40, justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "700" },
    yearSelector: { height: 50, borderBottomWidth: 1 },
    yearList: { paddingHorizontal: 16, alignItems: 'center', gap: 12 },
    yearTab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16, backgroundColor: 'rgba(128,128,128,0.1)' },
    yearText: { fontSize: 13, fontWeight: '700' },
    content: { width: "100%", maxWidth: 1120, alignSelf: "center", padding: 16, gap: 16 },
    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    card: { padding: 16, borderRadius: 16, borderWidth: 1 },
    chartViewport: { width: "100%", marginTop: 25, paddingLeft: 10, overflow: "hidden" },
    monthLabels: { flexDirection: "row", justifyContent: "space-between", paddingLeft: 45, paddingRight: 25, marginTop: -8 },
    monthLabel: { width: 18, fontSize: 8, textAlign: "center" },
    cardTitle: { fontSize: 12, fontWeight: "700", textTransform: "uppercase", marginBottom: 16 },
    cardHeaderWithAction: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
    viewAllBtn: { fontSize: 10, fontWeight: "900" },
    chartArea: { alignItems: "center" },
    strengthGrid: { flexDirection: "row", gap: 12, marginBottom: 20 },
    scoreBox: { flex: 1, alignItems: "center", padding: 12, borderRadius: 12, backgroundColor: "rgba(128,128,128,0.05)" },
    scoreLabel: { fontSize: 10, fontWeight: "900", marginBottom: 4 },
    scoreValue: { fontSize: 24, fontWeight: "900", fontFamily: "System" },
    totalRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-around", paddingTop: 16, borderTopWidth: 1, marginBottom: 20 },
    totalItem: { alignItems: "center" },
    totalLabel: { fontSize: 10, fontWeight: "700", textTransform: "uppercase", marginBottom: 2 },
    totalValue: { fontSize: 16, fontWeight: "800" },
    sbdBreakdown: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 32 },
    sbdItem: { flexDirection: "row", alignItems: "baseline", gap: 4 },
    sbdLabel: { fontSize: 12, fontWeight: "900" },
    sbdValue: { fontSize: 18, fontWeight: "800" },
    distList: { gap: 16 },
    distRow: { gap: 8 },
    distInfo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    distName: { fontSize: 14, fontWeight: "700" },
    distCount: { fontSize: 12, fontWeight: "500" },
    barBg: { height: 8, borderRadius: 4, width: "100%", overflow: "hidden" },
    barFill: { height: "100%", borderRadius: 4 }
});

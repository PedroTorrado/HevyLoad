import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback, useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, View, Platform, ActivityIndicator, Image, useColorScheme } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";

export default function Dashboard() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();
    const scheme = useColorScheme();
    
    // Initialize loading as false to prevent immediate flicker
    const [loading, setLoading] = useState(false);
    const hasLoaded = useRef(false);
    const [userName, setUserName] = useState("User");
    const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
    const [stats, setStats] = useState({
        totalWorkouts: 0,
        totalVolume: 0,
        workoutsThisWeek: 0,
        weeklyTonnage: 0,
        powerliftingTotal: 0
    });
    const [recentWorkouts, setRecentWorkouts] = useState<any[]>([]);
    const [sbdLifts, setSbdLifts] = useState<{name: string, value: number, id: string, type: string}[]>([]);
    const [otherLifts, setOtherLifts] = useState<{name: string, value: number, id: string}[]>([]);

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
            const [profileRes, workoutsRes, exercisesRes] = await Promise.all([
                supabase.from("profiles").select("full_name, avatar_url, featured_exercise_ids").eq("id", user.id).single(),
                supabase.from("workouts").select("id, start_time, title").eq("user_id", user.id).order("start_time", { ascending: false }),
                supabase.from("exercises").select("id, name").eq("user_id", user.id)
            ]);

            if (profileRes.data) {
                setUserName(profileRes.data.full_name || user.user_metadata?.full_name || "User");
                setAvatarUrl(profileRes.data.avatar_url);
            }

            let thisWeekCount = 0;
            if (workoutsRes.data) {
                const workouts = workoutsRes.data;
                const now = new Date();
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                thisWeekCount = workouts.filter(w => new Date(w.start_time) >= startOfWeek).length;

                setStats(prev => ({ ...prev, totalWorkouts: workouts.length, workoutsThisWeek: thisWeekCount }));
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
                
                const [targetSetsRes, volumeRes] = await Promise.all([
                    targetIdsArray.length > 0 
                        ? supabase.from("sets")
                            .select("weight_kg, reps, exercise_id")
                            .eq("user_id", user.id)
                            .in("exercise_id", targetIdsArray)
                            .order("weight_kg", { ascending: false })
                        : Promise.resolve({ data: [] }),
                    supabase.from("sets")
                        .select("weight_kg, reps, workouts(start_time)")
                        .eq("user_id", user.id)
                ]);

                // Calculate Volume & Weekly Tonnage
                let totalVolume = 0;
                let weeklyTonnage = 0;
                const now = new Date();
                const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
                startOfWeek.setHours(0, 0, 0, 0);

                if (volumeRes.data) {
                    volumeRes.data.forEach((set: any) => {
                        const weight = set.weight_kg || 0;
                        const reps = set.reps || 0;
                        const vol = weight * reps;
                        totalVolume += vol;
                        
                        if (set.workouts?.start_time) {
                            const workoutDate = new Date(set.workouts.start_time);
                            if (workoutDate >= startOfWeek) {
                                weeklyTonnage += vol;
                            }
                        }
                    });
                }

                // Calculate PRs from target sets
                const exerciseMaxes: Record<string, { name: string, weight: number }> = {};
                targetIdsArray.forEach(id => {
                    const ex = exercisesRes.data!.find(e => e.id === id);
                    if (ex) exerciseMaxes[id] = { name: ex.name, weight: 0 };
                });

                if (targetSetsRes.data) {
                    targetSetsRes.data.forEach(set => {
                        if (exerciseMaxes[set.exercise_id]) {
                            const weight = set.weight_kg || 0;
                            if (weight > exerciseMaxes[set.exercise_id].weight) {
                                exerciseMaxes[set.exercise_id].weight = weight;
                            }
                        }
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
            title: t("app.dashboard.import_card.title"),
            desc: t("app.dashboard.import_card.subtitle"),
            route: "/app/import",
            icon: "cloud-upload" as const,
            color: "#FF9500",
        },
    ];

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
                        <View style={[styles.totalBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
                            <View>
                                <Text style={[styles.totalLabel, { color: colors.secondaryText }]}>SBD TOTAL</Text>
                                <Text style={[styles.totalValue, { color: colors.text }]}>{stats.powerliftingTotal.toLocaleString()} <Text style={styles.unit}>kg</Text></Text>
                            </View>
                            <View style={[styles.totalBadge, { backgroundColor: colors.tint + "20" }]}>
                                <Ionicons name="trophy" size={24} color={colors.tint} />
                            </View>
                        </View>
                    )}

                    {/* Stats Grid */}
                    <View style={styles.statsGrid}>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.totalWorkouts}</Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{t("app.dashboard.stats.workouts")}</Text>
                        </View>
                        <View style={[styles.statCard, { backgroundColor: colors.card }]}>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.workoutsThisWeek}</Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>{t("app.dashboard.stats.this_week")}</Text>
                        </View>
                        <View style={[styles.statCard, { flex: 2, backgroundColor: colors.card }]}>
                            <Text style={[styles.statValue, { color: colors.text }]}>{stats.weeklyTonnage.toLocaleString()} kg</Text>
                            <Text style={[styles.statLabel, { color: colors.secondaryText }]}>WEEKLY TONNAGE</Text>
                        </View>
                    </View>

                    {/* The Big 3 Showdown */}
                    {sbdLifts.length > 0 && (
                        <View style={styles.big3Section}>
                            <Text style={[styles.sectionTitle, { color: colors.accentText }]}>The Big Three</Text>
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
                                            style={[styles.big3Card, { backgroundColor: theme.bg + "15", borderColor: theme.bg + "30" }]}
                                            onPress={() => router.push(`/app/exercise/${lift.id}` as any)}
                                        >
                                            <View style={[styles.big3Icon, { backgroundColor: theme.bg }]}>
                                                <Ionicons name={theme.icon} size={16} color="#FFF" />
                                            </View>
                                            <Text style={[styles.big3Name, { color: colors.secondaryText }]}>{lift.type.toUpperCase()}</Text>
                                            <Text style={[styles.big3Value, { color: colors.text }]}>{lift.value}<Text style={styles.big3Unit}>kg</Text></Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>
                    )}

                    {/* Other Featured Lifts */}
                    {otherLifts.length > 0 && (
                        <View style={styles.maxSection}>
                            <Text style={[styles.sectionTitle, { color: colors.accentText }]}>Accessories & Highlights</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.maxGrid}>
                                {otherLifts.map((lift) => (
                                    <Pressable 
                                        key={lift.id} 
                                        style={[styles.maxCard, { backgroundColor: colors.card }]}
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
                                    <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{t("app.dashboard.sections.recent_workouts")}</Text>
                                    {recentWorkouts.map((workout) => (
                                        <View key={workout.id} style={[styles.workoutItem, { borderBottomColor: colors.border }]}>
                                            <View style={[styles.workoutIcon, { backgroundColor: colors.secondary }]}>
                                                <Ionicons name="fitness" size={20} color={colors.text} />
                                            </View>
                                            <View style={{ flex: 1 }}>
                                                <Text style={[styles.workoutTitle, { color: colors.text }]}>{workout.title || "Workout"}</Text>
                                                <Text style={[styles.workoutDate, { color: colors.secondaryText }]}>{new Date(workout.start_time).toLocaleDateString()}</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={16} color={colors.border} />
                                        </View>
                                    ))}
                                </View>
                            )}

                            {/* Modules Grid */}
                            <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{t("app.dashboard.sections.quick_actions")}</Text>
                            <View style={styles.modulesGrid}>
                                {NAV_ITEMS.map((item) => (
                                    <Pressable key={item.title} style={[styles.navCard, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => router.push(item.route as any)}>
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
    pageFrame: { paddingHorizontal: 24 },
    
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

    statsGrid: { flexDirection: "row", gap: 12, marginBottom: 32 },
    statCard: {
        flex: 1,
        padding: 16,
        borderRadius: 16,
    },
    statValue: { fontSize: 18, fontWeight: "900", fontFamily: "System", letterSpacing: -0.5 },
    statLabel: { fontSize: 9, fontWeight: "800", marginTop: 4, textTransform: "uppercase", fontFamily: "System", opacity: 0.8 },

    totalBanner: {
        flexDirection: "row",
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
    big3Grid: { flexDirection: "row", gap: 10 },
    big3Card: {
        flex: 1,
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
    workoutItem: {
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    workoutIcon: {
        width: 40,
        height: 40,
        borderRadius: 8,
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

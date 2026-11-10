import { Ionicons } from "@expo/vector-icons";
import { useRouter, useFocusEffect } from "expo-router";
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
    TextInput,
    View,
    ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";

interface Exercise {
    id: string;
    name: string;
    muscle_group: string | null;
    sets_count: number;
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

export default function Exercises() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(false);
    const [exercises, setExercises] = useState<Exercise[]>([]);
    const [featuredIds, setFeaturedIds] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState("");

    useFocusEffect(
        useCallback(() => {
            let isMounted = true;

            async function loadExercises() {
                if (exercises.length === 0) setLoading(true);
                try {
                    const { data: { session } } = await supabase.auth.getSession();
                    const user = session?.user;
                    if (!user || !isMounted) return;

                    // Fetch exercises and profile (for featured exercises) in parallel
                    const [exercisesRes, profileRes] = await Promise.all([
                        supabase.from("exercises").select("*, sets(count)").eq("user_id", user.id),
                        supabase.from("profiles").select("featured_exercise_ids").eq("id", user.id).single(),
                    ]);

                    if (!isMounted) return;

                    const featured: string[] = profileRes.data?.featured_exercise_ids || [];
                    setFeaturedIds(featured);

                    if (exercisesRes.error) {
                        console.error("Error loading exercises:", exercisesRes.error);
                        setExercises([]);
                        return;
                    }

                    const mappedData: Exercise[] = (exercisesRes.data || []).map((ex: any) => ({
                        ...ex,
                        sets_count: ex.sets?.[0]?.count || 0,
                    }));

                    // Sort: Featured first, then by sets_count descending, then by name ascending
                    mappedData.sort((a, b) => {
                        const aFeatured = featured.includes(a.id);
                        const bFeatured = featured.includes(b.id);
                        if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;
                        if (b.sets_count !== a.sets_count) return b.sets_count - a.sets_count;
                        return a.name.localeCompare(b.name);
                    });

                    setExercises(mappedData);
                } catch (error: any) {
                    if (!error?.message?.includes("aborted")) {
                        console.error("Exercises load error:", error);
                    }
                } finally {
                    if (isMounted) setLoading(false);
                }
            }

            loadExercises();

            return () => {
                isMounted = false;
            };
        }, [])
    );

    async function toggleFavorite(exerciseId: string) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            const user = session?.user;
            if (!user) return;

            const newFeaturedIds = featuredIds.includes(exerciseId)
                ? featuredIds.filter((id) => id !== exerciseId)
                : [...featuredIds, exerciseId];

            const { error } = await supabase
                .from("profiles")
                .update({ featured_exercise_ids: newFeaturedIds })
                .eq("id", user.id);

            if (error) throw error;
            setFeaturedIds(newFeaturedIds);
        } catch (e) {
            console.error("Error toggling favorite:", e);
        }
    }

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    };

    const query = searchQuery.toLowerCase();
    const filteredExercises = exercises.filter(
        (ex) => ex.name.toLowerCase().includes(query) || (ex.muscle_group?.toLowerCase().includes(query) ?? false)
    );

    const renderExerciseItem = ({ item, index }: { item: Exercise; index: number }) => {
        const isFeatured = featuredIds.includes(item.id);

        return (
            <FadeInView delay={Math.min(300, index * 40)}>
                <ScalePressable
                    onPress={() => router.push(`/app/exercise/${item.id}` as any)}
                    style={[styles.exerciseCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    accessibilityLabel={item.name}
                >
                    <Pressable
                        onPress={() => toggleFavorite(item.id)}
                        hitSlop={6}
                        accessibilityRole="button"
                        accessibilityLabel={isFeatured ? `Unstar ${item.name}` : `Star ${item.name}`}
                        style={[
                            styles.starBadge,
                            isFeatured
                                ? { backgroundColor: "#FFD70018", borderColor: "#FFD70040" }
                                : { backgroundColor: colors.tint + "12", borderColor: colors.tint + "28" },
                        ]}
                    >
                        <Ionicons
                            name={isFeatured ? "star" : "star-outline"}
                            size={20}
                            color={isFeatured ? "#FFD700" : colors.secondaryText}
                        />
                    </Pressable>

                    <View style={styles.exerciseInfo}>
                        <Text style={[styles.exerciseName, { color: colors.text }]} numberOfLines={1}>
                            {item.name}
                        </Text>
                        <View style={styles.exerciseMeta}>
                            <Ionicons name="body-outline" size={13} color={colors.secondaryText} />
                            <Text style={[styles.metaText, { color: colors.secondaryText }]}>
                                {item.muscle_group || t("app.exercises.no_muscle_group")}
                            </Text>
                            <View style={[styles.metaDot, { backgroundColor: colors.border }]} />
                            <Ionicons name="layers-outline" size={13} color={colors.secondaryText} />
                            <Text style={[styles.metaText, { color: colors.secondaryText }]}>
                                {item.sets_count} {t("app.workout.sets")}
                            </Text>
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
                        {t("app.exercises.title")}
                    </Text>
                    <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
                        {exercises.length} {exercises.length === 1 ? "exercise" : "exercises"} · {featuredIds.length} starred
                    </Text>
                </View>

                <View style={styles.backBtn} />
            </View>

            {/* Search Bar */}
            <View style={[styles.searchContainer, { borderBottomColor: colors.border }]}>
                <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Ionicons name="search" size={18} color={colors.secondaryText} style={styles.searchIcon} />
                    <TextInput
                        placeholder={t("app.exercises.search_placeholder")}
                        placeholderTextColor={colors.secondaryText}
                        style={[styles.searchInput, { color: colors.text }]}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        accessibilityLabel={t("app.exercises.search_placeholder")}
                    />
                    {searchQuery.length > 0 && (
                        <Pressable
                            onPress={() => setSearchQuery("")}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel="Clear search"
                        >
                            <Ionicons name="close-circle" size={18} color={colors.secondaryText} />
                        </Pressable>
                    )}
                </View>
            </View>

            {loading && exercises.length === 0 ? (
                <View style={[styles.center, { backgroundColor: colors.background }]}>
                    <ActivityIndicator size="large" color={colors.tint} />
                </View>
            ) : (
                <FlatList
                    data={filteredExercises}
                    renderItem={renderExerciseItem}
                    keyExtractor={(item) => item.id}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 32 }]}
                    ListEmptyComponent={
                        <FadeInView style={styles.emptyState}>
                            <View style={[styles.emptyIconCircle, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                <Ionicons
                                    name={searchQuery ? "search-outline" : "barbell-outline"}
                                    size={36}
                                    color={colors.secondaryText}
                                />
                            </View>
                            <Text style={[styles.emptyTitle, { color: colors.text }]}>
                                {searchQuery ? t("app.exercises.no_results") : t("app.exercises.no_exercises")}
                            </Text>
                            {searchQuery ? (
                                <Pressable
                                    onPress={() => setSearchQuery("")}
                                    style={[styles.emptyActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                                    accessibilityRole="button"
                                    accessibilityLabel="Clear search"
                                >
                                    <Text style={[styles.emptyActionText, { color: colors.tint }]}>Clear search</Text>
                                </Pressable>
                            ) : (
                                <Pressable
                                    onPress={() => router.push("/app/import" as any)}
                                    style={[styles.emptyActionBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
                                    accessibilityRole="button"
                                    accessibilityLabel={t("app.dashboard.import_card.title")}
                                >
                                    <Text style={[styles.emptyActionText, { color: colors.tint }]}>
                                        {t("app.dashboard.import_card.title")}
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
        alignItems: "center",
    },
    headerInfo: {
        flex: 1,
        alignItems: "center",
        paddingHorizontal: 8,
    },
    headerTitle: {
        fontSize: 16,
        fontWeight: "800",
        fontFamily: "System",
    },
    headerSubtitle: {
        fontSize: 12,
        fontWeight: "600",
        fontFamily: "System",
        marginTop: 1,
    },

    searchContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    searchBar: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        height: 42,
        borderRadius: 12,
        borderWidth: 1,
        width: "100%",
        maxWidth: 920,
        alignSelf: "center",
    },
    searchIcon: { marginRight: 8 },
    searchInput: { flex: 1, fontSize: 14, fontWeight: "600", fontFamily: "System" },

    listContent: {
        padding: 16,
        width: "100%",
        maxWidth: 920,
        alignSelf: "center",
        gap: 10,
    },

    exerciseCard: {
        flexDirection: "row",
        alignItems: "center",
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        gap: 12,
    },
    starBadge: {
        width: 44,
        height: 44,
        borderRadius: 12,
        borderWidth: 1,
        justifyContent: "center",
        alignItems: "center",
    },
    exerciseInfo: { flex: 1 },
    exerciseName: { fontSize: 15, fontWeight: "800", fontFamily: "System", marginBottom: 3 },
    exerciseMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4 },
    metaText: { fontSize: 12, fontWeight: "600", fontFamily: "System" },
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
    emptyTitle: { fontSize: 15, fontWeight: "800", fontFamily: "System", textAlign: "center", paddingHorizontal: 32 },
    emptyActionBtn: {
        marginTop: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 12,
        borderWidth: 1,
    },
    emptyActionText: { fontSize: 13, fontWeight: "800", fontFamily: "System" },
});

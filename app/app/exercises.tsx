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
    TextInput 
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

export default function Exercises() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(false);
    const hasLoaded = useRef(false);
    const [exercises, setExercises] = useState<Exercise[]>([]);
    const [featuredIds, setFeaturedIds] = useState<string[]>([]);
    const [searchQuery, setSearchQuery] = useState("");

    useFocusEffect(
        useCallback(() => {
            loadExercises(false);
        }, [])
    );

    useEffect(() => {
        loadExercises(true);
        hasLoaded.current = true;
    }, []);

    async function loadExercises(showLoader: boolean) {
        if (showLoader && exercises.length === 0) setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Fetch exercises and profile (for featured exercises) in parallel
        const [exercisesRes, profileRes] = await Promise.all([
            supabase
                .from("exercises")
                .select(`
                    *,
                    sets(count)
                `)
                .eq("user_id", user.id),
            supabase
                .from("profiles")
                .select("featured_exercise_ids")
                .eq("id", user.id)
                .single()
        ]);

        if (profileRes.data) {
            setFeaturedIds(profileRes.data.featured_exercise_ids || []);
        }

        if (exercisesRes.error) {
            console.error("Error loading exercises:", exercisesRes.error);
        } else {
            const mappedData: Exercise[] = (exercisesRes.data || []).map((ex: any) => ({
                ...ex,
                sets_count: ex.sets?.[0]?.count || 0
            }));

            // Sort: Featured first, then by sets_count descending, then by name ascending
            mappedData.sort((a, b) => {
                const aFeatured = (profileRes.data?.featured_exercise_ids || []).includes(a.id);
                const bFeatured = (profileRes.data?.featured_exercise_ids || []).includes(b.id);
                
                if (aFeatured && !bFeatured) return -1;
                if (!aFeatured && bFeatured) return 1;
                
                if (b.sets_count !== a.sets_count) {
                    return b.sets_count - a.sets_count;
                }
                return a.name.localeCompare(b.name);
            });

            setExercises(mappedData);
        }

        setLoading(false);
    }

    async function toggleFavorite(exerciseId: string) {
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            let newFeaturedIds = [...featuredIds];
            if (newFeaturedIds.includes(exerciseId)) {
                newFeaturedIds = newFeaturedIds.filter(id => id !== exerciseId);
            } else {
                newFeaturedIds.push(exerciseId);
            }

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

    const filteredExercises = exercises.filter(ex => 
        ex.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (ex.muscle_group && ex.muscle_group.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    const renderExerciseItem = ({ item }: { item: Exercise }) => {
        const isFeatured = featuredIds.includes(item.id);
        
        return (
            <Pressable 
                style={[styles.exerciseCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push(`/app/exercise/${item.id}` as any)}
            >
                <Pressable 
                    onPress={() => toggleFavorite(item.id)}
                    style={styles.starButton}
                >
                    <Ionicons 
                        name={isFeatured ? "star" : "star-outline"} 
                        size={22} 
                        color={isFeatured ? "#FFD700" : colors.secondaryText} 
                    />
                </Pressable>

                <View style={styles.exerciseInfo}>
                    <Text style={[styles.exerciseName, { color: colors.text }]}>{item.name}</Text>
                    <View style={styles.exerciseMeta}>
                        <Text style={[styles.muscleGroup, { color: colors.secondaryText }]}>
                            {item.muscle_group || t("app.exercises.no_muscle_group")}
                        </Text>
                        <View style={[styles.dot, { backgroundColor: colors.border }]} />
                        <Text style={[styles.performanceCount, { color: colors.tint }]}>
                            {item.sets_count} {item.sets_count === 1 ? "set" : "sets"}
                        </Text>
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
                <Text style={[styles.headerTitle, { color: colors.text }]}>{t("app.exercises.title")}</Text>
                <View style={{ width: 40 }} />
            </View>

            {/* Search Bar */}
            <View style={[styles.searchContainer, { borderBottomColor: colors.border }]}>
                <View style={[styles.searchBar, { backgroundColor: colors.secondary }]}>
                    <Ionicons name="search" size={20} color={colors.secondaryText} style={styles.searchIcon} />
                    <TextInput
                        placeholder={t("app.exercises.search_placeholder")}
                        placeholderTextColor={colors.secondaryText}
                        style={[styles.searchInput, { color: colors.text }]}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                    />
                    {searchQuery.length > 0 && (
                        <Pressable onPress={() => setSearchQuery("")}>
                            <Ionicons name="close-circle" size={20} color={colors.secondaryText} />
                        </Pressable>
                    )}
                </View>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.tint} />
                </View>
            ) : (
                <FlatList
                    data={filteredExercises}
                    renderItem={renderExerciseItem}
                    keyExtractor={(item) => item.id}
                    contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 20 }]}
                    ListEmptyComponent={
                        <View style={styles.emptyState}>
                            <Ionicons name="barbell-outline" size={64} color={colors.border} />
                            <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
                                {searchQuery ? t("app.exercises.no_results") : t("app.exercises.no_exercises")}
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

    searchContainer: {
        padding: 16,
        borderBottomWidth: 1,
    },
    searchBar: {
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 12,
        height: 44,
        borderRadius: 10,
    },
    searchIcon: { marginRight: 8 },
    searchInput: { flex: 1, fontSize: 16, fontWeight: "500" },

    listContent: { padding: 16, gap: 12 },
    exerciseCard: {
        flexDirection: "row",
        alignItems: "center",
        padding: 12,
        borderRadius: 12,
        borderWidth: 1,
    },
    starButton: {
        width: 40,
        height: 40,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 8,
    },
    iconContainer: {
        width: 48,
        height: 48,
        borderRadius: 10,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 16,
    },
    exerciseInfo: { flex: 1 },
    exerciseName: { fontSize: 16, fontWeight: "700", marginBottom: 2 },
    exerciseMeta: {
        flexDirection: "row",
        alignItems: "center",
    },
    muscleGroup: { fontSize: 13, fontWeight: "500" },
    dot: {
        width: 3,
        height: 3,
        borderRadius: 1.5,
        marginHorizontal: 8,
    },
    performanceCount: { fontSize: 13, fontWeight: "600" },

    center: { flex: 1, justifyContent: "center", alignItems: "center" },
    emptyState: { flex: 1, justifyContent: "center", alignItems: "center", marginTop: 100 },
    emptyText: { marginTop: 16, fontSize: 16, fontWeight: "600", textAlign: "center", paddingHorizontal: 32 },
});

import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator, Alert, Image, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";
import { supabase } from "../../lib/supabase";
import { formatDateInput, validateDob, validateFullName } from "../../lib/validation";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../lib/theme";
import { usePreferences } from "../../lib/preferences";

export default function Profile() {
    const { t, i18n } = useTranslation();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { themeMode, setThemeMode, colors } = useTheme();
    const { plateType, setPlateType } = usePreferences();
    
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(false);
    const [error, setError] = useState("");
    const [fullName, setFullName] = useState("");
    const [dob, setDob] = useState("");
    const [email, setEmail] = useState("");
    const [bodyweight, setBodyweight] = useState("");
    const [gender, setGender] = useState<"male" | "female" | "other">("other");
    const [avatar, setAvatar] = useState<string | null>(null);
    const [exercises, setExercises] = useState<{id: string, name: string}[]>([]);
    const [featuredIds, setFeaturedIds] = useState<string[]>([]);

    useEffect(() => { loadProfile(); }, []);

    async function loadProfile() {
        setLoading(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;
            setEmail(user.email ?? "");
            
            const [profileRes, exercisesRes] = await Promise.all([
                supabase.from("profiles").select("*").eq("id", user.id).single(),
                supabase.from("exercises").select("id, name").eq("user_id", user.id)
            ]);

            if (profileRes.error && profileRes.error.code !== "PGRST116") {
                console.error("Profile load error:", profileRes.error);
                setError(profileRes.error.message);
            }

            if (profileRes.data) {
                setFullName(profileRes.data.full_name ?? "");
                setDob(profileRes.data.date_of_birth ?? "");
                setBodyweight(profileRes.data.bodyweight?.toString() ?? "");
                setGender(profileRes.data.gender ?? "other");
                setAvatar(profileRes.data.avatar_url ?? null);
                setFeaturedIds(profileRes.data.featured_exercise_ids || []);
                
                if (profileRes.data.language && profileRes.data.language !== i18n.language) {
                    i18n.changeLanguage(profileRes.data.language);
                }
            }

            if (exercisesRes.data) {
                setExercises(exercisesRes.data.sort((a, b) => a.name.localeCompare(b.name)));
            }
        } catch (e: any) {
            console.error("Load Profile failed:", e);
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }

    async function updateLanguage(lang: string) {
        if (i18n.language === lang) return;
        i18n.changeLanguage(lang);
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
            await supabase.from("profiles").update({ language: lang }).eq("id", user.id);
        }
    }

    async function pickImage(source: "camera" | "gallery") {
        let result;
        if (source === "camera") {
            const permission = await ImagePicker.requestCameraPermissionsAsync();
            if (!permission.granted) return;
            result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.5 });
        } else {
            result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.5 });
        }
        if (!result.canceled) {
            setAvatar(result.assets[0].uri);
        }
    }

    function showImagePicker() {
        if (Platform.OS === "web") { pickImage("gallery"); return; }
        Alert.alert(t("app.profile.changePhoto"), t("app.profile.chooseSource"), [
            { text: t("app.profile.camera"), onPress: () => pickImage("camera") },
            { text: t("app.profile.gallery"), onPress: () => pickImage("gallery") },
            { text: t("common.cancel"), style: "cancel" },
        ]);
    }

    async function uploadAvatar(userId: string, uri: string) {
        const filePath = `${userId}/avatar.jpg`;
        let uploadData: Blob | FormData;

        try {
            if (Platform.OS === "web") {
                const response = await fetch(uri);
                uploadData = await response.blob();
            } else {
                const formData = new FormData();
                formData.append("file", { uri, name: "avatar.jpg", type: "image/jpeg" } as any);
                uploadData = formData;
            }

            const { error: uploadError } = await supabase.storage.from("avatars").upload(filePath, uploadData, { upsert: true, contentType: "image/jpeg" });
            if (uploadError) throw uploadError;

            const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
            return `${urlData.publicUrl}?t=${Date.now()}`;
        } catch (e) {
            console.error("Upload failed", e);
            return uri;
        }
    }

    function toggleFeatured(id: string) {
        setFeaturedIds(current => 
            current.includes(id) ? current.filter(i => i !== id) : [...current, id]
        );
    }

    async function saveProfile() {
        setError("");
        const nameErr = validateFullName(fullName);
        if (nameErr) { setError(nameErr); return; }
        const dobErr = validateDob(dob);
        if (dobErr) { setError(dobErr); return; }

        setSaving(true);
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) return;

            let avatarUrl = avatar;
            if (avatar && (avatar.startsWith("file") || avatar.startsWith("data:") || avatar.startsWith("content:"))) {
                avatarUrl = await uploadAvatar(user.id, avatar);
            }

            const { error: updateError } = await supabase.from("profiles").update({ 
                full_name: fullName, 
                date_of_birth: dob, 
                bodyweight: parseFloat(bodyweight) || null,
                gender: gender,
                avatar_url: avatarUrl,
                featured_exercise_ids: featuredIds
            }).eq("id", user.id);

            if (updateError) {
                console.error("Profile update error:", updateError);
                setError(updateError.message);
            } else { 
                setAvatar(avatarUrl); 
                setEditing(false); 
                loadProfile();
            }
        } catch (e: any) {
            console.error("Save Profile failed:", e);
            setError(e.message);
        } finally {
            setSaving(false);
        }
    }

    async function handleSignOut() {
        await supabase.auth.signOut();
        router.replace("/auth/welcome");
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
            <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
                <ActivityIndicator size="large" color={colors.text} />
            </View>
        );
    }

    return (
        <ScrollView style={[styles.container, { backgroundColor: colors.background }]} showsVerticalScrollIndicator={false}>
            <View style={[styles.header, { paddingTop: insets.top + 20, backgroundColor: colors.secondaryBackground }]}>
                <View style={styles.headerRow}>
                    <Pressable onPress={handleBack}>
                        <Ionicons name="arrow-back" size={24} color={colors.text} />
                    </Pressable>
                    <Text style={[styles.headerTitle, { color: colors.text }]}>{t("app.profile.title")}</Text>
                    <View style={{ width: 24 }} />
                </View>

                <View style={styles.avatarWrapper}>
                    <Pressable style={[styles.avatarContainer, { backgroundColor: colors.secondary }]} onPress={showImagePicker} disabled={!editing}>
                        {avatar
                            ? <Image source={{ uri: avatar }} style={styles.avatarImage} />
                            : <View style={[styles.avatarPlaceholder, { backgroundColor: colors.secondary }]}>
                                <Text style={[styles.avatarInitial, { color: colors.secondaryText }]}>{fullName?.[0]?.toUpperCase() ?? "?"}</Text>
                              </View>
                        }
                        {editing && (
                            <View style={[styles.editBadge, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                                <Ionicons name="camera" size={16} color={colors.background} />
                            </View>
                        )}
                    </Pressable>
                </View>
                <Text style={[styles.userName, { color: colors.text }]}>{fullName || "User"}</Text>
                <Text style={[styles.userEmail, { color: colors.secondaryText }]}>{email}</Text>
            </View>

            <View style={styles.body}>
                <View style={styles.sectionHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{t("app.profile.personalInfo")}</Text>
                    {!editing ? (
                        <Pressable onPress={() => setEditing(true)}>
                            <Text style={[styles.editActionText, { color: colors.tint }]}>{t("common.settings")}</Text>
                        </Pressable>
                    ) : (
                        <Pressable onPress={() => { setEditing(false); loadProfile(); }}>
                            <Text style={[styles.cancelActionText, { color: colors.secondaryText }]}>{t("common.cancel")}</Text>
                        </Pressable>
                    )}
                </View>

                <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: colors.accentText }]}>{t("app.profile.name")}</Text>
                        <TextInput
                            style={[styles.input, { color: colors.text }, !editing && { color: colors.secondaryText }]}
                            value={fullName}
                            onChangeText={setFullName}
                            editable={editing}
                        />
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: colors.accentText }]}>{t("app.profile.dob")}</Text>
                        <TextInput
                            style={[styles.input, { color: colors.text }, !editing && { color: colors.secondaryText }]}
                            value={dob}
                            onChangeText={(t) => setDob(formatDateInput(t, dob))}
                            editable={editing}
                            placeholder="DD/MM/YYYY"
                            placeholderTextColor={colors.accentText}
                            keyboardType="number-pad"
                            maxLength={10}
                        />
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: colors.accentText }]}>Bodyweight (kg)</Text>
                        <TextInput
                            style={[styles.input, { color: colors.text }, !editing && { color: colors.secondaryText }]}
                            value={bodyweight}
                            onChangeText={setBodyweight}
                            editable={editing}
                            placeholder="70.0"
                            placeholderTextColor={colors.accentText}
                            keyboardType="decimal-pad"
                        />
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: colors.accentText }]}>Gender</Text>
                        {editing ? (
                            <View style={styles.genderRow}>
                                {["male", "female", "other"].map((g) => (
                                    <Pressable 
                                        key={g} 
                                        onPress={() => setGender(g as any)}
                                        style={[styles.genderBtn, gender === g && { backgroundColor: colors.tint }]}
                                    >
                                        <Text style={[styles.genderText, gender === g && { color: "#FFF" }]}>{g.toUpperCase()}</Text>
                                    </Pressable>
                                ))}
                            </View>
                        ) : (
                            <Text style={[styles.input, { color: colors.secondaryText }]}>{gender.toUpperCase()}</Text>
                        )}
                    </View>
                    <View style={[styles.divider, { backgroundColor: colors.border }]} />
                    <View style={styles.field}>
                        <Text style={[styles.label, { color: colors.accentText }]}>{t("app.profile.email")}</Text>
                        <Text style={[styles.input, { color: colors.secondaryText, paddingVertical: 14 }]}>{email}</Text>
                    </View>
                </View>

                {editing && (
                    <>
                        <Text style={[styles.sectionTitle, { color: colors.accentText, marginTop: 12 }]}>Featured Lifts (Dashboard)</Text>
                        <View style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border, marginTop: 16 }]}>
                            <ScrollView style={{ maxHeight: 200 }}>
                                {exercises.map((ex) => {
                                    const isSBD = ["squat", "bench", "deadlift"].some(n => ex.name.toLowerCase().includes(n));
                                    const isFeatured = featuredIds.includes(ex.id);
                                    
                                    return (
                                        <Pressable 
                                            key={ex.id} 
                                            style={[styles.exercisePickRow, { borderBottomColor: colors.border }]}
                                            onPress={() => !isSBD && toggleFeatured(ex.id)}
                                        >
                                            <Text style={[styles.exercisePickName, { color: colors.text }, isSBD && { opacity: 0.5 }]}>
                                                {ex.name} {isSBD && "(Always Featured)"}
                                            </Text>
                                            <Ionicons 
                                                name={isSBD || isFeatured ? "checkbox" : "square-outline"} 
                                                size={20} 
                                                color={isSBD ? colors.secondaryText : (isFeatured ? colors.tint : colors.border)} 
                                            />
                                        </Pressable>
                                    );
                                })}
                            </ScrollView>
                        </View>
                    </>
                )}

                {error ? <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text> : null}

                {editing && (
                    <Pressable style={[styles.saveBtn, { backgroundColor: colors.primary }]} onPress={saveProfile} disabled={saving}>
                        {saving ? <ActivityIndicator color={colors.background} /> : <Text style={[styles.saveBtnText, { color: colors.background }]}>{t("common.save")}</Text>}
                    </Pressable>
                )}

                <Text style={[styles.sectionTitle, { color: colors.accentText, marginTop: 12 }]}>{t("app.profile.theme")}</Text>
                <View style={styles.choiceContainer}>
                    <Pressable 
                        style={[styles.choiceBtn, { borderColor: colors.border }, themeMode === "auto" && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
                        onPress={() => setThemeMode("auto")}
                    >
                        <Text style={[styles.choiceBtnText, { color: colors.secondaryText }, themeMode === "auto" && { color: colors.background }]}>{t("app.profile.theme_auto")}</Text>
                    </Pressable>
                    <Pressable 
                        style={[styles.choiceBtn, { borderColor: colors.border }, themeMode === "light" && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
                        onPress={() => setThemeMode("light")}
                    >
                        <Text style={[styles.choiceBtnText, { color: colors.secondaryText }, themeMode === "light" && { color: colors.background }]}>{t("app.profile.theme_light")}</Text>
                    </Pressable>
                    <Pressable 
                        style={[styles.choiceBtn, { borderColor: colors.border }, themeMode === "dark" && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
                        onPress={() => setThemeMode("dark")}
                    >
                        <Text style={[styles.choiceBtnText, { color: colors.secondaryText }, themeMode === "dark" && { color: colors.background }]}>{t("app.profile.theme_dark")}</Text>
                    </Pressable>
                </View>

                <Text style={[styles.sectionTitle, { color: colors.accentText, marginTop: 12 }]}>Plate Preference</Text>
                <View style={styles.choiceContainer}>
                    <Pressable 
                        style={[styles.choiceBtn, { borderColor: colors.border }, plateType === 20 && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
                        onPress={() => setPlateType(20)}
                    >
                        <Text style={[styles.choiceBtnText, { color: colors.secondaryText }, plateType === 20 && { color: colors.background }]}>BLUE (20kg)</Text>
                    </Pressable>
                    <Pressable 
                        style={[styles.choiceBtn, { borderColor: colors.border }, plateType === 25 && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
                        onPress={() => setPlateType(25)}
                    >
                        <Text style={[styles.choiceBtnText, { color: colors.secondaryText }, plateType === 25 && { color: colors.background }]}>RED (25kg)</Text>
                    </Pressable>
                </View>

                <Text style={[styles.sectionTitle, { color: colors.accentText, marginTop: 12 }]}>{t("app.profile.language")}</Text>
                <View style={styles.choiceContainer}>
                    <Pressable 
                        style={[styles.choiceBtn, { borderColor: colors.border }, i18n.language.startsWith("en") && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
                        onPress={() => updateLanguage("en")}
                    >
                        <Text style={[styles.choiceBtnText, { color: colors.secondaryText }, i18n.language.startsWith("en") && { color: colors.background }]}>English</Text>
                    </Pressable>
                    <Pressable 
                        style={[styles.choiceBtn, { borderColor: colors.border }, i18n.language.startsWith("pt") && { backgroundColor: colors.primary, borderColor: colors.primary }]} 
                        onPress={() => updateLanguage("pt")}
                    >
                        <Text style={[styles.choiceBtnText, { color: colors.secondaryText }, i18n.language.startsWith("pt") && { color: colors.background }]}>Português</Text>
                    </Pressable>
                </View>

                <Pressable style={styles.signOutBtn} onPress={handleSignOut}>
                    <Ionicons name="log-out-outline" size={20} color={colors.error} />
                    <Text style={[styles.signOutText, { color: colors.error }]}>{t("app.profile.logout")}</Text>
                </Pressable>
            </View>
            <View style={{ height: 40 }} />
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    loadingContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
    header: {
        alignItems: "center",
        paddingHorizontal: 24,
        paddingBottom: 32,
    },
    headerRow: {
        width: "100%",
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 24,
    },
    headerTitle: { fontSize: 16, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
    avatarWrapper: { marginBottom: 16 },
    avatarContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        justifyContent: "center",
        alignItems: "center",
        position: "relative",
    },
    avatarImage: { width: 100, height: 100, borderRadius: 50 },
    avatarPlaceholder: { width: 100, height: 100, borderRadius: 50, justifyContent: "center", alignItems: "center" },
    avatarInitial: { fontSize: 40, fontWeight: "bold" },
    editBadge: {
        position: "absolute",
        bottom: 0,
        right: 0,
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 2,
    },
    userName: { fontSize: 24, fontWeight: "800" },
    userEmail: { fontSize: 14, marginTop: 4 },

    body: { paddingHorizontal: 24, paddingTop: 32 },
    sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
    sectionTitle: { fontSize: 13, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1 },
    editActionText: { fontSize: 14, fontWeight: "600" },
    cancelActionText: { fontSize: 14, fontWeight: "600" },

    card: { borderWidth: 1, borderRadius: 12, overflow: "hidden", marginBottom: 16 },
    field: { paddingHorizontal: 16, paddingVertical: 12 },
    label: { fontSize: 11, fontWeight: "700", textTransform: "uppercase", marginBottom: 4 },
    input: { fontSize: 16, padding: 0 },
    divider: { height: 1 },
    genderRow: {
        flexDirection: "row",
        gap: 8,
        marginTop: 8,
    },
    genderBtn: {
        flex: 1,
        height: 32,
        borderRadius: 16,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "rgba(128,128,128,0.1)",
    },
    genderText: {
        fontSize: 10,
        fontWeight: "800",
        color: "#888",
    },

    exercisePickRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    exercisePickName: { fontSize: 14, fontWeight: "600" },

    errorText: { textAlign: "center", marginBottom: 16 },
    saveBtn: { paddingVertical: 16, borderRadius: 8, alignItems: "center", marginBottom: 32 },
    saveBtnText: { fontWeight: "700", fontSize: 16 },

    choiceContainer: { flexDirection: "row", gap: 10, marginTop: 16, marginBottom: 32 },
    choiceBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderRadius: 8, borderWidth: 1 },
    choiceBtnText: { fontSize: 14, fontWeight: "600" },

    signOutBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
    signOutText: { fontSize: 16, fontWeight: "600" },
});

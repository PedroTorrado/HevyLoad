import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
    ActivityIndicator,
    Image,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { formatDateInput, isValidEmail, validateDob, validateFullName, validatePassword } from "../../lib/validation";

export default function SignUp() {
    const router = useRouter();
    const { t } = useTranslation();
    const [fullName, setFullName] = useState("");
    const [dob, setDob] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [avatar, setAvatar] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function pickFromGallery() {
        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.5,
        });
        if (!result.canceled) setAvatar(result.assets[0].uri);
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
                formData.append("file", {
                    uri,
                    name: `avatar.jpg`,
                    type: `image/jpeg`,
                } as any);
                uploadData = formData;
            }

            const { error } = await supabase.storage
                .from("avatars")
                .upload(filePath, uploadData, { upsert: true, contentType: "image/jpeg" });

            if (error) throw error;

            const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(filePath);
            return `${urlData.publicUrl}?t=${Date.now()}`;
        } catch (e) {
            console.error("Avatar upload failed", e);
            return null;
        }
    }

    async function handleSignUp() {
        setError("");

        const nameErr = validateFullName(fullName);
        if (nameErr) { setError(nameErr); return; }

        const dobErr = validateDob(dob);
        if (dobErr) { setError(dobErr); return; }

        if (!isValidEmail(email)) { setError(t("auth.signin.invalidEmail")); return; }

        const pwErr = validatePassword(password);
        if (pwErr) { setError(pwErr); return; }

        setLoading(true);

        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    date_of_birth: dob,
                },
            },
        });

        if (error) {
            setError(error.message);
            setLoading(false);
            return;
        }

        if (data.user && avatar) {
            const avatarUrl = await uploadAvatar(data.user.id, avatar);
            if (avatarUrl) {
                await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("id", data.user.id);
            }
        }

        setLoading(false);
        router.replace("/app/dashboard");
    }

    return (
        <KeyboardAvoidingView
            style={styles.container}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
            <ScrollView
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.pageFrame}>
                    <View style={styles.header}>
                        <Text style={styles.headerTitle}>{t("auth.signup.title")}</Text>
                        <View style={styles.avatarWrapper}>
                            <Pressable style={styles.avatarContainer} onPress={pickFromGallery}>
                                {avatar
                                    ? <Image source={{ uri: avatar }} style={styles.avatarImage} />
                                    : <View style={styles.avatarPlaceholder} />
                                }
                            </Pressable>
                            <Pressable style={styles.editBtn} onPress={pickFromGallery}>
                                <Text style={styles.editBtnText}>✎</Text>
                            </Pressable>
                        </View>
                    </View>

                    <View style={styles.form}>
                        <Text style={styles.label}>{t("auth.signup.fullName")}</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="John Doe"
                            placeholderTextColor="#999"
                            value={fullName}
                            onChangeText={setFullName}
                        />

                        <Text style={styles.label}>{t("auth.signup.dob")}</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="DD/MM/YYYY"
                            placeholderTextColor="#999"
                            value={dob}
                            onChangeText={(t) => setDob(formatDateInput(t, dob))}
                            keyboardType="number-pad"
                            maxLength={10}
                        />

                        <Text style={styles.label}>{t("auth.signup.email")}</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="your@email.com"
                            placeholderTextColor="#999"
                            value={email}
                            onChangeText={setEmail}
                            autoCapitalize="none"
                            keyboardType="email-address"
                        />

                        <Text style={styles.label}>{t("auth.signup.password")}</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="••••••••"
                            placeholderTextColor="#999"
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                        />

                        {error ? <Text style={styles.error}>{error}</Text> : null}
                    </View>

                    <View style={styles.bottom}>
                        <Pressable style={styles.button} onPress={handleSignUp} disabled={loading}>
                            {loading
                                ? <ActivityIndicator color="#fff" />
                                : <Text style={styles.buttonText}>{t("auth.signup.action")}</Text>
                            }
                        </Pressable>
                        <View style={styles.footerRow}>
                            <Text style={styles.footerText}>{t("auth.signup.footer")} </Text>
                            <Pressable onPress={() => router.push("/auth/signin")}>
                                <Text style={styles.footerActionText}>{t("auth.signup.footerAction")}</Text>
                            </Pressable>
                        </View>
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#FFFFFF" },
    scrollContent: { flexGrow: 1, alignItems: "center" },
    pageFrame: { width: "100%", maxWidth: 600 },
    header: {
        backgroundColor: "#F0F0F0",
        paddingTop: 60,
        paddingBottom: 40,
        alignItems: "center",
    },
    headerTitle: {
        fontSize: 24,
        fontWeight: "700",
        color: "#000",
        marginBottom: 20,
    },
    avatarWrapper: {
        position: "relative",
    },
    avatarContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: "#E0E0E0",
        borderWidth: 3,
        borderColor: "#FFFFFF",
        overflow: "hidden",
        justifyContent: "center",
        alignItems: "center",
    },
    avatarImage: { width: 100, height: 100, borderRadius: 50 },
    avatarPlaceholder: {
        width: 100,
        height: 100,
        borderRadius: 50,
        backgroundColor: "#CCC",
    },
    editBtn: {
        position: "absolute",
        bottom: 0,
        right: 0,
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: "#000",
        justifyContent: "center",
        alignItems: "center",
        borderWidth: 2,
        borderColor: "#FFF",
    },
    editBtnText: { color: "#fff", fontSize: 16 },
    form: {
        paddingHorizontal: 24,
        paddingTop: 32,
    },
    label: {
        fontSize: 14,
        fontWeight: "600",
        color: "#333",
        marginBottom: 8,
        marginLeft: 4,
    },
    input: {
        borderWidth: 1,
        borderColor: "#DDD",
        borderRadius: 8,
        paddingVertical: 14,
        paddingHorizontal: 16,
        fontSize: 16,
        color: "#000",
        marginBottom: 20,
        backgroundColor: "#fff",
    },
    error: { color: "#FF3B30", textAlign: "center", marginBottom: 16 },
    bottom: {
        paddingHorizontal: 24,
        paddingBottom: 40,
        marginTop: 20,
    },
    button: {
        backgroundColor: "#000",
        borderRadius: 8,
        paddingVertical: 16,
        alignItems: "center",
        marginBottom: 20,
    },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    footerRow: { flexDirection: "row", justifyContent: "center" },
    footerText: { fontSize: 14, color: "#666" },
    footerActionText: { fontSize: 14, color: "#000", fontWeight: "700" },
});

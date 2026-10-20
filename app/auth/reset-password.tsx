import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { validatePassword } from "../../lib/validation";

export default function ResetPassword() {
    const router = useRouter();
    const { t } = useTranslation();
    const [password, setPassword] = useState("");
    const [confirmation, setConfirmation] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    async function handleUpdatePassword() {
        setError("");
        const passwordError = validatePassword(password);
        if (passwordError) {
            setError(passwordError);
            return;
        }
        if (password !== confirmation) {
            setError(t("auth.passwordMismatch"));
            return;
        }

        setLoading(true);
        const { error: updateError } = await supabase.auth.updateUser({ password });
        setLoading(false);

        if (updateError) {
            setError(updateError.message);
            return;
        }

        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
            setError(signOutError.message);
            return;
        }

        setSuccess(true);
    }

    return (
        <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
            <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
            <View style={styles.pageFrame}>
                <View style={styles.centered}>
                    <Text style={styles.title}>{t("auth.reset_password.title")}</Text>
                    <Text style={styles.subtitle}>
                        {success
                            ? t("auth.reset_password.success")
                            : t("auth.reset_password.subtitle")}
                    </Text>

                    {!success && (
                        <>
                            <TextInput
                                style={styles.input}
                                placeholder={t("auth.reset_password.new_password")}
                                placeholderTextColor="#999"
                                value={password}
                                onChangeText={setPassword}
                                secureTextEntry
                                autoCapitalize="none"
                            />
                            <TextInput
                                style={styles.input}
                                placeholder={t("auth.reset_password.confirm_password")}
                                placeholderTextColor="#999"
                                value={confirmation}
                                onChangeText={setConfirmation}
                                secureTextEntry
                                autoCapitalize="none"
                            />
                            {error ? <Text style={styles.error}>{error}</Text> : null}
                            <Pressable style={styles.button} onPress={handleUpdatePassword} disabled={loading}>
                                {loading
                                    ? <ActivityIndicator color="#fff" />
                                    : <Text style={styles.buttonText}>{t("auth.reset_password.action")}</Text>}
                            </Pressable>
                        </>
                    )}

                    <Pressable
                        onPress={() => router.replace("/auth/signin")}
                        style={styles.backButton}
                    >
                        <Text style={styles.backText}>{t("auth.forgot_password.back_to_signin")}</Text>
                    </Pressable>
                </View>
            </View>
            </ScrollView>
            </KeyboardAvoidingView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#FFFFFF" },
    scrollContent: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32 },
    pageFrame: { width: "100%", maxWidth: 520, flex: 1, alignSelf: "center" },
    centered: { flex: 1, justifyContent: "center" },
    title: { fontSize: 32, fontWeight: "700", color: "#000", marginBottom: 8, textAlign: "center" },
    subtitle: { fontSize: 16, color: "#666", marginBottom: 32, textAlign: "center" },
    input: {
        borderWidth: 1, borderColor: "#DDD", borderRadius: 8,
        paddingVertical: 14, paddingHorizontal: 20,
        fontSize: 16, color: "#000", marginBottom: 16, backgroundColor: "#fff",
    },
    button: {
        backgroundColor: "#000", borderRadius: 8,
        paddingVertical: 16, alignItems: "center", marginTop: 8,
    },
    buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
    error: { color: "#FF3B30", textAlign: "center", marginBottom: 16 },
    backButton: { marginTop: 24, alignItems: "center" },
    backText: { fontSize: 14, color: "#000", fontWeight: "600" },
});

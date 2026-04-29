import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { isValidEmail } from "../../lib/validation";

export default function ForgotPassword() {
    const router = useRouter();
    const { t } = useTranslation();
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    async function handleReset() {
        setError("");
        if (!isValidEmail(email)) {
            setError(t("auth.signin.invalidEmail"));
            return;
        }
        setLoading(true);

        const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: "hevyload://reset-password",
        });

        setLoading(false);
        if (error) setError(error.message);
        else setSuccess(true);
    }

    return (
        <View style={styles.container}>
            <View style={styles.pageFrame}>
                <View style={styles.centered}>
                    <Text style={styles.title}>{t("auth.forgot_password.title", "Reset Password")}</Text>
                    <Text style={styles.subtitle}>
                        {success 
                            ? t("auth.forgot_password.success", "Check your email for a reset link!")
                            : t("auth.forgot_password.subtitle", "Enter your email and we'll send you a reset link.")}
                    </Text>

                    {!success && (
                        <>
                            <TextInput
                                style={styles.input}
                                placeholder={t("auth.signin.email")}
                                placeholderTextColor="#999"
                                value={email}
                                onChangeText={setEmail}
                                autoCapitalize="none"
                                keyboardType="email-address"
                            />
                            {error ? <Text style={styles.error}>{error}</Text> : null}
                            <Pressable style={styles.button} onPress={handleReset} disabled={loading}>
                                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{t("auth.forgot_password.action", "Send Reset Link")}</Text>}
                            </Pressable>
                        </>
                    )}

                    <Pressable 
                        onPress={() => {
                            if (router.canGoBack()) {
                                router.back();
                            } else {
                                router.replace("/auth/signin");
                            }
                        }} 
                        style={{ marginTop: 24, alignItems: "center" }}
                    >
                        <Text style={styles.backText}>{t("auth.forgot_password.back_to_signin", "← Back to Sign In")}</Text>
                    </Pressable>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: "#FFFFFF", paddingHorizontal: 32 },
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
    backText: { fontSize: 14, color: "#000", fontWeight: "600" },
});

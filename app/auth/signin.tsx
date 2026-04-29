import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import { isValidEmail } from "../../lib/validation";

export default function SignIn() {
    const router = useRouter();
    const { t } = useTranslation();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    async function handleSignIn() {
        setError("");
        if (!isValidEmail(email)) { 
          setError(t("auth.signin.invalidEmail")); 
          return; 
        }
        setLoading(true);

        const { error } = await supabase.auth.signInWithPassword({ email, password });

        setLoading(false);
        if (error) setError(error.message);
        else router.replace("/app/dashboard");
    }

    return (
        <View style={styles.container}>
            <View style={styles.pageFrame}>
                <View style={styles.centered}>
                    <Text style={styles.title}>{t("auth.signin.title")}</Text>
                    <Text style={styles.subtitle}>{t("auth.signin.subtitle")}</Text>

                    <TextInput
                        style={styles.input}
                        placeholder={t("auth.signin.email")}
                        placeholderTextColor="#999"
                        value={email}
                        onChangeText={setEmail}
                        autoCapitalize="none"
                        keyboardType="email-address"
                    />
                    <TextInput
                        style={styles.input}
                        placeholder={t("auth.signin.password")}
                        placeholderTextColor="#999"
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                    />

                    {error ? <Text style={styles.error}>{error}</Text> : null}

                    <Pressable style={styles.button} onPress={handleSignIn} disabled={loading}>
                        {loading
                            ? <ActivityIndicator color="#fff" />
                            : <Text style={styles.buttonText}>{t("auth.signin.action")}</Text>
                        }
                    </Pressable>

                    <Pressable onPress={() => router.push("/auth/forgot-password")} style={{ marginTop: 20, alignItems: "center" }}>
                        <Text style={styles.forgotText}>{t("auth.signin.forgot")}</Text>
                    </Pressable>
                </View>

                <View style={styles.footerRow}>
                    <Text style={styles.footerText}>{t("auth.signin.footer")} </Text>
                    <Pressable onPress={() => router.push("/auth/signup")}>
                        <Text style={styles.footerActionText}>{t("auth.signin.footerAction")}</Text>
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
    forgotText: { fontSize: 14, color: "#666", fontWeight: "500" },
    footerRow: { flexDirection: "row", justifyContent: "center", marginBottom: 40 },
    footerText: { fontSize: 14, color: "#666" },
    footerActionText: { fontSize: 14, color: "#000", fontWeight: "700" },
});

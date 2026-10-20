import { Session } from "@supabase/supabase-js";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import "./../lib/i18n"; 
import { supabase } from "../lib/supabase";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "../lib/theme";
import { PreferencesProvider } from "../lib/preferences";

function RootLayoutNav() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [isRecoverySession, setIsRecoverySession] = useState(false);
    const router = useRouter();
    const segments = useSegments();
    const { isDark } = useTheme();

    useEffect(() => {
        const hasRecoveryHash = typeof window !== "undefined"
            && new URLSearchParams(window.location.hash.slice(1)).get("type") === "recovery";
        if (hasRecoveryHash) setIsRecoverySession(true);

        // Initial session check
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
        });

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
            setSession(session);
            if (event === "PASSWORD_RECOVERY") setIsRecoverySession(true);
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (loading) return;

        const inAuthScreen = segments[0] === "auth";
        const inAppScreen = segments[0] === "app";
        const firstSegment = String(segments[0] ?? "");
        const isResetPasswordScreen = inAuthScreen && String(segments[1] ?? "") === "reset-password";

        if (session && isRecoverySession && !isResetPasswordScreen) {
            router.replace("/auth/reset-password" as any);
        } else if (session && inAuthScreen && !isResetPasswordScreen) {
            router.replace("/app/dashboard");
        } else if (session && (firstSegment === "" || firstSegment === "index")) {
            router.replace("/app/dashboard");
        } else if (!session && (inAppScreen || (firstSegment !== "" && firstSegment !== "auth"))) {
            router.replace("/auth/welcome");
        } else if (!session && firstSegment === "") {
            router.replace("/auth/welcome");
        }
    }, [router, session, loading, segments, isRecoverySession]);

    return (
        <>
            <StatusBar style={isDark ? "light" : "dark"} />
            <Stack screenOptions={{ headerShown: false }} />
        </>
    );
}

export default function RootLayout() {
    return (
        <ThemeProvider>
            <PreferencesProvider>
                <RootLayoutNav />
            </PreferencesProvider>
        </ThemeProvider>
    );
}

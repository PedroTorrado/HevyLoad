import { Session } from "@supabase/supabase-js";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect, useState } from "react";
import "./../lib/i18n"; 
import { supabase } from "../lib/supabase";
import { StatusBar } from "expo-status-bar";
import { ThemeProvider, useTheme } from "../lib/theme";

function RootLayoutNav() {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const segments = useSegments();
    const { isDark } = useTheme();

    useEffect(() => {
        // Initial session check
        supabase.auth.getSession().then(({ data: { session } }) => {
            setSession(session);
            setLoading(false);
        });

        // Listen for auth state changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => subscription.unsubscribe();
    }, []);

    useEffect(() => {
        if (loading) return;

        const inAuthScreen = segments[0] === "auth";
        const inAppScreen = segments[0] === "app";

        if (session && (inAuthScreen || segments.length === 0 || segments[0] === "index")) {
            router.replace("/app/dashboard");
        } else if (!session && (inAppScreen || (segments.length > 0 && segments[0] !== "auth"))) {
            router.replace("/auth/welcome");
        } else if (!session && segments.length === 0) {
            router.replace("/auth/welcome");
        }
    }, [session, loading, segments]);

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
            <RootLayoutNav />
        </ThemeProvider>
    );
}

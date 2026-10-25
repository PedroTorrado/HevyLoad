/**
 * Program Guide — "How custom programs work".
 *
 * ⚠️  DESCRIPTIVE, NOT PRESCRIPTIVE.
 * This screen is user-facing documentation of what is *currently implemented* in:
 *   - lib/custom-programs.ts   (template selection, weekly progression, deload, variation, duration trimming)
 *   - lib/program-progress.ts  (phase tracking, adherence matching, recovery model, adaptation rules)
 *
 * It is NOT a spec. The code is the source of truth. If you change the logic or tune numbers
 * (thresholds, half-life, percentages), update this page to match — do not change the logic to
 * satisfy this page. Numbers shown here are read from the exported constants where practical,
 * and otherwise mirror the values in those files at the time of writing.
 */
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColor } from "../../lib/theme";
import { PROGRESS_TUNABLES } from "../../lib/program-progress";

type Section = { icon: keyof typeof Ionicons.glyphMap; title: string; body: string[] };

const T = PROGRESS_TUNABLES;

const SECTIONS: Section[] = [
    {
        icon: "construct-outline",
        title: "1. Building your program",
        body: [
            "Your goal and number of sessions per week (2–5) pick a starting template. For example, 3-day strength uses a full-body plan and 4-day hypertrophy uses an upper/lower split.",
            "If a template has fewer sessions than you asked for, its first sessions are repeated so you get exactly the number of days you chose.",
            "Your training style sets the starting effort: heavy starts at RPE 7, moderate and mixed at 7.5, high-rep at 8.",
            "Session length: if a session would run longer than the time you chose, optional accessories are removed, starting from the end.",
        ],
    },
    {
        icon: "trending-up-outline",
        title: "2. Weekly progression & deload",
        body: [
            "A block lasts 4, 6 or 8 weeks. In each build week the target RPE goes up by 0.5 (up to RPE 9), so you need fewer reps in reserve.",
            "If deload is on, the last week of the block is lighter: about 60% of the sets, about 60% load, RPE 6, and no optional accessories.",
            "With \"Rotate variations\", even-numbered weeks swap each lift for a close variant (e.g. bench → incline). The muscle group stays the same, so your history still counts.",
        ],
    },
    {
        icon: "locate-outline",
        title: "3. Knowing where you are",
        body: [
            "Your place in the program comes from the workouts you actually log, not just the calendar.",
            "Each logged workout is matched to the session that was due next. Rolling mode: every matched workout moves you to the next session, and a week ends once you've done that week's sessions.",
            "Calendar mode: the week comes from the date you started the program, and any planned sessions you skipped are shown as missed.",
            `A workout only counts as the planned session if it trains at least ${Math.round(T.COUNTED_COVERAGE_MIN * 100)}% of the planned muscle groups. Workouts that don't qualify still count toward your fatigue.`,
        ],
    },
    {
        icon: "checkmark-done-outline",
        title: "4. Checking each workout against the plan",
        body: [
            "Muscle coverage: the share of the planned muscle groups you trained.",
            "Volume: the working sets you did compared to the sets planned.",
            "Effort: the RPE you logged compared to the target, averaged across the main lifts.",
            "Missing RPE: if a set has no RPE logged, effort is estimated from the weight and reps compared to your best estimated 1-rep max.",
            "Muscles you trained that weren't in the plan are also recorded, so the app can adjust for the extra fatigue.",
        ],
    },
    {
        icon: "bed-outline",
        title: "5. Rest & recovery",
        body: [
            "Every working set adds fatigue to the muscle it trains. Harder sets add more: an RPE 10 set counts about 5× as much as an RPE 6 set.",
            `Fatigue fades over time with a half-life of ${T.FATIGUE_HALF_LIFE_HOURS} hours. A hard session 12 hours ago still matters a lot; the same session 4 days ago barely matters.`,
            "Readiness for each muscle runs from 0 (still very fatigued) to 1 (fully recovered). Your next session is adjusted based on this, not just on how hard your last workout was.",
            `After more than ${T.LONG_GAP_DAYS} days without training, the next session starts about 10% lighter so you can build back up.`,
        ],
    },
    {
        icon: "options-outline",
        title: "6. How your next session adapts",
        body: [
            "Low readiness (below 45%): about 5% less load and one set fewer for that muscle. Partial readiness (below 70%): target RPE −0.5.",
            "Last time harder than planned (RPE +1 or more): 2.5% less load. But if you've had more than 3 days of rest since, the load stays the same instead.",
            "Last time easier than planned (RPE −1 or less) and you're recovered: 2.5% more load.",
            "Well rested (more than 3 days) and not over target last time: target RPE +0.5, so you can push a bit harder.",
            "Muscle skipped last session: one set added to it next session, if it's recovered enough.",
            "Unplanned work on a muscle that's still fatigued: one set fewer for it next session.",
            "If two rules adjust the same thing, the more cautious one wins.",
        ],
    },
    {
        icon: "warning-outline",
        title: "7. Program-level signals",
        body: [
            "Effort climbing for 3 sessions in a row, ending at least 1 RPE over target: you'll be prompted to take the deload early.",
            "Under 70% of the planned volume for 3 sessions in a row: you'll be prompted to train fewer days or do shorter sessions.",
            "These appear as notes on the Suggestions screen and never change your program on their own.",
        ],
    },
];

export default function ProgramGuideScreen() {
    const router = useRouter();
    const colors = useThemeColor();
    const insets = useSafeAreaInsets();

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
                <View style={styles.header}>
                    <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Go back">
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </Pressable>
                    <View style={styles.headerCopy}>
                        <Text style={[styles.eyebrow, { color: colors.tint }]}>PROGRAM GUIDE</Text>
                        <Text style={[styles.title, { color: colors.text }]}>How custom programs work</Text>
                        <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                            How your plan is built, how it tracks your progress, and why it changes your next session.
                        </Text>
                    </View>
                </View>

                {SECTIONS.map((section) => (
                    <View key={section.title} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <View style={styles.cardHeader}>
                            <View style={[styles.iconWrap, { backgroundColor: colors.tint + "18" }]}>
                                <Ionicons name={section.icon} size={18} color={colors.tint} />
                            </View>
                            <Text style={[styles.cardTitle, { color: colors.text }]}>{section.title}</Text>
                        </View>
                        {section.body.map((line) => (
                            <View key={line} style={styles.bulletRow}>
                                <Text style={[styles.bullet, { color: colors.tint }]}>•</Text>
                                <Text style={[styles.bulletText, { color: colors.secondaryText }]}>{line}</Text>
                            </View>
                        ))}
                    </View>
                ))}

                <Text style={[styles.footer, { color: colors.secondaryText }]}>
                    These are guidelines, not medical advice. If something feels wrong, rest or adjust.
                </Text>
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    content: { paddingHorizontal: 20 },
    header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 18 },
    backButton: { padding: 4, marginRight: 8, marginTop: 2 },
    headerCopy: { flex: 1 },
    eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
    title: { fontSize: 26, fontWeight: "900", marginTop: 4 },
    subtitle: { fontSize: 13, marginTop: 6, lineHeight: 19 },
    card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
    cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
    iconWrap: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center", marginRight: 10 },
    cardTitle: { fontSize: 15, fontWeight: "800", flex: 1 },
    bulletRow: { flexDirection: "row", marginTop: 6 },
    bullet: { width: 14, fontSize: 13, lineHeight: 19, fontWeight: "900" },
    bulletText: { flex: 1, fontSize: 13, lineHeight: 19 },
    footer: { fontSize: 11, textAlign: "center", marginTop: 8, lineHeight: 16 },
});

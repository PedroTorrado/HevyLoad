import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColor } from "../../lib/theme";
import {
    BlockLength,
    CustomGoal,
    CustomScheduleMode,
    CustomStyle,
    generateCustomProgram,
    saveCustomProgram,
} from "../../lib/custom-programs";

const goals: { value: CustomGoal; label: string }[] = [
    { value: "strength", label: "Strength" },
    { value: "hypertrophy", label: "Muscle growth" },
    { value: "fitness", label: "General fitness" },
    { value: "conditioning", label: "Conditioning" },
];
const styles: { value: CustomStyle; label: string }[] = [
    { value: "mixed", label: "Mixed" },
    { value: "heavy", label: "Heavy" },
    { value: "moderate", label: "Moderate" },
    { value: "high-rep", label: "Higher reps" },
];

export default function CustomProgramScreen() {
    const router = useRouter();
    const { t } = useTranslation();
    const colors = useThemeColor();
    const insets = useSafeAreaInsets();
    const [name, setName] = useState("");
    const [goal, setGoal] = useState<CustomGoal>("strength");
    const [sessionsPerWeek, setSessionsPerWeek] = useState(4);
    const [duration, setDuration] = useState(60);
    const [scheduleMode, setScheduleMode] = useState<CustomScheduleMode>("rolling");
    const [blockLengthWeeks, setBlockLengthWeeks] = useState<BlockLength>(4);
    const [style, setStyle] = useState<CustomStyle>("mixed");
    const [variety, setVariety] = useState<"repeat" | "variation">("repeat");
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const draft = useMemo(() => generateCustomProgram({
        name,
        goal,
        sessionsPerWeek,
        scheduleMode,
        blockLengthWeeks,
        priorities: [],
        equipment: ["full-gym"],
        avoidedExercises: [],
        style,
        variety,
    }), [name, goal, sessionsPerWeek, scheduleMode, blockLengthWeeks, style, variety]);

    async function handleSave() {
        setSaving(true);
        setError(null);
        try {
            await saveCustomProgram(draft, true);
            router.replace("/app/suggestions");
        } catch (saveError) {
            console.error("Custom program save error:", saveError);
            setError("We could not save this program. Apply the Supabase migration and try again.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <View style={[screenStyles.container, { backgroundColor: colors.background }]}>
            <ScrollView contentContainerStyle={[screenStyles.content, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 }]}>
                <View style={screenStyles.header}>
                    <Pressable onPress={() => router.back()} style={screenStyles.backButton} accessibilityLabel={t("app.suggestions.go_back")}>
                        <Ionicons name="chevron-back" size={24} color={colors.text} />
                    </Pressable>
                    <View>
                        <Text style={[screenStyles.eyebrow, { color: colors.tint }]}>CUSTOM PROGRAM</Text>
                        <Text style={[screenStyles.title, { color: colors.text }]}>Build your plan</Text>
                        <Text style={[screenStyles.subtitle, { color: colors.secondaryText }]}>
                            Answer a few questions and we&apos;ll generate an editable starting point.
                        </Text>
                    </View>
                </View>

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Program name</Text>
                <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder={draft.name}
                    placeholderTextColor={colors.secondaryText}
                    style={[screenStyles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                />

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Main goal</Text>
                <View style={screenStyles.chipRow}>
                    {goals.map((item) => (
                        <ChoiceChip key={item.value} label={item.label} selected={goal === item.value} onPress={() => setGoal(item.value)} colors={colors} />
                    ))}
                </View>

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Sessions per week</Text>
                <View style={screenStyles.chipRow}>
                    {[2, 3, 4, 5].map((value) => (
                        <ChoiceChip key={value} label={`${value} days`} selected={sessionsPerWeek === value} onPress={() => setSessionsPerWeek(value)} colors={colors} />
                    ))}
                </View>

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Typical session length</Text>
                <View style={screenStyles.chipRow}>
                    {[45, 60, 75].map((value) => (
                        <ChoiceChip key={value} label={`${value} min`} selected={duration === value} onPress={() => setDuration(value)} colors={colors} />
                    ))}
                </View>

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Schedule</Text>
                <View style={screenStyles.chipRow}>
                    <ChoiceChip label="Rolling order" selected={scheduleMode === "rolling"} onPress={() => setScheduleMode("rolling")} colors={colors} />
                    <ChoiceChip label="Calendar days" selected={scheduleMode === "calendar"} onPress={() => setScheduleMode("calendar")} colors={colors} />
                </View>

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Training style</Text>
                <View style={screenStyles.chipRow}>
                    {styles.map((item) => (
                        <ChoiceChip key={item.value} label={item.label} selected={style === item.value} onPress={() => setStyle(item.value)} colors={colors} />
                    ))}
                </View>

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Variation</Text>
                <View style={screenStyles.chipRow}>
                    <ChoiceChip label="Repeat the plan" selected={variety === "repeat"} onPress={() => setVariety("repeat")} colors={colors} />
                    <ChoiceChip label="Rotate variations" selected={variety === "variation"} onPress={() => setVariety("variation")} colors={colors} />
                </View>

                <Text style={[screenStyles.label, { color: colors.secondaryText }]}>Progression block</Text>
                <View style={screenStyles.chipRow}>
                    {([4, 6, 8] as BlockLength[]).map((value) => (
                        <ChoiceChip key={value} label={`${value} weeks`} selected={blockLengthWeeks === value} onPress={() => setBlockLengthWeeks(value)} colors={colors} />
                    ))}
                </View>

                <View style={[screenStyles.preview, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[screenStyles.previewTitle, { color: colors.text }]}>{draft.name}</Text>
                    <Text style={[screenStyles.previewSubtitle, { color: colors.secondaryText }]}>
                        {draft.definition.sessions.length} sessions · {duration} min target · hybrid progression
                    </Text>
                    {draft.definition.sessions.map((session) => (
                        <View key={session.key} style={screenStyles.previewRow}>
                            <Text style={[screenStyles.previewDay, { color: colors.tint }]}>{session.key}</Text>
                            <Text style={[screenStyles.previewSession, { color: colors.text }]}>{session.title}</Text>
                            <Text style={[screenStyles.previewFocus, { color: colors.secondaryText }]}>{session.focus}</Text>
                        </View>
                    ))}
                </View>

                {error && <Text style={[screenStyles.error, { color: colors.error }]}>{error}</Text>}
                <Pressable onPress={handleSave} disabled={saving} style={[screenStyles.saveButton, { backgroundColor: colors.tint, opacity: saving ? 0.7 : 1 }]}>
                    {saving ? <ActivityIndicator color="#FFF" /> : <Text style={screenStyles.saveText}>Save and activate program</Text>}
                </Pressable>
            </ScrollView>
        </View>
    );
}

function ChoiceChip({ label, selected, onPress, colors }: { label: string; selected: boolean; onPress: () => void; colors: ReturnType<typeof useThemeColor> }) {
    return (
        <Pressable onPress={onPress} style={[screenStyles.chip, { backgroundColor: selected ? colors.tint : colors.card, borderColor: selected ? colors.tint : colors.border }]}>
            <Text style={[screenStyles.chipText, { color: selected ? "#FFF" : colors.text }]}>{label}</Text>
        </Pressable>
    );
}

const screenStyles = StyleSheet.create({
    container: { flex: 1 },
    content: { width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 24 },
    header: { flexDirection: "row", alignItems: "flex-start", marginBottom: 26 },
    backButton: { padding: 8, marginLeft: -8, marginRight: 10 },
    eyebrow: { fontSize: 11, fontWeight: "900", letterSpacing: 1.4, marginBottom: 5 },
    title: { fontSize: 30, fontWeight: "900" },
    subtitle: { fontSize: 14, lineHeight: 20, marginTop: 6 },
    label: { fontSize: 11, fontWeight: "900", letterSpacing: 1, textTransform: "uppercase", marginBottom: 9, marginTop: 16 },
    input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { borderWidth: 1, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 9 },
    chipText: { fontSize: 12, fontWeight: "700" },
    preview: { borderWidth: 1, borderRadius: 14, padding: 16, marginTop: 26 },
    previewTitle: { fontSize: 19, fontWeight: "900" },
    previewSubtitle: { fontSize: 12, marginTop: 4, marginBottom: 12 },
    previewRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "rgba(128,128,128,0.12)" },
    previewDay: { width: 24, fontSize: 12, fontWeight: "900" },
    previewSession: { width: 105, fontSize: 13, fontWeight: "800" },
    previewFocus: { flex: 1, fontSize: 12 },
    error: { fontSize: 13, lineHeight: 19, marginTop: 14 },
    saveButton: { minHeight: 48, borderRadius: 12, alignItems: "center", justifyContent: "center", marginTop: 18 },
    saveText: { color: "#FFF", fontSize: 14, fontWeight: "900" },
});

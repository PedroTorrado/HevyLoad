import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { 
    ActivityIndicator, 
    Alert, 
    Pressable, 
    ScrollView, 
    StyleSheet, 
    Text, 
    TextInput, 
    View, 
    Platform 
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import { parse } from "date-fns";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

type StatusType = "success" | "error" | "info";
type Status = { type: StatusType; title: string; message: string; action?: { label: string; onPress: () => void } };

type PressState = { pressed: boolean; hovered?: boolean };
const pressFeedback = ({ pressed, hovered }: PressState) => ({
    opacity: pressed ? 0.75 : hovered ? 0.9 : 1,
    transform: [{ scale: pressed ? 0.98 : 1 }],
});

export default function Import() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();
    const translate = (key: string, opts?: Record<string, unknown>): string =>
        String(t(key, opts as any));
    const k = (key: string, opts?: Record<string, unknown>) =>
        translate(`app.dashboard.import.${key}`, opts);

    const [loading, setLoading] = useState(false);
    const [importText, setImportText] = useState("");
    const [progress, setProgress] = useState("");
    const [fileName, setFileName] = useState<string | null>(null);
    // Inline status replaces Alert.alert, which is a no-op on react-native-web
    const [status, setStatus] = useState<Status | null>(null);

    const lineCount = importText.trim() ? importText.trim().split(/\r?\n/).filter(l => l.trim()).length : 0;
    const rowCount = Math.max(0, lineCount - 1);

    async function pickFile() {
        try {
            const result = await DocumentPicker.getDocumentAsync({
                type: [
                    "text/comma-separated-values", 
                    "text/tab-separated-values", 
                    "text/plain", 
                    "text/csv",
                    "public.comma-separated-values-text",
                    "public.text",
                    "public.data"
                ],
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) return;

            const asset = result.assets[0];
            let fileUri = asset.uri;
            

            let content = "";
            
            // On Web, FileSystem is often undefined or limited. fetch is much more reliable for blobs.
            if (Platform.OS === "web" || fileUri.startsWith("blob:") || fileUri.startsWith("data:")) {
                const response = await fetch(fileUri);
                content = await response.text();
            } else {
                try {
                    content = await FileSystem.readAsStringAsync(fileUri);
                } catch (fsError) {
                    console.warn("FileSystem read failed, trying fetch fallback:", fsError);
                    const response = await fetch(fileUri);
                    content = await response.text();
                }
            }
            
            if (content) {
                setImportText(content);
                setFileName(asset.name);
                setStatus({ type: "info", title: k("file_loaded"), message: k("file_loaded_message", { name: asset.name }) });
            } else {
                setStatus({ type: "error", title: k("error"), message: k("empty_file") });
            }
        } catch (error: any) {
            console.error("File pick error:", error);
            setStatus({
                type: "error",
                title: k("error"),
                message: `${k("read_error")} ${error.message || ""}`.trim(),
            });
        }
    }

    function clearFile() {
        setImportText("");
        setFileName(null);
        setStatus(null);
    }

    // Robust CSV parser that handles quoted values (crucial for dates with commas)
    function parseCSVLine(line: string, separator: string): string[] {
        const result = [];
        let cur = "";
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            const nextChar = line[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // Escaped quote: ""
                    cur += '"';
                    i++; // Skip next quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === separator && !inQuotes) {
                result.push(cur.trim());
                cur = "";
            } else {
                cur += char;
            }
        }
        result.push(cur.trim());
        
        return result.map(v => v.trim());
    }

    async function handleImport() {
        if (!importText.trim()) {
            setStatus({ type: "error", title: k("error"), message: k("empty_data") });
            return;
        }

        setStatus(null);
        setLoading(true);
        setProgress("Parsing data...");

        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("User not found");

            // Split by lines and filter empty ones
            const lines = importText.trim().split(/\r?\n/).filter(line => line.trim());
            if (lines.length < 2) throw new Error("Invalid data format");

            // Detect separator (Tab or Comma)
            const header = lines[0];
            const separator = header.includes("\t") ? "\t" : ",";
            const rawColumns = parseCSVLine(header, separator).map(c => c.toLowerCase());
            
            
            // Map common variations of Hevy column names to our internal keys
            const columnMap: Record<string, string> = {};
            rawColumns.forEach((col, idx) => {
                const c = col.trim();
                if (c === "title" || (c.includes("title") && !c.includes("exercise"))) columnMap["title"] = idx.toString();
                if (c.includes("start") || c === "date") columnMap["start_time"] = idx.toString();
                if (c.includes("end")) columnMap["end_time"] = idx.toString();
                if (c.includes("description") || c === "workout notes") columnMap["description"] = idx.toString();
                if (c.includes("exercise") && (c.includes("title") || c.includes("name"))) columnMap["exercise_title"] = idx.toString();
                
                // Specific weight mapping
                if (c === "weight" || c === "weight_kg") columnMap["weight"] = idx.toString();
                else if (c.includes("weight") && (c.includes("unit") || c.includes("medida"))) columnMap["weight_unit"] = idx.toString();
                else if (c.includes("weight") && !columnMap["weight"]) columnMap["weight"] = idx.toString();

                if (c === "reps" || c === "repeticiones" || c === "repetições") columnMap["reps"] = idx.toString();
                else if (c.includes("reps") && !columnMap["reps"]) columnMap["reps"] = idx.toString();

                if (c.includes("distance") || c.includes("distancia")) columnMap["distance_km"] = idx.toString();
                if (c.includes("duration") || c.includes("seconds") || c.includes("duración") || c.includes("duração")) columnMap["duration_seconds"] = idx.toString();
                if (c.includes("rpe")) columnMap["rpe"] = idx.toString();
                if (c.includes("set index") || c === "index" || c === "set number" || c === "série") columnMap["set_index"] = idx.toString();
                if (c.includes("set type") || c.includes("tipo")) columnMap["set_type"] = idx.toString();
            });

            // Fallback for strict mapping if flexible failed
            const getVal = (rowValues: string[], key: string) => {
                const idx = columnMap[key];
                return idx !== undefined ? rowValues[parseInt(idx)] : undefined;
            };

            const workoutsMap: Record<string, any> = {};
            const exercisesSet = new Set<string>();


            // First pass: Group sets by workout and collect unique exercises
            for (let i = 1; i < lines.length; i++) {
                const values = parseCSVLine(lines[i], separator);
                if (values.length < 2) continue; // Skip empty rows

                const exTitle = getVal(values, "exercise_title");
                const startTimeStr = getVal(values, "start_time");
                const title = getVal(values, "title") || "Workout";

                if (!exTitle || !startTimeStr) continue;

                const startTime = parseDate(startTimeStr);
                if (isNaN(startTime.getTime())) continue;

                const workoutKey = `${title}_${startTime.getTime()}`;
                if (!workoutsMap[workoutKey]) {
                    const endTimeStr = getVal(values, "end_time");
                    workoutsMap[workoutKey] = {
                        title: title,
                        start_time: startTime,
                        end_time: endTimeStr ? parseDate(endTimeStr) : null,
                        description: getVal(values, "description") || "",
                        sets: []
                    };
                }

                const rawWeight = getVal(values, "weight");
                const weightUnit = getVal(values, "weight_unit")?.toLowerCase() || "kg";
                
                // Handle different decimal separators (, vs .)
                let cleanWeight = (rawWeight || "0").replace(",", ".");
                let weightKg = parseFloat(cleanWeight);
                
                // Convert lbs to kg if needed
                if (!isNaN(weightKg) && (weightUnit === "lbs" || weightUnit === "lb")) {
                    weightKg = weightKg * 0.453592;
                }

                workoutsMap[workoutKey].sets.push({
                    exercise_title: exTitle,
                    weight_kg: isNaN(weightKg) ? 0 : weightKg,
                    reps: parseInt((getVal(values, "reps") || "0").replace(",", ".")) || 0,
                    distance_km: getVal(values, "distance_km"),
                    duration_seconds: getVal(values, "duration_seconds"),
                    rpe: getVal(values, "rpe"),
                    set_index: getVal(values, "set_index"),
                    set_type: getVal(values, "set_type")
                });

                // Sanity check: Ensure the exercise name isn't just a misparsed date fragment
                // (e.g. "Aug 10" or "Sep 20")
                const isDateFragment = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d+/i.test(exTitle);
                if (!isDateFragment && exTitle.length > 2) {
                    exercisesSet.add(exTitle);
                }
            }

            const workoutEntries = Object.values(workoutsMap);

            if (workoutEntries.length === 0) {
                throw new Error("No valid workouts found. Check if your CSV headers match (Title, Start Time, Exercise Title).");
            }

            setProgress(`Syncing ${exercisesSet.size} exercises...`);
            
            // 1. Batch Upsert Exercises
            const exerciseEntries = Array.from(exercisesSet).map(name => ({
                user_id: user.id,
                name,
                muscle_group: detectMuscleGroup(name)
            }));

            const { data: exData, error: exError } = await supabase
                .from("exercises")
                .upsert(exerciseEntries, { onConflict: "user_id, name" })
                .select("id, name");
            
            if (exError) throw exError;

            const exerciseIdMap: Record<string, string> = {};
            exData?.forEach(ex => {
                exerciseIdMap[ex.name] = ex.id;
            });

            setProgress(`Checking for existing data...`);

            // 2. Check for existing workouts to avoid duplicates (Batched check)
            const allStartTimes = workoutEntries.map(w => w.start_time.toISOString());
            const existingStartTimesSet = new Set<string>();
            
            setProgress(`Checking for existing data in batches...`);
            for (let i = 0; i < allStartTimes.length; i += 100) {
                const batch = allStartTimes.slice(i, i + 100);
                const { data: existingBatch } = await supabase
                    .from("workouts")
                    .select("start_time")
                    .eq("user_id", user.id)
                    .in("start_time", batch);
                
                existingBatch?.forEach(w => existingStartTimesSet.add(new Date(w.start_time).toISOString()));
            }
            
            // Filter out workouts that are already in the database
            const newWorkouts = workoutEntries.filter(w => !existingStartTimesSet.has(w.start_time.toISOString()));

            if (newWorkouts.length === 0) {
                setLoading(false);
                setProgress("");
                setStatus({ type: "info", title: k("nothing_new"), message: k("already_imported") });
                return;
            }

            setProgress(`Importing ${newWorkouts.length} new workouts...`);

            // 3. Optimized Workout & Set Import
            for (let i = 0; i < newWorkouts.length; i += 10) {
                const chunk = newWorkouts.slice(i, i + 10);
                setProgress(`Importing workouts ${i + 1} to ${Math.min(i + 10, newWorkouts.length)} of ${newWorkouts.length}...`);

                await Promise.all(chunk.map(async (workout) => {
                    const { data: wData, error: wError } = await supabase
                        .from("workouts")
                        .insert({
                            user_id: user.id,
                            title: workout.title,
                            start_time: workout.start_time.toISOString(),
                            end_time: workout.end_time ? workout.end_time.toISOString() : null,
                            description: workout.description
                        })
                        .select("id")
                        .single();

                    if (wError) return;

                    const setsToInsert = workout.sets.map((s: any) => ({
                        workout_id: wData.id,
                        exercise_id: exerciseIdMap[s.exercise_title],
                        user_id: user.id,
                        weight_kg: s.weight_kg,
                        reps: s.reps,
                        distance_km: parseFloat(s.distance_km) || null,
                        duration_s: parseInt(s.duration_seconds) || null,
                        rpe: parseFloat(s.rpe) || null,
                        set_order: parseInt(s.set_index) || 0,
                        set_type: s.set_type || "normal"
                    }));

                    await supabase.from("sets").insert(setsToInsert);
                }));
            }

            setImportText("");
            setFileName(null);
            setStatus({
                type: "success",
                title: k("success"),
                message: k("import_success_count", { count: newWorkouts.length }),
                action: { label: k("view_dashboard"), onPress: () => router.replace("/app/dashboard") },
            });

        } catch (error: any) {
            console.error("Import error:", error);
            setStatus({ type: "error", title: k("import_failed"), message: error.message || k("import_failed") });
        } finally {
            setLoading(false);
            setProgress("");
        }
    }

    async function performDeletion() {
        setLoading(true);
        setProgress("Deleting data...");
        try {
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("User not found");

            // 1. Delete all workouts (cascades to sets)
            const { error: wError } = await supabase
                .from("workouts")
                .delete()
                .eq("user_id", user.id);
            
            if (wError) throw wError;

            // 2. Delete all exercises
            const { error: exError } = await supabase
                .from("exercises")
                .delete()
                .eq("user_id", user.id);

            if (exError) throw exError;

            setImportText("");
            setFileName(null);
            setStatus({ type: "success", title: k("success"), message: k("clear_success") });
        } catch (error: any) {
            setStatus({ type: "error", title: k("error"), message: error.message || k("clear_failed") });
        } finally {
            setLoading(false);
            setProgress("");
        }
    }

    async function clearAllData() {
        const title = k("danger_title");
        const message = k("danger_confirm");

        if (Platform.OS === "web") {
            const confirmed = window.confirm(`${title}\n\n${message}`);
            if (confirmed) {
                await performDeletion();
            }
            return;
        }

        Alert.alert(
            title,
            message,
            [
                { text: translate("common.cancel"), style: "cancel" },
                { 
                    text: k("delete_everything"), 
                    style: "destructive",
                    onPress: performDeletion
                }
            ]
        );
    }

    function parseDate(dateStr: string): Date {
        if (!dateStr) return new Date(NaN);
        
        // Formats to try:
        // 1. "Apr 28, 2026, 3:25 PM" (Standard Hevy)
        // 2. "2026-04-28 15:25:00" (ISO-ish)
        // 3. "28 Apr 2026, 15:25" (Euro)
        
        const cleanStr = dateStr.trim();
        
        try {
            // Try standard Hevy format
            const d1 = parse(cleanStr, "MMM d, yyyy, h:mm a", new Date());
            if (!isNaN(d1.getTime())) return d1;
            
            const d2 = parse(cleanStr, "MMM d, yyyy, HH:mm", new Date());
            if (!isNaN(d2.getTime())) return d2;

            const d3 = parse(cleanStr, "d MMM yyyy, HH:mm", new Date());
            if (!isNaN(d3.getTime())) return d3;
        } catch {
            // Fall through to native Date
        }

        const nativeDate = new Date(cleanStr);
        return nativeDate;
    }

    function detectMuscleGroup(name: string): string {
        const n = name.toLowerCase();
        if (n.includes("bench press") || n.includes("chest") || n.includes("fly")) return "Chest";
        if (n.includes("row") || n.includes("pull") || n.includes("deadlift")) return "Back";
        if (n.includes("squat") || n.includes("leg") || n.includes("lung")) return "Legs";
        if (n.includes("shoulder") || n.includes("press") || n.includes("lateral")) return "Shoulders";
        if (n.includes("curl") || n.includes("extension") || n.includes("tricep") || n.includes("bicep")) return "Arms";
        return "Other";
    }

    const handleBack = () => {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    };

    const statusColor = status
        ? status.type === "success" ? colors.success : status.type === "error" ? colors.error : colors.tint
        : colors.tint;
    const statusIcon = status?.type === "success" ? "checkmark-circle" : status?.type === "error" ? "alert-circle" : "information-circle";
    const canImport = !!importText.trim() && !loading;

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn} accessibilityLabel={translate("common.back")}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>
                <View style={styles.headerInfo}>
                    <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>{k("title")}</Text>
                    <Text style={[styles.headerSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>{k("subtitle")}</Text>
                </View>
                <View style={styles.backBtn} />
            </View>

            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
                {/* How-to */}
                <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{k("how_title")}</Text>
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {[k("step_1"), k("step_2"), k("step_3")].map((step, i) => (
                        <View key={i} style={[styles.stepRow, i > 0 && { marginTop: 12 }]}>
                            <View style={[styles.stepNum, { backgroundColor: colors.tint + "1F" }]}>
                                <Text style={[styles.stepNumText, { color: colors.tint }]}>{i + 1}</Text>
                            </View>
                            <Text style={[styles.stepText, { color: colors.text }]}>{step}</Text>
                        </View>
                    ))}
                </View>

                {/* File picker */}
                <Text style={[styles.sectionTitle, { color: colors.accentText }]}>{k("file_section")}</Text>
                {fileName ? (
                    <View style={[styles.fileChip, { backgroundColor: colors.tint + "12", borderColor: colors.tint + "40" }]}>
                        <View style={[styles.fileIcon, { backgroundColor: colors.tint }]}>
                            <Ionicons name="document-text" size={20} color="#FFF" />
                        </View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.fileName, { color: colors.text }]} numberOfLines={1}>{fileName}</Text>
                            <Text style={[styles.fileMeta, { color: colors.secondaryText }]}>{k("file_rows", { count: rowCount })}</Text>
                        </View>
                        <Pressable onPress={pickFile} disabled={loading} hitSlop={6} style={(s) => [styles.chipBtn, pressFeedback(s)]}>
                            <Text style={[styles.chipBtnText, { color: colors.tint }]}>{k("change")}</Text>
                        </Pressable>
                        <Pressable onPress={clearFile} disabled={loading} hitSlop={6} style={(s) => [styles.chipClose, pressFeedback(s)]} accessibilityLabel={k("remove_file")}>
                            <Ionicons name="close" size={18} color={colors.secondaryText} />
                        </Pressable>
                    </View>
                ) : (
                    <Pressable
                        onPress={pickFile}
                        disabled={loading}
                        style={({ pressed, hovered }: PressState) => [
                            styles.dropZone,
                            {
                                borderColor: hovered || pressed ? colors.tint : colors.tint + "60",
                                backgroundColor: hovered || pressed ? colors.tint + "14" : colors.tint + "08",
                            },
                            pressFeedback({ pressed, hovered: false }),
                        ]}
                    >
                        <View style={[styles.dropIcon, { backgroundColor: colors.tint + "1F" }]}>
                            <Ionicons name="cloud-upload" size={26} color={colors.tint} />
                        </View>
                        <Text style={[styles.dropTitle, { color: colors.text }]}>{k("select_file")}</Text>
                        <Text style={[styles.dropHint, { color: colors.secondaryText }]}>{k("file_hint")}</Text>
                    </Pressable>
                )}

                <View style={styles.divider}>
                    <View style={[styles.line, { backgroundColor: colors.border }]} />
                    <Text style={[styles.orText, { color: colors.secondaryText }]}>{k("or")}</Text>
                    <View style={[styles.line, { backgroundColor: colors.border }]} />
                </View>

                {/* Paste */}
                <View style={styles.pasteHeader}>
                    <Text style={[styles.sectionTitle, { color: colors.accentText, marginBottom: 0, marginTop: 0 }]}>{k("paste_label")}</Text>
                    {lineCount > 0 && (
                        <Text style={[styles.lineCount, { color: colors.secondaryText }]}>{k("lines", { count: lineCount })}</Text>
                    )}
                </View>
                <TextInput
                    multiline
                    style={[
                        styles.input, 
                        { 
                            backgroundColor: colors.card, 
                            color: colors.text, 
                            borderColor: colors.border 
                        }
                    ]}
                    placeholder={k("paste_placeholder")}
                    placeholderTextColor={colors.secondaryText}
                    value={importText}
                    onChangeText={(text) => {
                        setImportText(text);
                        if (!text.trim()) setFileName(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!loading}
                />

                {/* Status */}
                {status && !loading && (
                    <View style={[styles.statusBanner, { backgroundColor: statusColor + "14", borderColor: statusColor + "40" }]}>
                        <Ionicons name={statusIcon} size={20} color={statusColor} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.statusTitle, { color: statusColor }]}>{status.title}</Text>
                            <Text style={[styles.statusMessage, { color: colors.text }]}>{status.message}</Text>
                            {status.action && (
                                <Pressable onPress={status.action.onPress} style={(s) => [styles.statusAction, { backgroundColor: statusColor }, pressFeedback(s)]}>
                                    <Text style={styles.statusActionText}>{status.action.label}</Text>
                                    <Ionicons name="arrow-forward" size={14} color="#FFF" />
                                </Pressable>
                            )}
                        </View>
                        <Pressable onPress={() => setStatus(null)} hitSlop={8} accessibilityLabel="Dismiss">
                            <Ionicons name="close" size={16} color={colors.secondaryText} />
                        </Pressable>
                    </View>
                )}

                {/* Import action */}
                {loading ? (
                    <View style={[styles.progressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        <ActivityIndicator size="small" color={colors.tint} />
                        <Text style={[styles.progressText, { color: colors.text }]} numberOfLines={2}>{progress || k("importing")}</Text>
                    </View>
                ) : (
                    <Pressable
                        onPress={handleImport}
                        disabled={!canImport}
                        style={(s) => [
                            styles.importBtn,
                            { backgroundColor: canImport ? colors.tint : colors.secondary },
                            canImport && pressFeedback(s),
                        ]}
                    >
                        <Ionicons name="download-outline" size={18} color={canImport ? "#FFF" : colors.secondaryText} />
                        <Text style={[styles.importBtnText, { color: canImport ? "#FFF" : colors.secondaryText }]}>
                            {k("import_data")}{rowCount > 0 ? ` · ${rowCount}` : ""}
                        </Text>
                    </Pressable>
                )}

                {/* Danger zone */}
                <Text style={[styles.sectionTitle, { color: colors.error, marginTop: 40 }]}>{k("danger_title")}</Text>
                <View style={[styles.card, styles.dangerCard, { backgroundColor: colors.error + "0A", borderColor: colors.error + "40" }]}>
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.dangerTitle, { color: colors.text }]}>{k("clear_all")}</Text>
                        <Text style={[styles.dangerDesc, { color: colors.secondaryText }]}>{k("danger_desc")}</Text>
                    </View>
                    <Pressable
                        onPress={clearAllData}
                        disabled={loading}
                        style={(s) => [styles.dangerBtn, { borderColor: colors.error }, pressFeedback(s), loading && { opacity: 0.4 }]}
                    >
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                        <Text style={[styles.dangerBtnText, { color: colors.error }]}>{translate("common.delete")}</Text>
                    </Pressable>
                </View>
            </ScrollView>
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
        paddingBottom: 12,
        borderBottomWidth: 1,
    },
    backBtn: { width: 40, height: 40, justifyContent: "center", alignItems: "center" },
    headerInfo: { flex: 1, alignItems: "center", paddingHorizontal: 8 },
    headerTitle: { fontSize: 16, fontWeight: "800", fontFamily: "System" },
    headerSubtitle: { fontSize: 12, fontWeight: "600", fontFamily: "System", marginTop: 1 },

    content: { padding: 16, width: "100%", maxWidth: 720, alignSelf: "center" },
    sectionTitle: {
        fontSize: 13,
        fontWeight: "800",
        textTransform: "uppercase",
        letterSpacing: 1,
        marginTop: 24,
        marginBottom: 12,
        fontFamily: "System",
    },
    card: { borderRadius: 16, borderWidth: 1, padding: 16 },

    // How-to steps
    stepRow: { flexDirection: "row", alignItems: "center", gap: 12 },
    stepNum: { width: 26, height: 26, borderRadius: 8, justifyContent: "center", alignItems: "center" },
    stepNumText: { fontSize: 12, fontWeight: "900", fontFamily: "System" },
    stepText: { flex: 1, fontSize: 14, fontWeight: "600", lineHeight: 20, fontFamily: "System" },

    // File picker
    dropZone: {
        borderRadius: 16,
        borderWidth: 2,
        borderStyle: "dashed",
        paddingVertical: 28,
        paddingHorizontal: 16,
        alignItems: "center",
    },
    dropIcon: { width: 52, height: 52, borderRadius: 26, justifyContent: "center", alignItems: "center", marginBottom: 12 },
    dropTitle: { fontSize: 16, fontWeight: "800", fontFamily: "System" },
    dropHint: { fontSize: 12, fontWeight: "600", marginTop: 4, fontFamily: "System" },

    fileChip: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        padding: 12,
        borderRadius: 16,
        borderWidth: 1,
    },
    fileIcon: { width: 40, height: 40, borderRadius: 10, justifyContent: "center", alignItems: "center" },
    fileName: { fontSize: 15, fontWeight: "800", fontFamily: "System" },
    fileMeta: { fontSize: 12, fontWeight: "600", marginTop: 2, fontFamily: "System" },
    chipBtn: { paddingHorizontal: 8, paddingVertical: 6 },
    chipBtnText: { fontSize: 12, fontWeight: "800", fontFamily: "System" },
    chipClose: { padding: 4 },

    divider: { flexDirection: "row", alignItems: "center", marginVertical: 24, gap: 16 },
    line: { flex: 1, height: 1 },
    orText: { fontSize: 11, fontWeight: "900", letterSpacing: 1, fontFamily: "System" },

    // Paste
    pasteHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
    lineCount: { fontSize: 11, fontWeight: "700", fontFamily: "System" },
    input: {
        height: 220,
        borderRadius: 16,
        borderWidth: 1,
        padding: 16,
        textAlignVertical: "top",
        fontSize: 12,
        fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    },

    // Status
    statusBanner: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        marginTop: 16,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
    },
    statusTitle: { fontSize: 13, fontWeight: "800", fontFamily: "System" },
    statusMessage: { fontSize: 13, fontWeight: "500", lineHeight: 19, marginTop: 2, fontFamily: "System" },
    statusAction: {
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: 6,
        marginTop: 10,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
    },
    statusActionText: { color: "#FFF", fontSize: 13, fontWeight: "800", fontFamily: "System" },

    // Import
    progressCard: {
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        marginTop: 16,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
    },
    progressText: { flex: 1, fontSize: 14, fontWeight: "700", fontFamily: "System" },
    importBtn: {
        flexDirection: "row",
        gap: 8,
        marginTop: 16,
        height: 52,
        borderRadius: 26,
        justifyContent: "center",
        alignItems: "center",
    },
    importBtnText: { fontSize: 16, fontWeight: "800", fontFamily: "System" },

    // Danger zone
    dangerCard: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" },
    dangerTitle: { fontSize: 15, fontWeight: "800", fontFamily: "System" },
    dangerDesc: { fontSize: 12, fontWeight: "500", lineHeight: 18, marginTop: 4, fontFamily: "System" },
    dangerBtn: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderRadius: 20,
        borderWidth: 1.5,
    },
    dangerBtnText: { fontSize: 13, fontWeight: "800", fontFamily: "System" },
});

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

export default function Import() {
    const router = useRouter();
    const { t } = useTranslation();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();

    const [loading, setLoading] = useState(false);
    const [importText, setImportText] = useState("");
    const [progress, setProgress] = useState("");

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
                Alert.alert("File Loaded", `Loaded ${asset.name}. Click "Import Data" to proceed.`);
            } else {
                Alert.alert("Error", "The selected file appears to be empty.");
            }
        } catch (error: any) {
            console.error("File pick error:", error);
            Alert.alert(
                "Error", 
                `Could not read the selected file.\n\nDetails: ${error.message || "Unknown error"}`
            );
        }
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
            Alert.alert("Error", "Please paste your Hevy export data.");
            return;
        }

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
                Alert.alert("Info", "All workouts in this file have already been imported.");
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

            Alert.alert("Success", "Data imported successfully!", [
                { text: "OK", onPress: () => router.replace("/app/dashboard") }
            ]);

        } catch (error: any) {
            console.error("Import error:", error);
            Alert.alert("Import Failed", error.message || "An error occurred during import.");
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
            if (Platform.OS === "web") {
                window.alert("All data has been cleared.");
            } else {
                Alert.alert("Success", "All data has been cleared.");
            }
        } catch (error: any) {
            if (Platform.OS === "web") {
                window.alert(error.message || "Failed to clear data.");
            } else {
                Alert.alert("Error", error.message || "Failed to clear data.");
            }
        } finally {
            setLoading(false);
            setProgress("");
        }
    }

    async function clearAllData() {
        const title = "Delete All Data";
        const message = "Are you sure? This will permanently erase all your workouts, sets, and exercise history. This cannot be undone.";

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
                { text: "Cancel", style: "cancel" },
                { 
                    text: "Delete Everything", 
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
        } catch (e) {
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

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            {/* Header */}
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} style={styles.backBtn}>
                    <Ionicons name="chevron-back" size={28} color={colors.text} />
                </Pressable>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Import Hevy Data</Text>
                <View style={{ width: 40 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <Text style={[styles.instruction, { color: colors.secondaryText }]}>
                    Select your Hevy export file from your device or paste the content below.
                </Text>

                <Pressable 
                    style={[styles.fileBtn, { borderColor: colors.tint }]} 
                    onPress={pickFile}
                >
                    <Ionicons name="document-text-outline" size={24} color={colors.tint} />
                    <Text style={[styles.fileBtnText, { color: colors.tint }]}>Select CSV/TSV File</Text>
                </Pressable>

                <View style={styles.divider}>
                    <View style={[styles.line, { backgroundColor: colors.border }]} />
                    <Text style={[styles.orText, { color: colors.secondaryText }]}>OR</Text>
                    <View style={[styles.line, { backgroundColor: colors.border }]} />
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
                    placeholder="Paste data here..."
                    placeholderTextColor={colors.accentText}
                    value={importText}
                    onChangeText={setImportText}
                    autoCapitalize="none"
                    autoCorrect={false}
                />

                {loading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={colors.tint} />
                        <Text style={[styles.progressText, { color: colors.secondaryText }]}>{progress}</Text>
                    </View>
                ) : (
                    <Pressable 
                        style={[styles.importBtn, { backgroundColor: colors.tint }]} 
                        onPress={handleImport}
                    >
                        <Text style={styles.importBtnText}>Import Data</Text>
                    </Pressable>
                )}

                <Pressable 
                    style={[styles.clearBtn, { marginTop: 40 }]} 
                    onPress={clearAllData}
                    disabled={loading}
                >
                    <Text style={[styles.clearBtnText, { color: colors.error }]}>Clear All Previous Data</Text>
                </Pressable>
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
        paddingBottom: 10,
        borderBottomWidth: 1,
    },
    backBtn: { width: 40, height: 40, justifyContent: "center" },
    headerTitle: { fontSize: 18, fontWeight: "700" },

    content: { padding: 20 },
    instruction: { fontSize: 14, marginBottom: 20, lineHeight: 20, textAlign: "center" },
    
    fileBtn: {
        height: 60,
        borderRadius: 12,
        borderWidth: 2,
        borderStyle: "dashed",
        flexDirection: "row",
        justifyContent: "center",
        alignItems: "center",
        gap: 12,
        marginBottom: 24,
    },
    fileBtnText: { fontSize: 16, fontWeight: "700" },

    divider: {
        flexDirection: "row",
        alignItems: "center",
        marginBottom: 24,
        gap: 16,
    },
    line: { flex: 1, height: 1 },
    orText: { fontSize: 12, fontWeight: "800" },

    input: {
        height: 300,
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        textAlignVertical: "top",
        fontSize: 12,
        fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    },

    loadingContainer: { marginTop: 24, alignItems: "center" },
    progressText: { marginTop: 12, fontSize: 14, fontWeight: "600" },

    importBtn: {
        marginTop: 24,
        height: 50,
        borderRadius: 25,
        justifyContent: "center",
        alignItems: "center",
    },
    importBtnText: { color: "#FFF", fontSize: 16, fontWeight: "700" },

    clearBtn: {
        height: 50,
        justifyContent: "center",
        alignItems: "center",
    },
    clearBtnText: { fontSize: 14, fontWeight: "600" },
});

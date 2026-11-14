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
import * as Linking from "expo-linking";
import type { RoutePoint } from "../../lib/route";
import * as XLSX from "xlsx";

type StatusType = "success" | "error" | "info";
type Status = { type: StatusType; title: string; message: string; action?: { label: string; onPress: () => void } };

type PressState = { pressed: boolean; hovered?: boolean };
const pressFeedback = ({ pressed, hovered }: PressState) => ({
    opacity: pressed ? 0.75 : hovered ? 0.9 : 1,
    transform: [{ scale: pressed ? 0.98 : 1 }],
});

function csvValue(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
}

function calculateSplits(route: RoutePoint[]): { kilometer: number; seconds: number; pace: string }[] {
    const splits: { kilometer: number; seconds: number; pace: string }[] = [];
    let distance = 0;
    let previousBoundary = 0;
    let previousTime = route[0]?.time ? new Date(route[0].time).getTime() : 0;
    for (let index = 1; index < route.length; index++) {
        const from = route[index - 1];
        const to = route[index];
        distance += haversineMeters(from.latitude, from.longitude, to.latitude, to.longitude) / 1000;
        if (distance >= previousBoundary + 1 && to.time) {
            const seconds = Math.max(0, (new Date(to.time).getTime() - previousTime) / 1000);
            const paceSeconds = Math.round(seconds / Math.max(0.001, distance - previousBoundary));
            splits.push({ kilometer: splits.length + 1, seconds, pace: `${Math.floor(paceSeconds / 60)}:${String(paceSeconds % 60).padStart(2, "0")} /km` });
            previousBoundary += 1;
            previousTime = new Date(to.time).getTime();
        }
    }
    return splits;
}

function normalizeStravaExport(content: string): string {
    const trimmed = content.trim();
    if (trimmed.startsWith("<")) {
        const isTcx = /<TrainingCenterDatabase[\s>]/i.test(trimmed);
        const gpxPoints = Array.from(trimmed.matchAll(/<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>[\s\S]*?<time>([^<]+)<\/time>[\s\S]*?<\/trkpt>/gi));
        const start = isTcx
            ? /<Activity[^>]*Id="([^"]+)"[\s\S]*?<Lap\b/i.exec(trimmed)?.[1]
            : gpxPoints[0]?.[3] || /<time>([^<]+)<\/time>/i.exec(trimmed)?.[1];
        if (!start) throw new Error("Could not find a run date in this file.");
        const lastPoint = gpxPoints[gpxPoints.length - 1];
        const end = lastPoint?.[3] || start;
        const duration = isTcx
            ? Number(/<TotalTimeSeconds>([^<]+)<\/TotalTimeSeconds>/i.exec(trimmed)?.[1] || 0)
            : Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
        const distanceMeters = isTcx
            ? Number(/<DistanceMeters>([^<]+)<\/DistanceMeters>/i.exec(trimmed)?.[1] || 0)
            : gpxPoints.slice(1).reduce((total, point, index) => {
                const previous = gpxPoints[index];
                return total + haversineMeters(
                    Number(previous[1]), Number(previous[2]),
                    Number(point[1]), Number(point[2]),
                );
            }, 0);
        const title = /<(?:name|trk)\b[^>]*>([^<]+)<\/(?:name|trk)>/i.exec(trimmed)?.[1]?.trim() || "Strava Run";
        return [
            "Title,Start Time,End Time,Description,Exercise Title,Weight,Reps,Distance,Duration,Average Heart Rate,Max Heart Rate,Average Speed,Max Speed",
            [
                csvValue(title),
                csvValue(start),
                csvValue(end),
                csvValue("Imported from Strava export"),
                csvValue("Running"),
                "0", "0", String(distanceMeters / 1000), String(duration),
            ].join(","),
        ].join("\n");
    }

    const header = trimmed.split(/\r?\n/, 1)[0];
    const separator = header.includes("\t") ? "\t" : ",";
    const columns = parseCSVLineStatic(header, separator).map((column) => column.trim().toLowerCase());
    if (columns.includes("type") && columns.some((column) => column === "start_date_local" || column === "start_date" || column === "date") && columns.some((column) => column === "x_km" || column === "km" || column === "distance")) {
        const indexOf = (names: string[]) => {
            for (const name of names) {
                const exactIndex = columns.indexOf(name);
                if (exactIndex >= 0) return exactIndex;
            }
            return columns.findIndex((column) => names.some((name) => column.includes(name)));
        };
        const dateIndex = indexOf(["start_date_local", "start_date"]);
        const nameIndex = indexOf(["name", "activity name"]);
        const typeIndex = indexOf(["type"]);
        const distanceIndex = indexOf(["x_km", "km", "distance"]);
        const durationIndex = indexOf(["moving_time", "elapsed_time", "total_elapsed_time"]);
        return [
            "Title,Start Time,End Time,Description,Exercise Title,Weight,Reps,Distance,Duration,Average Heart Rate,Max Heart Rate,Average Speed,Max Speed",
            ...trimmed.split(/\r?\n/).slice(1).map((line) => {
                const values = parseCSVLineStatic(line, separator);
                if (typeIndex >= 0 && !/run/i.test(values[typeIndex] || "")) return "";
                const start = (values[dateIndex] || "").trim().replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/, "$1T$2");
                const duration = Number(values[durationIndex] || 0);
                const end = start && duration > 0
                    ? new Date(new Date(start).getTime() + duration * 1000).toISOString()
                    : "";
                return [
                    csvValue(values[nameIndex] || "Strava Run"), csvValue(start), csvValue(end),
                    csvValue("Imported from Strava export"), csvValue("Running"), "0", "0",
                    String(Number(values[distanceIndex] || 0)), String(duration),
                    values[indexOf(["average_heartrate"])] || "", values[indexOf(["max_heartrate"])] || "",
                    values[indexOf(["average_speed"])] || "", values[indexOf(["max_speed"])] || "",
                ].join(",");
            }).filter(Boolean),
        ].join("\n");
    }
    return content;
}

function extractGpxRoute(content: string): RoutePoint[] {
    return Array.from(content.matchAll(/<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>[\s\S]*?<time>([^<]+)<\/time>[\s\S]*?<\/trkpt>/gi))
        .map((match) => ({ latitude: Number(match[1]), longitude: Number(match[2]), time: match[3] }))
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude));
}

function isStravaExport(content: string): boolean {
    const trimmed = content.trim();
    if (/Imported from Strava export/i.test(trimmed) || /creator="StravaGPX"/i.test(trimmed)) return true;
    const header = trimmed.split(/\r?\n/, 1)[0].toLowerCase();
    const columns = parseCSVLineStatic(header, header.includes("\t") ? "\t" : ",");
    return columns.includes("type")
        && columns.some((column) => ["start_date_local", "start_date"].includes(column.trim()))
        && columns.some((column) => ["x_km", "km", "distance"].includes(column.trim()));
}

function haversineMeters(latitude1: number, longitude1: number, latitude2: number, longitude2: number): number {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const earthRadiusMeters = 6371000;
    const latitudeDelta = radians(latitude2 - latitude1);
    const longitudeDelta = radians(longitude2 - longitude1);
    const a = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2)) * Math.sin(longitudeDelta / 2) ** 2;
    return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCSVLineStatic(line: string, separator: string): string[] {
    const result: string[] = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
        const char = line[index];
        if (char === '"' && line[index + 1] === '"') { value += '"'; index++; }
        else if (char === '"') quoted = !quoted;
        else if (char === separator && !quoted) { result.push(value.trim()); value = ""; }
        else value += char;
    }
    result.push(value.trim());
    return result;
}

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
    const [routeData, setRouteData] = useState<RoutePoint[] | null>(null);
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
                    "application/gpx+xml",
                    "application/tcx+xml",
                    "application/xml",
                    "text/xml",
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    "application/octet-stream",
                    "public.comma-separated-values-text",
                    "public.xml",
                    "public.text",
                    "public.data",
                    ".gpx",
                    ".xlsx"
                ],
                copyToCacheDirectory: true,
            });

            if (result.canceled || !result.assets || result.assets.length === 0) return;

            const asset = result.assets[0];
            let fileUri = asset.uri;
            

            const isSpreadsheet = /\.xlsx$/i.test(asset.name || fileUri);
            let content = "";

            if (isSpreadsheet) {
                const response = await fetch(fileUri);
                const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                if (!firstSheet) throw new Error("The spreadsheet does not contain a worksheet.");
                content = XLSX.utils.sheet_to_csv(firstSheet);
            } else if (Platform.OS === "web" || fileUri.startsWith("blob:") || fileUri.startsWith("data:")) {
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
                setRouteData(content.trim().startsWith("<") ? extractGpxRoute(content) : null);
                setImportText(normalizeStravaExport(content));
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
        setRouteData(null);
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
            const normalizedImport = normalizeStravaExport(importText);
            const stravaImport = isStravaExport(importText);
            const lines = normalizedImport.trim().split(/\r?\n/).filter(line => line.trim());
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
                if (c.includes("average heart") || c.includes("avg heart")) columnMap["average_heart_rate"] = idx.toString();
                if (c.includes("max heart")) columnMap["max_heart_rate"] = idx.toString();
                if (c.includes("average speed") || c.includes("avg speed")) columnMap["average_speed"] = idx.toString();
                if (c.includes("max speed")) columnMap["max_speed"] = idx.toString();
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
                    const durationSeconds = Number(getVal(values, "duration_seconds")) || 0;
                    const endTime = stravaImport && durationSeconds > 0
                        ? new Date(startTime.getTime() + durationSeconds * 1000)
                        : endTimeStr ? parseDate(endTimeStr) : null;
                    workoutsMap[workoutKey] = {
                        title: title,
                        start_time: startTime,
                        end_time: endTime,
                        description: getVal(values, "description") || "",
                        sets: []
                    };
                    workoutsMap[workoutKey].activityData = {};
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
                const activityData = workoutsMap[workoutKey].activityData;
                const numberValue = (key: string) => Number(getVal(values, key)) || null;
                activityData.averageHeartRate = numberValue("average_heart_rate");
                activityData.maxHeartRate = numberValue("max_heart_rate");
                activityData.averageSpeed = numberValue("average_speed");
                activityData.maxSpeed = numberValue("max_speed");
                activityData.distanceKm = Number(getVal(values, "distance_km")) || null;
                activityData.durationSeconds = Number(getVal(values, "duration_seconds")) || null;
                if (routeData) activityData.splits = calculateSplits(routeData);

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
            const existingWorkoutIds = new Map<string, string>();
            
            setProgress(`Checking for existing data in batches...`);
            for (let i = 0; i < allStartTimes.length; i += 100) {
                const batch = allStartTimes.slice(i, i + 100);
                const { data: existingBatch } = await supabase
                    .from("workouts")
                    .select("id, start_time")
                    .eq("user_id", user.id)
                    .in("start_time", batch);
                
                existingBatch?.forEach(w => {
                    const startTime = new Date(w.start_time).toISOString();
                    existingStartTimesSet.add(startTime);
                    existingWorkoutIds.set(startTime, w.id);
                });
            }

            const importDates = workoutEntries.map((workout) => workout.start_time.getTime());
            if (stravaImport && importDates.length > 0) {
                const earliestDate = new Date(Math.min(...importDates));
                earliestDate.setHours(0, 0, 0, 0);
                const latestDate = new Date(Math.max(...importDates));
                latestDate.setHours(23, 59, 59, 999);
                const { data: sameDayWorkouts, error: sameDayError } = await supabase
                    .from("workouts")
                    .select("id, title, start_time")
                    .eq("user_id", user.id)
                    .gte("start_time", earliestDate.toISOString())
                    .lte("start_time", latestDate.toISOString());
                if (sameDayError) throw sameDayError;
                if (stravaImport) for (const workout of workoutEntries) {
                    const isRunningEntry = /run|running|corrida/i.test(workout.title)
                        || workout.sets.some((set: { exercise_title: string }) => /run|running|corrida/i.test(set.exercise_title));
                    const candidates = (sameDayWorkouts ?? []).filter((candidate) =>
                        candidate.start_time.slice(0, 10) === workout.start_time.toISOString().slice(0, 10)
                        && (!isRunningEntry || /run|running|corrida/i.test(candidate.title)),
                    );
                    const exactCandidate = candidates.find((candidate) => candidate.title === workout.title);
                    const closestCandidate = candidates
                        .sort((a, b) => Math.abs(new Date(a.start_time).getTime() - workout.start_time.getTime())
                            - Math.abs(new Date(b.start_time).getTime() - workout.start_time.getTime()))[0];
                    const existingId = (exactCandidate ?? closestCandidate)?.id;
                    if (existingId) existingWorkoutIds.set(workout.start_time.toISOString(), existingId);
                }
            }

            if (stravaImport && routeData && workoutEntries.length === 1) {
                const existingId = existingWorkoutIds.get(workoutEntries[0].start_time.toISOString());
                if (existingId) {
                    const { error: routeUpdateError } = await supabase
                        .from("workouts")
                        .update({ route_data: routeData })
                        .eq("id", existingId)
                        .eq("user_id", user.id);
                    if (routeUpdateError) throw routeUpdateError;
                }
            }

            for (const workout of workoutEntries) {
                    const existingId = existingWorkoutIds.get(workout.start_time.toISOString());
                    if (!existingId) continue;

                    const workoutUpdates: Record<string, unknown> = {
                        title: workout.title,
                        start_time: workout.start_time.toISOString(),
                        end_time: workout.end_time?.toISOString() ?? null,
                        description: workout.description,
                    };
                    if (routeData) workoutUpdates.route_data = routeData;
                    workoutUpdates.activity_data = workout.activityData;
                    const { error: workoutUpdateError } = await supabase
                        .from("workouts")
                        .update(workoutUpdates)
                        .eq("id", existingId)
                        .eq("user_id", user.id);
                    if (workoutUpdateError) throw workoutUpdateError;

                    const runningSet = workout.sets[0];
                    const { error: setUpdateError } = await supabase
                        .from("sets")
                        .update({
                            distance_km: parseFloat(runningSet.distance_km) || null,
                            duration_s: parseInt(runningSet.duration_seconds) || null,
                        })
                        .eq("workout_id", existingId);
                    if (setUpdateError) throw setUpdateError;
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
                            description: workout.description,
                            ...(stravaImport ? { route_data: routeData, activity_data: workout.activityData } : {}),
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

        const normalizedDate = cleanStr.replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/, "$1T$2");
        const nativeDate = new Date(normalizedDate);
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

    function openExportGuide(url: string) {
        const openRequest = Platform.OS === "web"
            ? Promise.resolve().then(() => {
                const newWindow = window.open(url, "_blank", "noopener,noreferrer");
                if (!newWindow) throw new Error("The browser blocked the new tab.");
            })
            : Linking.openURL(url);
        openRequest.catch((error) => {
            console.error("Could not open export guide:", error);
            setStatus({ type: "error", title: k("error"), message: k("guide_error") });
        });
    }

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
                <View style={[styles.exportLinksCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={[styles.exportLinksTitle, { color: colors.text }]}>{k("export_links_title")}</Text>
                    <Text style={[styles.exportLinksDescription, { color: colors.secondaryText }]}>{k("export_links_description")}</Text>
                    <Pressable onPress={() => openExportGuide("https://hevy.com/settings?export")} style={({ pressed }) => [styles.exportLink, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
                        <Ionicons name="barbell-outline" size={18} color={colors.tint} />
                        <Text style={[styles.exportLinkText, { color: colors.tint }]}>{k("hevy_export_link")}</Text>
                        <Ionicons name="open-outline" size={16} color={colors.secondaryText} />
                    </Pressable>
                    <Pressable onPress={() => openExportGuide("https://entorb.net/strava-streamlit/r10_activity_list_and_excel_export")} style={({ pressed }) => [styles.exportLink, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}>
                        <Ionicons name="navigate-outline" size={18} color={colors.tint} />
                        <Text style={[styles.exportLinkText, { color: colors.tint }]}>{k("strava_export_link")}</Text>
                        <Ionicons name="open-outline" size={16} color={colors.secondaryText} />
                    </Pressable>
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
    exportLinksCard: { borderWidth: 1, borderRadius: 16, padding: 16, marginTop: 16, marginBottom: 28 },
    exportLinksTitle: { fontSize: 15, fontWeight: "800", marginBottom: 4 },
    exportLinksDescription: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
    exportLink: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, paddingVertical: 13 },
    exportLinkText: { flex: 1, fontSize: 14, fontWeight: "700" },

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

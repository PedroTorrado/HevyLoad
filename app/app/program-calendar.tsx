import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { format, getDaysInMonth, parseISO, startOfMonth } from "date-fns";
import { supabase } from "../../lib/supabase";
import { useThemeColor } from "../../lib/theme";
import {
    buildCalendarPrompt,
    buildHistorySummary,
    CalendarMode,
    CalendarProgram,
    CalendarSession,
    CalendarSuggestion,
    ImportedCalendarProgram,
    extractJsonFromResponse,
    formatPace,
    parsePaceSeconds,
    sessionForDate,
    validateImportedProgram,
} from "../../lib/program-calendar";
import { getLocalYYYYMMDD } from "../../lib/date-utils";

function normalizeCalendarSession(row: Record<string, unknown>): CalendarSession {
    return {
        id: String(row.id),
        program_id: String(row.program_id),
        date: String(row.session_date ?? row.date),
        mode: row.mode as CalendarSession["mode"],
        title: String(row.title),
        details: (row.details ?? {}) as CalendarSession["details"],
        status: (row.status ?? "planned") as CalendarSession["status"],
        completion_notes: (row.completion_notes as string | null) ?? null,
        completed_at: (row.completed_at as string | null) ?? null,
    };
}

type DisplaySession = CalendarSession & { program_name?: string };

function normalizedProgramName(name: string) {
    return name.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function normalizedSessionTitle(title: string) {
    return title.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function formatModeLabel(mode: string) {
    return mode
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

function formatChangeLabel(value: string) {
    return value
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatSuggestionChanges(changes: Record<string, unknown>): string[] {
    const lines: string[] = [];
    const sessions = Array.isArray(changes.sessions) ? changes.sessions : [];
    sessions.forEach((value) => {
        if (!value || typeof value !== "object") return;
        const session = value as Record<string, unknown>;
        const dates = Array.isArray(session.dates)
            ? session.dates.filter((date): date is string => typeof date === "string")
            : [];
        const heading = [
            dates.length ? dates.join(", ") : "Program sessions",
            typeof session.title === "string" ? session.title : "",
        ].filter(Boolean).join(" — ");
        if (heading) lines.push(heading);
        if (typeof session.details === "string") {
            lines.push(session.details);
        } else if (session.details && typeof session.details === "object") {
            Object.entries(session.details as Record<string, unknown>).forEach(([key, value]) => {
                if (key === "exercises" && Array.isArray(value)) {
                    value.forEach((exercise) => {
                        if (!exercise || typeof exercise !== "object") return;
                        const item = exercise as Record<string, unknown>;
                        const prescription = [
                            item.sets !== undefined ? `${item.sets} sets` : "",
                            item.reps !== undefined ? `${item.reps} reps` : "",
                            item.load !== undefined ? String(item.load) : "",
                            item.rpe !== undefined ? `RPE ${item.rpe}` : "",
                        ].filter(Boolean).join(" · ");
                        lines.push(`${String(item.name ?? "Exercise")}${prescription ? `: ${prescription}` : ""}`);
                    });
                } else if (value !== null && value !== undefined && value !== "") {
                    lines.push(`${formatChangeLabel(key)}: ${String(value)}`);
                }
            });
        }
    });
    if (!lines.length) {
        Object.entries(changes)
            .filter(([key]) => key !== "scope" && key !== "sessions")
            .forEach(([key, value]) => {
                if (value !== null && value !== undefined && value !== "") {
                    lines.push(`${formatChangeLabel(key)}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
                }
            });
    }
    return lines;
}

function getSuggestionDates(changes: Record<string, unknown>): string[] {
    const dates = new Set<string>();
    if (typeof changes.date === "string") dates.add(changes.date);
    if (Array.isArray(changes.sessions)) {
        changes.sessions.forEach((value) => {
            if (!value || typeof value !== "object") return;
            const session = value as Record<string, unknown>;
            if (Array.isArray(session.dates)) {
                session.dates.filter((date): date is string => typeof date === "string").forEach((date) => dates.add(date));
            }
        });
    }
    return [...dates];
}

function mergeSuggestedDetails(current: CalendarSession["details"], suggested: Record<string, unknown>): CalendarSession["details"] {
    const currentDetails = current ?? {};
    const merged = { ...currentDetails, ...suggested };
    const suggestedExercises = Array.isArray(suggested.exercises) ? suggested.exercises : [];
    if (suggestedExercises.length) {
        const currentExercises = currentDetails.exercises ?? [];
        merged.exercises = currentExercises.map((exercise) => {
            const update = suggestedExercises.find((item: unknown) =>
                item && typeof item === "object" && String((item as Record<string, unknown>).name ?? "").toLowerCase() === exercise.name.toLowerCase()
            ) as Record<string, unknown> | undefined;
            return update ? { ...exercise, ...update } : exercise;
        });
        suggestedExercises.forEach((item: unknown) => {
            if (!item || typeof item !== "object") return;
            const update = item as Record<string, unknown>;
            if (!currentExercises.some((exercise) => exercise.name.toLowerCase() === String(update.name ?? "").toLowerCase())) {
                merged.exercises?.push(update as typeof currentExercises[number]);
            }
        });
    }
    return merged;
}

function formatSuggestedDetails(change: Record<string, unknown>, target?: CalendarSession): string[] {
    const lines: string[] = [];
    const suggested = change.details && typeof change.details === "object" ? change.details as Record<string, unknown> : change;
    const currentExercises = target?.details?.exercises ?? [];
    if (Array.isArray(suggested.exercises)) {
        suggested.exercises.forEach((item) => {
            if (!item || typeof item !== "object") return;
            const next = item as Record<string, unknown>;
            const previous = currentExercises.find((exercise) => exercise.name.toLowerCase() === String(next.name ?? "").toLowerCase());
            const fields = ["sets", "reps", "load", "rpe"].flatMap((key) => {
                if (next[key] === undefined) return [];
                const before = previous?.[key as keyof typeof previous];
                return before !== undefined && String(before) !== String(next[key])
                    ? [`${formatChangeLabel(key)}: ${before} → ${next[key]}`]
                    : [`${formatChangeLabel(key)}: ${next[key]}`];
            });
            lines.push(`${String(next.name ?? "Exercise")}${fields.length ? ` — ${fields.join(" · ")}` : ""}`);
        });
    }
    Object.entries(suggested).forEach(([key, value]) => {
        if (key === "exercises" || value === null || value === undefined || value === "") return;
        const before = target?.details?.[key as keyof NonNullable<CalendarSession["details"]>];
        lines.push(before !== undefined && String(before) !== String(value)
            ? `${formatChangeLabel(key)}: ${String(before)} → ${String(value)}`
            : `${formatChangeLabel(key)}: ${String(value)}`);
    });
    return lines;
}

export default function ProgramCalendar() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const colors = useThemeColor();
    const [programs, setPrograms] = useState<CalendarProgram[]>([]);
    const [sessions, setSessions] = useState<DisplaySession[]>([]);
    const [suggestions, setSuggestions] = useState<CalendarSuggestion[]>([]);
    const [month, setMonth] = useState(startOfMonth(new Date()));
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [showSetup, setShowSetup] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [showSuggestionsImport, setShowSuggestionsImport] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [prompt, setPrompt] = useState("");
    const [response, setResponse] = useState("");
    const [suggestionResponse, setSuggestionResponse] = useState("");
    const [mode, setMode] = useState<CalendarMode>("combined");
    const [goal, setGoal] = useState("");
    const [durationWeeks, setDurationWeeks] = useState("8");
    const [startDate, setStartDate] = useState(getLocalYYYYMMDD());
    const [daysAvailable, setDaysAvailable] = useState("");
    const [equipment, setEquipment] = useState("");
    const [limitations, setLimitations] = useState("");
    const [preferences, setPreferences] = useState("");
    const [lookbackDays, setLookbackDays] = useState("84");
    const [busy, setBusy] = useState(false);
    const [changedSessions, setChangedSessions] = useState<Record<string, CalendarSession>>({});
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState("");
    const [editingDetails, setEditingDetails] = useState<NonNullable<CalendarSession["details"]>>({});
    const [exportedJson, setExportedJson] = useState("");
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
    const [pendingImport, setPendingImport] = useState<{ program: ImportedCalendarProgram; duplicate: CalendarProgram } | null>(null);
    const [draggingFile, setDraggingFile] = useState(false);

    const selectedSessions = useMemo(() => sessionForDate(sessions, selectedDate), [sessions, selectedDate]);
    const selectedSuggestions = suggestions.filter((suggestion) =>
        suggestion.program_id === selectedSessions[0]?.program_id
        && (suggestion.suggestion_date === getLocalYYYYMMDD(selectedDate) || getSuggestionDates(suggestion.changes).includes(getLocalYYYYMMDD(selectedDate)))
    );
    const activeProgram = programs.find((program) => selectedSessions.some((session) => session.program_id === program.id)) ?? programs[0];

    function focusDate(dateValue: string) {
        const date = parseISO(dateValue);
        if (Number.isNaN(date.getTime())) return;
        setMonth(startOfMonth(date));
        setSelectedDate(date);
    }

    async function loadPrograms(focusFirstSession = false) {
        setLoading(true);
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setError("Your session has expired. Please sign in again.");
            setLoading(false);
            return;
        }
        const { data, error: programError } = await supabase
            .from("calendar_programs")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_archived", false)
            .order("created_at", { ascending: false });
        if (programError) {
            setError("Calendar storage is not available yet. Apply the calendar migration first.");
            setLoading(false);
            return;
        }
        const nextPrograms = (data ?? []).map((row) => {
            const definition = row.definition && typeof row.definition === "object"
                ? row.definition as { overview?: CalendarProgram["overview"] }
                : {};
            return { ...row, overview: row.overview ?? definition.overview } as CalendarProgram;
        });
        setPrograms(nextPrograms);
        if (nextPrograms.length) {
            const { data: sessionData, error: sessionError } = await supabase
                .from("calendar_sessions")
                .select("*")
                .in("program_id", nextPrograms.map((program) => program.id))
                .eq("user_id", user.id)
                .order("session_date", { ascending: true });
            if (sessionError) setError("Could not load calendar sessions.");
            else {
                const loadedSessions = (sessionData ?? []).map((row) => {
                    const session = normalizeCalendarSession(row as Record<string, unknown>);
                    return { ...session, program_name: nextPrograms.find((program) => program.id === session.program_id)?.name };
                });
                setSessions(loadedSessions);
                if (focusFirstSession) {
                    const firstPlannedSession = loadedSessions.find((session) => session.date >= nextPrograms.map((program) => program.start_date).sort()[0]);
                    if (firstPlannedSession) focusDate(firstPlannedSession.date);
                }
            }
            const { data: suggestionData, error: suggestionError } = await supabase
                .from("calendar_program_suggestions")
                .select("*")
                .in("program_id", nextPrograms.map((program) => program.id))
                .eq("user_id", user.id)
                .order("suggestion_date", { ascending: true, nullsFirst: false });
            if (suggestionError?.code === "42P01" || suggestionError?.code === "PGRST205") {
                setSuggestions([]);
            } else if (suggestionError) {
                setError("Could not load calendar suggestions.");
                setSuggestions([]);
            } else {
                setSuggestions((suggestionData ?? []) as CalendarSuggestion[]);
            }
        } else {
            setSessions([]);
            setSuggestions([]);
        }
        setLoading(false);
    }

    useEffect(() => { loadPrograms(); }, []);

    useEffect(() => {
        if (Platform.OS !== "web" || !showImport || typeof document === "undefined") return;
        const dropZone = document.getElementById("program-calendar-import-dropzone");
        if (!dropZone) return;
        const onDragOver = (event: DragEvent) => {
            event.preventDefault();
            setDraggingFile(true);
        };
        const onDragLeave = () => setDraggingFile(false);
        const onDrop = (event: DragEvent) => {
            event.preventDefault();
            setDraggingFile(false);
            const file = event.dataTransfer?.files[0];
            if (!file) return;
            void readImportedFile(file);
        };
        dropZone.addEventListener("dragover", onDragOver);
        dropZone.addEventListener("dragleave", onDragLeave);
        dropZone.addEventListener("drop", onDrop);
        return () => {
            dropZone.removeEventListener("dragover", onDragOver);
            dropZone.removeEventListener("dragleave", onDragLeave);
            dropZone.removeEventListener("drop", onDrop);
        };
    }, [showImport]);

    async function readImportedFile(file: { name?: string; text?: () => Promise<string>; uri?: string }) {
        try {
            const content = file.text
                ? await file.text()
                : file.uri && Platform.OS === "web"
                    ? await (await fetch(file.uri)).text()
                    : file.uri
                        ? await FileSystem.readAsStringAsync(file.uri)
                        : "";
            if (!content.trim()) throw new Error("The selected file is empty.");
            setResponse(content);
            setNotice(`Loaded ${file.name ?? "JSON file"}. Review it, then choose Import plan.`);
            setError("");
        } catch (fileError) {
            console.error("Calendar file import error:", fileError);
            setNotice("");
            setError(fileError instanceof Error ? fileError.message : "Could not read the JSON file.");
        }
    }

    async function chooseImportFile() {
        const result = await DocumentPicker.getDocumentAsync({
            type: ["application/json", "text/json", "text/plain"],
            copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.[0]) return;
        await readImportedFile(result.assets[0]);
    }

    async function createPrompt() {
        setBusy(true);
        const summary = await buildHistorySummary(Number(lookbackDays) || 84);
        setPrompt(buildCalendarPrompt({
            mode,
            startDate,
            durationWeeks: Number(durationWeeks) || 8,
            goal,
            daysAvailable,
            equipment,
            limitations,
            preferences,
            historyLookbackDays: Number(lookbackDays) || 84,
            historySummary: summary,
        }));
        setShowSetup(false);
        setBusy(false);
    }

    async function saveImportedProgram(importedProgram: ImportedCalendarProgram, replaceProgramId?: string) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Your session has expired. Please sign in again.");
        let previousSessions: { session_date: string; mode: CalendarSession["mode"]; title: string; status: CalendarSession["status"]; completion_notes: string | null; completed_at: string | null }[] = [];
        if (replaceProgramId) {
            const { data, error: previousSessionsError } = await supabase
                .from("calendar_sessions")
                .select("session_date, mode, title, status, completion_notes, completed_at")
                .eq("program_id", replaceProgramId)
                .eq("user_id", user.id);
            if (previousSessionsError) throw previousSessionsError;
            previousSessions = data ?? [];
        }
        const { data: program, error: programError } = await supabase
            .from("calendar_programs")
            .insert({
                user_id: user.id,
                name: importedProgram.name,
                mode: importedProgram.mode,
                start_date: importedProgram.start_date,
                duration_weeks: importedProgram.duration_weeks,
                source_prompt: prompt,
                definition: importedProgram,
            })
            .select("*")
            .single();
        if (programError || !program) throw programError ?? new Error("Could not save the program.");
        const rows = importedProgram.sessions.map((session) => ({
            user_id: user.id,
            program_id: program.id,
            session_date: session.date,
            mode: session.mode,
            title: session.title,
            details: session.details ?? {},
        }));
        const insertedRows: { id: string; session_date: string }[] = [];
        if (rows.length) {
            const { data, error: sessionError } = await supabase.from("calendar_sessions").insert(rows).select("id, session_date");
            if (sessionError) throw sessionError;
            insertedRows.push(...(data ?? []));
        }
        if (replaceProgramId) {
            for (const inserted of insertedRows) {
                const importedSession = importedProgram.sessions.find((session) => session.date === inserted.session_date);
                const previous = previousSessions.find((session) =>
                    session.session_date === inserted.session_date
                    && importedSession
                    && session.mode === importedSession.mode
                    && normalizedSessionTitle(session.title) === normalizedSessionTitle(importedSession.title)
                ) ?? previousSessions.find((session) => session.session_date === inserted.session_date);
                if (!previous || previous.status === "planned") continue;
                const { error: completionError } = await supabase
                    .from("calendar_sessions")
                    .update({
                        status: previous.status,
                        completion_notes: previous.completion_notes,
                        completed_at: previous.completed_at,
                    })
                    .eq("id", inserted.id);
                if (completionError) throw completionError;
            }
        }
        if (replaceProgramId) {
            const { error: deleteError } = await supabase.from("calendar_programs").delete().eq("id", replaceProgramId);
            if (deleteError) throw deleteError;
        }
        return rows;
    }

    async function importResponse() {
        setError("");
        setNotice("");
        setBusy(true);
        try {
            const parsed = extractJsonFromResponse(response);
            const result = validateImportedProgram(parsed);
            if (!result.program) {
                setError(result.error ?? "The plan could not be validated.");
                return;
            }

            const duplicate = programs.find((program) =>
                normalizedProgramName(program.name) === normalizedProgramName(result.program!.name)
                && program.start_date === result.program!.start_date
                && program.mode === result.program!.mode
            );
            if (duplicate) {
                setPendingImport({ program: result.program, duplicate });
                return;
            }
            const rows = await saveImportedProgram(result.program);
            finishImport(result.program, rows);
        } catch (importError) {
            console.error("Calendar import error:", importError);
            setError(importError instanceof Error ? importError.message : "The response was not valid JSON.");
        } finally {
            setBusy(false);
        }
    }

    function finishImport(importedProgram: ImportedCalendarProgram, rows: { session_date: string }[]) {
        setPendingImport(null);
        setResponse("");
        setShowImport(false);
        setNotice(`Imported "${importedProgram.name}" with ${rows.length} calendar session${rows.length === 1 ? "" : "s"}.`);
        if (rows[0]) focusDate(rows[0].session_date);
        void loadPrograms(true);
    }

    async function resolveImportConflict(action: "replace" | "keep" | "cancel") {
        if (!pendingImport) return;
        if (action === "cancel") {
            setPendingImport(null);
            setNotice("Import cancelled.");
            return;
        }
        if (action === "keep") {
            setBusy(true);
            try {
                const rows = await saveImportedProgram(pendingImport.program);
                finishImport(pendingImport.program, rows);
            } catch (importError) {
                setError(importError instanceof Error ? importError.message : "Could not keep both programs.");
            } finally {
                setBusy(false);
            }
            return;
        }
        setBusy(true);
        try {
            const rows = await saveImportedProgram(pendingImport.program, pendingImport.duplicate.id);
            finishImport(pendingImport.program, rows);
        } catch (importError) {
            setError(importError instanceof Error ? importError.message : "Could not replace the existing program.");
        } finally {
            setBusy(false);
        }
    }

    async function updateStatus(session: CalendarSession, status: "planned" | "completed" | "skipped") {
        const notes = session.completion_notes ?? "";
        const { error: updateError } = await supabase.from("calendar_sessions")
            .update({ status, completion_notes: notes, completed_at: status === "completed" ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
            .eq("id", session.id);
        if (updateError) {
            setError("Could not update this session.");
            return;
        }
        setSessions((current) => current.map((item) => item.id === session.id ? { ...item, status, completed_at: status === "completed" ? new Date().toISOString() : null } : item));
    }

    function exportProgram(program: CalendarProgram) {
        const programSessions = sessions
            .filter((session) => session.program_id === program.id)
            .map((session) => ({
                date: session.date,
                mode: session.mode,
                title: session.title,
                details: session.details ?? {},
                status: session.status,
                completion_notes: session.completion_notes,
                completed_at: session.completed_at,
            }));
        const json = JSON.stringify({
            name: program.name,
            mode: program.mode,
            start_date: program.start_date,
            duration_weeks: program.duration_weeks,
            overview: program.overview,
            sessions: programSessions,
        }, null, 2);
        setExportedJson(json);
        downloadJson(json, program.name);
    }

    async function exportProgramForAnalysis(program: CalendarProgram) {
        const programSessions = sessions
            .filter((session) => session.program_id === program.id)
            .map((session) => ({
                date: session.date,
                mode: session.mode,
                title: session.title,
                details: session.details ?? {},
                status: session.status,
                completion_notes: session.completion_notes,
                completed_at: session.completed_at,
            }));
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            setError("Your session has expired. Please sign in again.");
            return;
        }
        const programStart = new Date(`${program.start_date}T00:00:00`);
        const programEnd = new Date(programStart);
        programEnd.setDate(programEnd.getDate() + program.duration_weeks * 7 - 1);
        const { data: workoutData, error: workoutError } = await supabase
            .from("workouts")
            .select("start_time, end_time, title, activity_data, sets(weight_kg, reps, rpe, distance_km, duration_s, set_type, exercises(name))")
            .eq("user_id", user.id)
            .gte("start_time", programStart.toISOString())
            .lte("start_time", `${programEnd.toISOString().slice(0, 10)}T23:59:59`)
            .order("start_time", { ascending: true })
            .limit(500);
        if (workoutError) {
            console.error("Workout evidence export error:", workoutError);
            setError("Could not export workout evidence for analysis.");
            return;
        }
        const json = JSON.stringify({
            type: "hevyload_program_analysis_request",
            instructions: "Analyze the planned program together with the actual workout evidence. Return overall program recommendations, not one suggestion per workout. Explain what the evidence shows (for example RPE/load, heart rate/pace, distance, duration, or missed sessions), why it may affect the expected result or upcoming efforts, and propose a concrete program change. Never claim evidence that is not present. Recommendations are proposals only: the app must ask the user for permission before applying any change.",
            program: {
                name: program.name,
                mode: program.mode,
                start_date: program.start_date,
                duration_weeks: program.duration_weeks,
                overview: program.overview,
                sessions: programSessions,
            },
            workout_evidence: workoutData ?? [],
            response_shape: {
                type: "hevyload_program_analysis",
                summary: "Overall assessment",
                suggestions: [{ "date": null, "title": "Short overall program update", "evidence": "Specific observed workout evidence and its date", "summary": "Explain why the evidence matters and what may happen if the program is unchanged", "priority": "low | medium | high", "changes": { "scope": "program", "sessions": [{ "dates": ["YYYY-MM-DD"], "title": "Optional replacement title", "details": "Concrete proposed calendar changes" }] } }],
            },
        }, null, 2);
        setExportedJson(json);
        downloadJson(json, `${program.name}-analysis`);
        setNotice("Exported the current program and completion data for analysis.");
    }

    function normalizeSuggestion(value: unknown): Omit<CalendarSuggestion, "id" | "program_id" | "created_at"> | null {
        if (!value || typeof value !== "object") return null;
        const raw = value as Record<string, unknown>;
        const title = typeof raw.title === "string" ? raw.title.trim() : "";
        const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
        if (!title || !summary) return null;
        const evidence = typeof raw.evidence === "string" ? raw.evidence.trim() : "No specific workout evidence was provided.";
        const date = raw.date === null || raw.date === undefined ? null : typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.date) ? raw.date : undefined;
        if (date === undefined) return null;
        const priority = raw.priority === "low" || raw.priority === "high" ? raw.priority : "medium";
        return { suggestion_date: date, title, summary, evidence, changes: raw.changes && typeof raw.changes === "object" ? raw.changes as Record<string, unknown> : {}, priority };
    }

    async function importSuggestions() {
        setError("");
        setNotice("");
        setBusy(true);
        try {
            const parsed = extractJsonFromResponse(suggestionResponse) as Record<string, unknown>;
            const rawSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
            const normalized = rawSuggestions.map(normalizeSuggestion).filter((item): item is NonNullable<typeof item> => Boolean(item));
            if (!normalized.length) throw new Error("No valid suggestions were found. Include a suggestions array with title and summary.");
            const program = programs.find((item) => item.id === selectedSessions[0]?.program_id) ?? programs.find((item) => sessions.some((session) => session.program_id === item.id));
            if (!program) throw new Error("Create or import a program before importing suggestions.");
            const { error: deleteError } = await supabase.from("calendar_program_suggestions").delete().eq("program_id", program.id);
            if (deleteError) throw deleteError;
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error("Your session has expired. Please sign in again.");
            const { error: insertError } = await supabase.from("calendar_program_suggestions").insert(normalized.map((suggestion) => ({ ...suggestion, user_id: user.id, program_id: program.id })));
            if (insertError) throw insertError;
            setSuggestionResponse("");
            setShowSuggestionsImport(false);
            setNotice(`Replaced previous suggestions with ${normalized.length} new recommendation${normalized.length === 1 ? "" : "s"}.`);
            await loadPrograms();
        } catch (suggestionError) {
            console.error("Calendar suggestions import error:", suggestionError);
            const databaseError = suggestionError as { code?: string };
            setError(databaseError.code === "42P01" || databaseError.code === "PGRST205"
                ? "Suggestions storage is not available yet. Apply the program suggestions migration first."
                : suggestionError instanceof Error ? suggestionError.message : "Could not import suggestions.");
        } finally {
            setBusy(false);
        }
    }

    async function applySuggestion(suggestion: CalendarSuggestion) {
        const rawSessions = Array.isArray(suggestion.changes.sessions)
            ? suggestion.changes.sessions
            : suggestion.suggestion_date ? [{ dates: [suggestion.suggestion_date], details: suggestion.changes }] : [];
        if (!rawSessions.length) {
            setNotice("This recommendation has no structured calendar changes to apply.");
            return;
        }
        setBusy(true);
        try {
            for (const rawChange of rawSessions) {
                if (!rawChange || typeof rawChange !== "object") continue;
                const change = rawChange as { dates?: unknown; title?: unknown; details?: unknown; mode?: unknown };
                const dates = Array.isArray(change.dates) ? change.dates.filter((date): date is string => typeof date === "string") : [];
                for (const date of dates) {
                    const target = sessions.find((session) => session.program_id === suggestion.program_id && session.date === date);
                    if (!target) continue;
                    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
                    if (typeof change.title === "string" && change.title.trim()) update.title = change.title.trim();
                    if (change.mode === "running" || change.mode === "weight_training" || change.mode === "other" || change.mode === "rest") update.mode = change.mode;
                    if (change.details && typeof change.details === "object") update.details = mergeSuggestedDetails(target.details, change.details as Record<string, unknown>);
                    const { error: updateError } = await supabase.from("calendar_sessions").update(update).eq("id", target.id);
                    if (updateError) throw updateError;
                }
            }
            setNotice(`Applied "${suggestion.title}" to the proposed calendar sessions.`);
            await loadPrograms();
        } catch (applyError) {
            console.error("Calendar suggestion apply error:", applyError);
            setError(applyError instanceof Error ? applyError.message : "Could not apply this program update.");
        } finally {
            setBusy(false);
        }
    }

    function exportAllPrograms() {
        const json = JSON.stringify(programs.map((program) => ({
            name: program.name,
            mode: program.mode,
            start_date: program.start_date,
            duration_weeks: program.duration_weeks,
            overview: program.overview,
            sessions: sessions
                .filter((session) => session.program_id === program.id)
                .map((session) => ({ date: session.date, mode: session.mode, title: session.title, details: session.details ?? {} })),
        })), null, 2);
        setExportedJson(json);
        downloadJson(json, "hevyload-programs");
    }

    function downloadJson(json: string, name: string) {
        if (Platform.OS !== "web" || typeof document === "undefined") return;
        const url = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "hevyload-program"}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    async function copyPrompt() {
        try {
            await Clipboard.setStringAsync(prompt);
            setError("");
            setNotice("Prompt copied to your clipboard.");
        } catch (copyError) {
            console.error("Prompt copy error:", copyError);
            setNotice("");
            setError("Could not copy the prompt.");
        }
    }

    function deleteProgram(program: CalendarProgram) {
        setPendingDeleteId(program.id);
        setNotice(`Confirm deletion of "${program.name}" below.`);
    }

    async function confirmDeleteProgram(program: CalendarProgram) {
        const { error: deleteError } = await supabase.from("calendar_programs").delete().eq("id", program.id);
        if (deleteError) {
            setNotice("");
            setError("Could not delete this program.");
            return;
        }
        setPendingDeleteId(null);
        setExportedJson("");
        setError("");
        setNotice("");
        await loadPrograms();
    }

    function exportChangedSessions() {
        const values = Object.values(changedSessions);
        if (!values.length) {
            setNotice("Edit a session first to create a changed-session prompt.");
            return;
        }

        setPrompt(`Update only these sessions in the existing program. Preserve all other sessions.\n\nReturn the same JSON session shape.\n\n${JSON.stringify(values.map((session) => ({ date: session.date, mode: session.mode, title: session.title, details: session.details })), null, 2)}`);
    }

    function exportChangedSessionsJson() {
        const values = Object.values(changedSessions);
        if (!values.length) {
            setNotice("Edit a session first to export workout changes.");
            return;
        }

        const json = JSON.stringify({
            type: "hevyload_workout_changes",
            instructions: "Apply these updates to the existing calendar sessions. Preserve all other sessions.",
            changes: values.map((session) => ({
                session_id: session.id,
                program_id: session.program_id,
                date: session.date,
                mode: session.mode,
                title: session.title,
                details: session.details ?? {},
            })),
        }, null, 2);
        setExportedJson(json);
        downloadJson(json, "hevyload-workout-changes");
        setNotice(`Exported ${values.length} workout change${values.length === 1 ? "" : "s"} as JSON.`);
    }

    function beginEdit(session: CalendarSession) {
        setEditingSessionId(session.id);
        setEditingTitle(session.title);
        setEditingDetails({ ...session.details });
    }

    async function saveEdit(session: CalendarSession) {
        const title = editingTitle.trim();
        if (!title) {
            setError("An edited session needs a title.");
            return;
        }
        const edited = { ...session, title, details: editingDetails };
        const { error: editError } = await supabase.from("calendar_sessions")
            .update({ title, details: editingDetails, updated_at: new Date().toISOString() })
            .eq("id", session.id);
        if (editError) {
            setError("Could not save this session edit.");
            return;
        }
        setChangedSessions((current) => ({ ...current, [session.id]: edited }));
        setSessions((current) => current.map((item) => item.id === session.id ? edited : item));
        setEditingSessionId(null);
    }

    function cancelEdit() {
        setEditingSessionId(null);
        setEditingTitle("");
        setEditingDetails({});
    }

    function handleBack() {
        if (router.canGoBack()) {
            router.back();
        } else {
            router.replace("/app/dashboard");
        }
    }

    function updateDuration(value: string) {
        const duration = value ? Number(value) : undefined;
        setEditingDetails((current) => ({
            ...current,
            duration_minutes: duration,
            pace: duration && current.distance_km && duration > 0
                ? formatPace((duration * 60) / current.distance_km)
                : current.pace,
        }));
    }

    function updatePace(value: string) {
        const paceSeconds = parsePaceSeconds(value);
        setEditingDetails((current) => ({
            ...current,
            pace: value,
            duration_minutes: paceSeconds && current.distance_km && current.distance_km > 0
                ? Math.round((current.distance_km * paceSeconds) / 60)
                : current.duration_minutes,
        }));
    }

    function shiftMonth(amount: number) {
        const next = new Date(month.getFullYear(), month.getMonth() + amount, 1);
        setMonth(next);
        setSelectedDate(next);
    }

    const calendarCells = useMemo(() => {
        const firstWeekday = startOfMonth(month).getDay();
        const count = getDaysInMonth(month);
        return Array.from({ length: Math.ceil((firstWeekday + count) / 7) * 7 }, (_, index) => {
            const day = index - firstWeekday + 1;
            return day < 1 || day > count ? null : new Date(month.getFullYear(), month.getMonth(), day);
        });
    }, [month]);

    function renderSetup() {
        return (
            <View style={[styles.setupPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.panelHeader}>
                    <View style={styles.setupHeading}>
                        <View style={[styles.setupIcon, { backgroundColor: colors.tint }]}><Ionicons name="sparkles" size={20} color="#fff" /></View>
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.setupTitle, { color: colors.text }]}>Build your training plan</Text>
                            <Text style={[styles.helper, { color: colors.secondaryText }]}>Create a copy-ready prompt tailored to your history and goals.</Text>
                        </View>
                    </View>
                    <Pressable onPress={() => setShowSetup(false)} style={styles.closeButton} accessibilityLabel="Close new prompt">
                        <Ionicons name="close" size={20} color={colors.secondaryText} />
                    </Pressable>
                </View>
                <View style={[styles.privacyNote, { backgroundColor: colors.secondaryBackground }]}><Ionicons name="shield-checkmark-outline" size={16} color={colors.tint} /><Text style={[styles.privacyText, { color: colors.secondaryText }]}>Your workout history is summarized locally. No LLM is called by the app.</Text></View>
                <Text style={[styles.formSectionTitle, { color: colors.text }]}>Training focus</Text>
                <View style={styles.modeRow}>{(["running", "weight_training", "combined", "other"] as CalendarMode[]).map((item) => (
                    <Pressable key={item} onPress={() => setMode(item)} style={[styles.modeButton, { borderColor: mode === item ? colors.tint : colors.border, backgroundColor: mode === item ? colors.tint : colors.background }]}>
                        <Ionicons name={item === "running" ? "walk-outline" : item === "weight_training" ? "barbell-outline" : item === "combined" ? "layers-outline" : "ellipsis-horizontal"} size={16} color={mode === item ? "#fff" : colors.secondaryText} />
                        <Text style={{ color: mode === item ? "#fff" : colors.text, fontSize: 12, fontWeight: "700" }}>{formatModeLabel(item)}</Text>
                    </Pressable>
                ))}</View>
                <Text style={[styles.formSectionTitle, { color: colors.text }]}>Plan details</Text>
                <View style={styles.formGrid}>
                    {[
                        ["Goal", goal, setGoal, "e.g. Build endurance and strength"],
                        ["Start date", startDate, setStartDate, "YYYY-MM-DD"],
                        ["Duration (weeks)", durationWeeks, setDurationWeeks, "e.g. 8"],
                        ["Days available", daysAvailable, setDaysAvailable, "e.g. Mon, Wed, Sat"],
                    ].map(([label, value, setter, placeholder]) => (
                        <View key={String(label)} style={styles.formField}><Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>{String(label)}</Text><TextInput placeholder={String(placeholder)} placeholderTextColor={colors.secondaryText} value={String(value)} onChangeText={setter as (value: string) => void} style={[styles.input, { color: colors.text, borderColor: colors.border }]} /></View>
                    ))}
                </View>
                <Text style={[styles.formSectionTitle, { color: colors.text }]}>Personalize it <Text style={{ color: colors.secondaryText, fontWeight: "500" }}>(optional)</Text></Text>
                <View style={styles.formGrid}>
                    {[
                        ["Equipment / access", equipment, setEquipment, "e.g. Full gym, home weights"],
                        ["Limitations", limitations, setLimitations, "e.g. Knee pain, busy days"],
                        ["Preferences", preferences, setPreferences, "e.g. Short sessions, trails"],
                        ["History lookback (days)", lookbackDays, setLookbackDays, "e.g. 84"],
                    ].map(([label, value, setter, placeholder]) => (
                        <View key={String(label)} style={styles.formField}><Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>{String(label)}</Text><TextInput placeholder={String(placeholder)} placeholderTextColor={colors.secondaryText} value={String(value)} onChangeText={setter as (value: string) => void} style={[styles.input, { color: colors.text, borderColor: colors.border }]} /></View>
                    ))}
                </View>
                <Pressable style={[styles.buildButton, { backgroundColor: colors.tint }]} onPress={createPrompt} disabled={busy}><Ionicons name="sparkles-outline" size={18} color="#fff" /><Text style={styles.primaryText}>{busy ? "Building your prompt..." : "Build prompt"}</Text><Ionicons name="arrow-forward" size={18} color="#fff" /></Pressable>
            </View>
        );
    }

    function renderSession(session: DisplaySession) {
        const details = session.details ?? {};
        const isEditing = editingSessionId === session.id;
        const exercises = details.exercises ?? [];
        const sessionIcon = session.mode === "running"
            ? "walk-outline"
            : session.mode === "weight_training"
                ? "barbell-outline"
                : "fitness-outline";
        return (
            <View key={session.id} style={[styles.sessionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={styles.sessionHeader}>
                    <View style={[styles.sessionIcon, { backgroundColor: session.status === "completed" ? colors.success : colors.tint }]}>
                        <Ionicons name={sessionIcon} size={19} color="#fff" />
                    </View>
                    <View style={{ flex: 1 }}>
                        {isEditing ? (
                            <TextInput value={editingTitle} onChangeText={setEditingTitle} autoFocus style={[styles.editInput, { color: colors.text, borderColor: colors.border }]} />
                        ) : <Text style={[styles.sessionTitle, { color: colors.text }]}>{session.title}</Text>}
                        <Text style={[styles.meta, { color: colors.secondaryText }]}>{formatModeLabel(session.mode)} · {session.status}{session.program_name ? ` · ${session.program_name}` : ""}</Text>
                    </View>
                    <Ionicons name={session.status === "completed" ? "checkmark-circle" : "ellipse-outline"} size={24} color={session.status === "completed" ? colors.success : colors.secondaryText} />
                </View>
                {isEditing ? (
                    <View style={styles.editFields}>
                        <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Distance (km)</Text>
                        <TextInput value={String(editingDetails.distance_km ?? "")} onChangeText={(value) => setEditingDetails((current) => ({ ...current, distance_km: value ? Number(value) : undefined }))} keyboardType="decimal-pad" style={[styles.editInput, { color: colors.text, borderColor: colors.border }]} />
                        <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Duration (minutes)</Text>
                        <TextInput value={String(editingDetails.duration_minutes ?? "")} onChangeText={updateDuration} keyboardType="numeric" style={[styles.editInput, { color: colors.text, borderColor: colors.border }]} />
                        <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Pace or effort</Text>
                        <TextInput value={editingDetails.pace ?? ""} onChangeText={updatePace} style={[styles.editInput, { color: colors.text, borderColor: colors.border }]} />
                        <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Warm-up</Text>
                        <TextInput value={editingDetails.warmup ?? ""} onChangeText={(value) => setEditingDetails((current) => ({ ...current, warmup: value }))} style={[styles.editInput, { color: colors.text, borderColor: colors.border }]} />
                        <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Cool-down</Text>
                        <TextInput value={editingDetails.cooldown ?? ""} onChangeText={(value) => setEditingDetails((current) => ({ ...current, cooldown: value }))} style={[styles.editInput, { color: colors.text, borderColor: colors.border }]} />
                        <Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Notes</Text>
                        <TextInput value={editingDetails.notes ?? ""} onChangeText={(value) => setEditingDetails((current) => ({ ...current, notes: value }))} multiline style={[styles.editInput, styles.notesInput, { color: colors.text, borderColor: colors.border }]} />
                        {editingDetails.exercises?.map((exercise, index) => <View key={`${exercise.name}-${index}`} style={styles.exerciseEditRow}><Text style={[styles.exerciseEditName, { color: colors.text }]}>{exercise.name}</Text><View style={styles.exerciseField}><Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Sets</Text><TextInput value={String(exercise.sets ?? "")} onChangeText={(value) => setEditingDetails((current) => ({ ...current, exercises: current.exercises?.map((item, itemIndex) => itemIndex === index ? { ...item, sets: value ? Number(value) : undefined } : item) }))} keyboardType="numeric" style={[styles.smallEditInput, { color: colors.text, borderColor: colors.border }]} /></View><View style={styles.exerciseField}><Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Reps</Text><TextInput value={exercise.reps ?? ""} onChangeText={(value) => setEditingDetails((current) => ({ ...current, exercises: current.exercises?.map((item, itemIndex) => itemIndex === index ? { ...item, reps: value } : item) }))} style={[styles.smallEditInput, { color: colors.text, borderColor: colors.border }]} /></View><View style={styles.exerciseField}><Text style={[styles.fieldLabel, { color: colors.secondaryText }]}>Load / RPE</Text><TextInput value={exercise.load ?? ""} onChangeText={(value) => setEditingDetails((current) => ({ ...current, exercises: current.exercises?.map((item, itemIndex) => itemIndex === index ? { ...item, load: value } : item) }))} style={[styles.smallEditInput, { color: colors.text, borderColor: colors.border }]} /></View></View>)}
                    </View>
                ) : (
                    <>
                        {details.distance_km || details.duration_minutes || details.pace ? (
                            <View style={[styles.activitySummary, { backgroundColor: colors.secondaryBackground }]}>
                                <Ionicons name={session.mode === "running" ? "speedometer-outline" : "timer-outline"} size={17} color={colors.tint} />
                                <Text style={[styles.activitySummaryText, { color: colors.text }]}>
                                    {details.distance_km ? `${details.distance_km} km` : ""}
                                    {details.duration_minutes ? `${details.distance_km ? " · " : ""}${details.duration_minutes} min` : ""}
                                    {details.pace ? ` · ${details.pace}` : ""}
                                </Text>
                            </View>
                        ) : null}
                        {exercises.length ? (
                            <View style={styles.exerciseList}>
                                <View style={styles.exerciseListHeader}>
                                    <Text style={[styles.exerciseListTitle, { color: colors.text }]}>Exercises</Text>
                                    <Text style={[styles.exerciseCount, { color: colors.secondaryText }]}>{exercises.length} movement{exercises.length === 1 ? "" : "s"}</Text>
                                </View>
                                {exercises.map((exercise, index) => (
                                    <View key={`${exercise.name}-${index}`} style={[styles.exerciseCard, { backgroundColor: colors.secondaryBackground, borderColor: colors.border }]}>
                                        <View style={[styles.exerciseNumber, { backgroundColor: colors.tint + "1A" }]}>
                                            <Text style={[styles.exerciseNumberText, { color: colors.tint }]}>{String(index + 1).padStart(2, "0")}</Text>
                                        </View>
                                        <View style={styles.exerciseCopy}>
                                            <Text style={[styles.exerciseName, { color: colors.text }]}>{exercise.name}</Text>
                                            <View style={styles.prescriptionRow}>
                                                <View style={[styles.prescriptionPill, { backgroundColor: colors.card }]}>
                                                    <Text style={[styles.prescriptionText, { color: colors.text }]}>{exercise.sets ?? "-"} sets</Text>
                                                </View>
                                                <View style={[styles.prescriptionPill, { backgroundColor: colors.card }]}>
                                                    <Text style={[styles.prescriptionText, { color: colors.text }]}>{exercise.reps ?? "-"} reps</Text>
                                                </View>
                                                {exercise.rpe !== undefined ? (
                                                    <View style={[styles.prescriptionPill, { backgroundColor: colors.card }]}>
                                                        <Text style={[styles.prescriptionText, { color: colors.secondaryText }]}>RPE {exercise.rpe}</Text>
                                                    </View>
                                                ) : null}
                                            </View>
                                        </View>
                                        <View style={styles.loadBlock}>
                                            <Text style={[styles.loadLabel, { color: colors.secondaryText }]}>LOAD</Text>
                                            <Text style={[styles.loadValue, { color: colors.tint }]}>{exercise.load || "—"}</Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        {details.warmup ? <Text style={[styles.detail, { color: colors.secondaryText }]}>Warm-up: {details.warmup}</Text> : null}
                        {details.cooldown ? <Text style={[styles.detail, { color: colors.secondaryText }]}>Cool-down: {details.cooldown}</Text> : null}
                        {details.notes ? <Text style={[styles.detail, { color: colors.secondaryText }]}>Notes: {details.notes}</Text> : null}
                    </>
                )}
                <View style={styles.actionRow}>
                    <Pressable onPress={() => updateStatus(session, session.status === "completed" ? "planned" : "completed")}><Text style={{ color: colors.success, fontWeight: "700" }}>{session.status === "completed" ? "Completed" : "Complete"}</Text></Pressable>
                    <Pressable onPress={() => updateStatus(session, "skipped")}><Text style={{ color: colors.error, fontWeight: "700" }}>Skip</Text></Pressable>
                    {isEditing
                        ? <><Pressable onPress={() => saveEdit(session)}><Text style={{ color: colors.tint, fontWeight: "700" }}>Save edit</Text></Pressable><Pressable onPress={cancelEdit}><Text style={{ color: colors.secondaryText, fontWeight: "700" }}>Cancel</Text></Pressable></>
                        : <Pressable onPress={() => beginEdit(session)}><Text style={{ color: colors.tint, fontWeight: "700" }}>Edit</Text></Pressable>}
                </View>
            </View>
        );
    }

    return (
        <ScrollView style={[styles.container, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
            <View style={[styles.header, { paddingTop: insets.top + 10, borderBottomColor: colors.border }]}>
                <Pressable onPress={handleBack} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={28} color={colors.text} /></Pressable>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Program Calendar</Text>
                <View style={{ width: 28 }} />
            </View>
            <View style={styles.content}>
                {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
                {notice ? <Text style={[styles.notice, { color: colors.text, backgroundColor: colors.secondaryBackground, borderColor: colors.border }]}>{notice}</Text> : null}
                <View style={styles.buttonRow}>
                    <Pressable style={[styles.primaryButton, { backgroundColor: colors.tint }]} onPress={() => setShowSetup((value) => !value)}><Text style={styles.primaryText}>New prompt</Text></Pressable>
                    <Pressable style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={() => setShowImport((value) => !value)}><Text style={{ color: colors.text }}>Import JSON</Text></Pressable>
                    {programs.length ? <Pressable style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={exportAllPrograms}><Text style={{ color: colors.text }}>Export JSON</Text></Pressable> : null}
                    {activeProgram ? <Pressable style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={() => exportProgramForAnalysis(activeProgram)}><Ionicons name="analytics-outline" size={15} color={colors.tint} /><Text style={{ color: colors.text }}>Export for analysis</Text></Pressable> : null}
                    {activeProgram ? <Pressable style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={() => setShowSuggestionsImport((value) => !value)}><Ionicons name="bulb-outline" size={15} color={colors.tint} /><Text style={{ color: colors.text }}>Import suggestions</Text></Pressable> : null}
                    <Pressable style={[styles.helpButton, { borderColor: colors.border, backgroundColor: colors.secondaryBackground }]} onPress={() => setShowHelp((value) => !value)} accessibilityLabel="Explain Program Calendar"><Ionicons name="help" size={16} color={colors.tint} /></Pressable>
                    {Object.keys(changedSessions).length ? (
                        <>
                            <Pressable style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={exportChangedSessionsJson}>
                                <Ionicons name="download-outline" size={15} color={colors.tint} />
                                <Text style={{ color: colors.text }}>Export changes JSON</Text>
                            </Pressable>
                            <Pressable style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={exportChangedSessions}>
                                <Text style={{ color: colors.text }}>Create edit prompt</Text>
                            </Pressable>
                        </>
                    ) : null}
                </View>
                {showHelp ? <View style={[styles.helpPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.text }]}>How Program Calendar works</Text><Pressable onPress={() => setShowHelp(false)} accessibilityLabel="Close help"><Ionicons name="close" size={20} color={colors.secondaryText} /></Pressable></View>
                    <Text style={[styles.helpIntro, { color: colors.secondaryText }]}>Build a plan with an external AI tool, import it here, and track your training over time. Your workout history is summarized locally; this app does not call an AI service.</Text>
                    <View style={styles.helpStep}><View style={[styles.helpStepNumber, { backgroundColor: colors.tint }]}><Text style={styles.helpStepNumberText}>1</Text></View><View style={styles.helpCopy}><Text style={[styles.helpTitle, { color: colors.text }]}>Create a prompt</Text><Text style={[styles.helpBody, { color: colors.secondaryText }]}>Choose a training focus and add your goal, schedule, equipment, limitations, and preferences.</Text></View></View>
                    <View style={styles.helpStep}><View style={[styles.helpStepNumber, { backgroundColor: colors.tint }]}><Text style={styles.helpStepNumberText}>2</Text></View><View style={styles.helpCopy}><Text style={[styles.helpTitle, { color: colors.text }]}>Use an external LLM</Text><Text style={[styles.helpBody, { color: colors.secondaryText }]}>Copy the generated prompt into ChatGPT, Claude, or another tool. Ask it to return the requested JSON format.</Text></View></View>
                    <View style={styles.helpStep}><View style={[styles.helpStepNumber, { backgroundColor: colors.tint }]}><Text style={styles.helpStepNumberText}>3</Text></View><View style={styles.helpCopy}><Text style={[styles.helpTitle, { color: colors.text }]}>Import the plan</Text><Text style={[styles.helpBody, { color: colors.secondaryText }]}>Paste the JSON, choose a file, or drag one into the importer. Similar plans trigger a choice to replace, keep both, or cancel.</Text></View></View>
                    <View style={styles.helpStep}><View style={[styles.helpStepNumber, { backgroundColor: colors.tint }]}><Text style={styles.helpStepNumberText}>4</Text></View><View style={styles.helpCopy}><Text style={[styles.helpTitle, { color: colors.text }]}>Track and adjust</Text><Text style={[styles.helpBody, { color: colors.secondaryText }]}>Select a day to view sessions, mark workouts complete, edit details, and keep completion history when replacing a similar plan.</Text></View></View>
                    <Text style={[styles.helpFooter, { color: colors.secondaryText }]}>You can run Running, Weight Training, Combined, and Other programs at the same time. Export JSON anytime to keep a backup.</Text>
                </View> : null}
                {showSetup ? renderSetup() : null}
                {showImport ? <View id="program-calendar-import-dropzone" style={[styles.panel, { backgroundColor: colors.card, borderColor: draggingFile ? colors.tint : colors.border }]}><View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.text }]}>Import a program</Text><Pressable onPress={() => setShowImport(false)} style={styles.closeButton} accessibilityLabel="Close import"><Ionicons name="close" size={20} color={colors.secondaryText} /></Pressable></View><Text style={[styles.helper, { color: colors.secondaryText }]}>Drop a JSON file here, or choose one from your device. You can also paste JSON below.</Text><Pressable style={[styles.secondaryButton, { borderColor: colors.border }]} onPress={chooseImportFile}><Text style={{ color: colors.text }}>Choose JSON file</Text></Pressable><TextInput multiline value={response} onChangeText={setResponse} placeholder="Paste JSON here..." placeholderTextColor={colors.secondaryText} style={[styles.largeInput, { color: colors.text, borderColor: colors.border }]} /><Pressable style={[styles.primaryButton, { backgroundColor: colors.tint }]} onPress={importResponse}><Text style={styles.primaryText}>{busy ? "Importing..." : "Import plan"}</Text></Pressable></View> : null}
                {showSuggestionsImport ? <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.text }]}>Import workout suggestions</Text><Pressable onPress={() => setShowSuggestionsImport(false)} style={styles.closeButton} accessibilityLabel="Close suggestions import"><Ionicons name="close" size={20} color={colors.secondaryText} /></Pressable></View><Text style={[styles.helper, { color: colors.secondaryText }]}>Paste the analysis JSON returned by your AI tool. New suggestions replace the previous suggestions for {activeProgram?.name ?? "the active program"}.</Text><TextInput multiline value={suggestionResponse} onChangeText={setSuggestionResponse} placeholder="Paste analysis JSON here..." placeholderTextColor={colors.secondaryText} style={[styles.largeInput, { color: colors.text, borderColor: colors.border }]} /><Pressable style={[styles.primaryButton, { backgroundColor: colors.tint }]} onPress={importSuggestions}><Text style={styles.primaryText}>{busy ? "Replacing suggestions..." : "Replace suggestions"}</Text></Pressable></View> : null}
                {pendingImport ? <View style={[styles.conflictPanel, { backgroundColor: colors.card, borderColor: colors.tint }]}><Text style={[styles.panelTitle, { color: colors.text }]}>Similar program already exists</Text><Text style={[styles.helper, { color: colors.secondaryText }]}>&quot;{pendingImport.duplicate.name}&quot; starts on {pendingImport.duplicate.start_date}. What would you like to do with &quot;{pendingImport.program.name}&quot;?</Text><View style={styles.actionRow}><Pressable onPress={() => resolveImportConflict("replace")} disabled={busy}><Text style={{ color: colors.error, fontWeight: "800" }}>Replace current</Text></Pressable><Pressable onPress={() => resolveImportConflict("keep")} disabled={busy}><Text style={{ color: colors.tint, fontWeight: "800" }}>Keep both</Text></Pressable><Pressable onPress={() => resolveImportConflict("cancel")} disabled={busy}><Text style={{ color: colors.secondaryText, fontWeight: "700" }}>Cancel</Text></Pressable></View></View> : null}
                {prompt ? <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.text }]}>Copy-ready prompt</Text><View style={styles.panelActions}><Pressable onPress={copyPrompt} style={[styles.secondaryButton, { borderColor: colors.border }]} accessibilityLabel="Copy prompt"><Text style={{ color: colors.text }}>Copy</Text></Pressable><Pressable onPress={() => setPrompt("")} style={styles.closeButton} accessibilityLabel="Close prompt"><Ionicons name="close" size={20} color={colors.secondaryText} /></Pressable></View></View><TextInput multiline editable={false} selectTextOnFocus value={prompt} style={[styles.largeInput, { color: colors.text, borderColor: colors.border }]} /></View> : null}
                {exportedJson ? <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={styles.panelHeader}><Text style={[styles.panelTitle, { color: colors.text }]}>Exported JSON</Text><Pressable onPress={() => setExportedJson("")} style={styles.closeButton} accessibilityLabel="Close exported JSON"><Ionicons name="close" size={20} color={colors.secondaryText} /></Pressable></View><Text style={[styles.helper, { color: colors.secondaryText }]}>Select and copy this JSON to save or reuse the plan.</Text><TextInput multiline editable={false} selectTextOnFocus value={exportedJson} style={[styles.exportInput, { color: colors.text, borderColor: colors.border }]} /></View> : null}
                {loading ? <ActivityIndicator color={colors.tint} /> : null}
                <View style={[styles.calendarCard, { backgroundColor: colors.secondaryBackground, borderColor: colors.border }]}>
                    <View style={styles.monthHeader}><Pressable style={[styles.monthButton, { backgroundColor: colors.secondary }]} onPress={() => shiftMonth(-1)}><Ionicons name="chevron-back" size={20} color={colors.text} /></Pressable><Text style={[styles.monthTitle, { color: colors.text }]}>{format(month, "MMMM yyyy")}</Text><Pressable style={[styles.monthButton, { backgroundColor: colors.secondary }]} onPress={() => shiftMonth(1)}><Ionicons name="chevron-forward" size={20} color={colors.text} /></Pressable></View>
                    <View style={styles.weekdayRow}>{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <Text key={`${day}-${index}`} style={[styles.weekday, { color: colors.secondaryText }]}>{day}</Text>)}</View>
                    <View style={styles.calendarGrid}>{calendarCells.map((date, index) => {
                    if (!date) return <View key={`empty-${index}`} style={styles.dayCell} />;
                    const daySessions = sessionForDate(sessions, date);
                    const selected = getLocalYYYYMMDD(date) === getLocalYYYYMMDD(selectedDate);
                    return <Pressable key={getLocalYYYYMMDD(date)} onPress={() => setSelectedDate(date)} style={[styles.dayCell, { backgroundColor: selected ? colors.tint : "transparent" }]}><Text style={[styles.dayNumber, { color: selected ? "#fff" : colors.text }]}>{date.getDate()}</Text>{daySessions.slice(0, 2).map((session) => <View key={session.id} style={[styles.dot, { backgroundColor: selected ? "#fff" : session.status === "completed" ? colors.success : session.mode === "running" ? "#A855F7" : colors.tint }]} />)}</Pressable>;
                    })}</View>
                    <View style={styles.legend}><View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: "#A855F7" }]} /><Text style={[styles.legendText, { color: colors.secondaryText }]}>Running</Text></View><View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.tint }]} /><Text style={[styles.legendText, { color: colors.secondaryText }]}>Strength</Text></View><View style={styles.legendItem}><View style={[styles.legendDot, { backgroundColor: colors.success }]} /><Text style={[styles.legendText, { color: colors.secondaryText }]}>Complete</Text></View></View>
                </View>
                <Text style={[styles.sectionLabel, { color: colors.accentText }]}>Selected day</Text>
                <Text style={[styles.selectedDate, { color: colors.text }]}>{format(selectedDate, "EEEE, MMMM d")}</Text>
                {selectedSuggestions.length ? <View style={styles.suggestionsPanel}><View style={styles.overviewHeader}><Ionicons name="bulb-outline" size={20} color={colors.tint} /><Text style={[styles.overviewTitle, { color: colors.text }]}>Suggested workout changes</Text></View>{selectedSuggestions.map((suggestion) => { const target = selectedSessions.find((session) => session.program_id === suggestion.program_id); const rawChanges = Array.isArray(suggestion.changes.sessions) ? suggestion.changes.sessions : [{ details: suggestion.changes }]; const changeLines = rawChanges.flatMap((change) => change && typeof change === "object" ? formatSuggestedDetails(change as Record<string, unknown>, target) : []); return <View key={suggestion.id} style={styles.suggestionItem}><Text style={[styles.suggestionTitle, { color: colors.text }]}>{suggestion.title} · {suggestion.priority}</Text><Text style={[styles.suggestionLabel, { color: colors.secondaryText }]}>Evidence</Text><Text style={[styles.detail, { color: colors.secondaryText }]}>{suggestion.evidence}</Text><Text style={[styles.suggestionLabel, { color: colors.secondaryText }]}>Why it matters</Text><Text style={[styles.detail, { color: colors.secondaryText }]}>{suggestion.summary}</Text>{changeLines.map((line, index) => <Text key={`${suggestion.id}-selected-change-${index}`} style={[styles.changeLine, { color: colors.tint }]}>• {line}</Text>)}<Pressable style={[styles.secondaryButton, { borderColor: colors.tint }]} onPress={() => applySuggestion(suggestion)}><Text style={{ color: colors.tint, fontWeight: "800" }}>Approve and apply change</Text></Pressable></View>; })}</View> : null}
                {selectedSessions.length ? selectedSessions.map(renderSession) : <Text style={[styles.empty, { color: colors.secondaryText }]}>No planned sessions on this date.</Text>}
                <View style={styles.programsSection}>
                    <Text style={[styles.sectionLabel, { color: colors.accentText }]}>Program details</Text>
                    {programs.map((program) => <View key={program.id} style={styles.programSection}><View style={[styles.programSummary, { backgroundColor: colors.card, borderColor: colors.border }]}><View style={[styles.programIcon, { backgroundColor: program.mode === "running" ? "#A855F7" : colors.tint }]}><Ionicons name={program.mode === "running" ? "walk" : program.mode === "weight_training" ? "barbell" : program.mode === "other" ? "ellipsis-horizontal" : "layers"} size={22} color="#fff" /></View><View style={{ flex: 1 }}><Text style={[styles.programName, { color: colors.text }]}>{program.name}</Text><Text style={[styles.programDescription, { color: colors.secondaryText }]}>{formatModeLabel(program.mode)} · {program.duration_weeks} weeks · starts {program.start_date}</Text></View><View style={styles.programActions}><Pressable accessibilityLabel={`Export ${program.name} as JSON`} onPress={() => exportProgram(program)}><Ionicons name="download-outline" size={20} color={colors.tint} /></Pressable><Pressable accessibilityLabel={`Export ${program.name} for analysis`} onPress={() => exportProgramForAnalysis(program)}><Ionicons name="analytics-outline" size={20} color={colors.tint} /></Pressable><Pressable accessibilityLabel={`Delete ${program.name}`} onPress={() => deleteProgram(program)}><Ionicons name="trash-outline" size={20} color={colors.error} /></Pressable></View></View>{pendingDeleteId === program.id ? <View style={[styles.deleteConfirm, { backgroundColor: colors.card, borderColor: colors.error }]}><Text style={[styles.deleteText, { color: colors.text }]}>Delete this program and all its sessions?</Text><View style={styles.actionRow}><Pressable onPress={() => confirmDeleteProgram(program)}><Text style={{ color: colors.error, fontWeight: "800" }}>Delete permanently</Text></Pressable><Pressable onPress={() => setPendingDeleteId(null)}><Text style={{ color: colors.secondaryText, fontWeight: "700" }}>Cancel</Text></Pressable></View></View> : null}<ProgramOverview program={program} sessions={sessions.filter((session) => session.program_id === program.id)} colors={colors} suggestions={suggestions.filter((suggestion) => suggestion.program_id === program.id)} onApplySuggestion={applySuggestion} /></View>)}
                </View>
            </View>
        </ScrollView>
    );
}

function ProgramOverview({ program, sessions, colors, suggestions, onApplySuggestion }: { program: CalendarProgram; sessions: CalendarSession[]; colors: ReturnType<typeof useThemeColor>; suggestions: CalendarSuggestion[]; onApplySuggestion: (suggestion: CalendarSuggestion) => void }) {
    const overview = program.overview;
    const activeSessions = sessions.filter((session) => session.mode !== "rest");
    const averageSessionsPerWeek = Math.round((activeSessions.length / program.duration_weeks) * 10) / 10;
    const promptGoal = program.source_prompt.match(/- Goal:\s*(.+)/)?.[1]?.trim();
    const firstSession = sessions[0]?.date;
    const lastSession = sessions[sessions.length - 1]?.date;
    const items = [
        ["Objective", overview?.objective ?? promptGoal ?? "Not included in this imported plan."],
        ["Target outcome", overview?.target_outcome],
        ["Weekly structure", overview?.weekly_structure ?? `${averageSessionsPerWeek} active sessions per week across ${program.duration_weeks} weeks.`],
        ["Progression", overview?.progression],
        ["Intensity guidance", overview?.intensity_guidance],
        ["Recovery", overview?.recovery_guidance],
        ["Equipment", overview?.equipment],
        ["Plan window", firstSession && lastSession ? `${firstSession} to ${lastSession}` : `${program.start_date} · ${program.duration_weeks} weeks`],
        ["Planned sessions", `${activeSessions.length} active sessions${sessions.length > activeSessions.length ? ` · ${sessions.length - activeSessions.length} recovery days` : ""}`],
        ["Notes", overview?.notes],
    ].filter((item): item is [string, string] => typeof item[1] === "string" && item[1].trim().length > 0);
    return (
        <View style={[styles.overviewCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.overviewHeader}><Ionicons name="information-circle-outline" size={20} color={colors.tint} /><Text style={[styles.overviewTitle, { color: colors.text }]}>Program overview</Text></View>
            {items.map(([label, value]) => <View key={label} style={styles.overviewItem}><Text style={[styles.overviewLabel, { color: colors.secondaryText }]}>{label}</Text><Text style={[styles.overviewValue, { color: colors.text }]}>{value}</Text></View>)}
            {overview?.success_metrics?.length ? <View style={styles.overviewItem}><Text style={[styles.overviewLabel, { color: colors.secondaryText }]}>Success metrics</Text>{overview.success_metrics.map((metric) => <Text key={metric} style={[styles.metric, { color: colors.text }]}>• {metric}</Text>)}</View> : null}
            {suggestions.filter((suggestion) => suggestion.suggestion_date === null && getSuggestionDates(suggestion.changes).length === 0).length ? <View style={styles.suggestionsPanel}><View style={styles.overviewHeader}><Ionicons name="bulb-outline" size={20} color={colors.tint} /><Text style={[styles.overviewTitle, { color: colors.text }]}>Program updates</Text></View>{suggestions.filter((suggestion) => suggestion.suggestion_date === null && getSuggestionDates(suggestion.changes).length === 0).map((suggestion) => { const changeLines = formatSuggestionChanges(suggestion.changes); return <View key={suggestion.id} style={styles.suggestionItem}><Text style={[styles.suggestionTitle, { color: colors.text }]}>{suggestion.title} · {suggestion.priority}</Text><Text style={[styles.suggestionLabel, { color: colors.secondaryText }]}>Evidence</Text><Text style={[styles.detail, { color: colors.secondaryText }]}>{suggestion.evidence}</Text><Text style={[styles.suggestionLabel, { color: colors.secondaryText }]}>Why it matters</Text><Text style={[styles.detail, { color: colors.secondaryText }]}>{suggestion.summary}</Text>{changeLines.length ? <View><Text style={[styles.suggestionLabel, { color: colors.secondaryText }]}>Proposed calendar change</Text>{changeLines.map((line, index) => <Text key={`${suggestion.id}-change-${index}`} style={[styles.changeLine, { color: colors.tint }]}>• {line}</Text>)}</View> : null}<Pressable style={[styles.secondaryButton, { borderColor: colors.tint }]} onPress={() => onApplySuggestion(suggestion)}><Text style={{ color: colors.tint, fontWeight: "800" }}>Approve and apply change</Text></Pressable></View>; })}</View> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
    headerTitle: { fontSize: 19, fontWeight: "800" },
    content: { width: "100%", maxWidth: 1120, alignSelf: "center", paddingHorizontal: 24, paddingTop: 16, gap: 14 },
    error: { fontWeight: "600" },
    notice: { fontWeight: "600", textAlign: "center", padding: 12, borderRadius: 10, borderWidth: 1 },
    buttonRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    helpButton: { width: 40, minHeight: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
    primaryButton: { paddingHorizontal: 14, paddingVertical: 11, borderRadius: 10, alignItems: "center" },
    primaryText: { color: "#fff", fontWeight: "800" },
    buildButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 12, marginTop: 2 },
    secondaryButton: { flexDirection: "row", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, borderWidth: 1, alignItems: "center" },
    panel: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
    suggestionsPanel: { padding: 14, borderRadius: 14, borderWidth: 1, gap: 10 },
    suggestionItem: { gap: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#00000012" },
    suggestionTitle: { fontWeight: "800", textTransform: "capitalize" },
    suggestionLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", marginTop: 5 },
    changeLine: { lineHeight: 19, marginTop: 2 },
    setupPanel: { padding: 20, borderRadius: 20, borderWidth: 1, gap: 16 },
    setupHeading: { flexDirection: "row", alignItems: "center", gap: 12 },
    setupIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    setupTitle: { fontSize: 20, fontWeight: "800", marginBottom: 3 },
    privacyNote: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10 },
    privacyText: { flex: 1, fontSize: 12, lineHeight: 17 },
    formSectionTitle: { fontSize: 13, fontWeight: "800", marginTop: 2 },
    formGrid: { gap: 10 },
    formField: { gap: 5 },
    panelHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    panelActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    closeButton: { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    helpPanel: { padding: 18, borderRadius: 16, borderWidth: 1, gap: 14 },
    helpIntro: { lineHeight: 20 },
    helpStep: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    helpStepNumber: { width: 25, height: 25, borderRadius: 13, alignItems: "center", justifyContent: "center" },
    helpStepNumberText: { color: "#fff", fontWeight: "800", fontSize: 12 },
    helpCopy: { flex: 1, gap: 3 },
    helpTitle: { fontWeight: "800", fontSize: 14 },
    helpBody: { lineHeight: 19 },
    helpFooter: { lineHeight: 19, paddingTop: 2 },
    panelTitle: { fontSize: 17, fontWeight: "800" },
    helper: { lineHeight: 19 },
    modeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
    modeButton: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
    input: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 42 },
    largeInput: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 150, textAlignVertical: "top" },
    exportInput: { borderWidth: 1, borderRadius: 8, padding: 10, minHeight: 260, textAlignVertical: "top", fontFamily: "monospace", fontSize: 12 },
    programPicker: { flexGrow: 0 },
    programChip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 18, marginRight: 8 },
    programSummary: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: 16, borderWidth: 1 },
    programSection: { gap: 10 },
    programsSection: { gap: 12, marginTop: 10 },
    programIcon: { width: 44, height: 44, borderRadius: 13, justifyContent: "center", alignItems: "center" },
    programName: { fontSize: 16, fontWeight: "800", marginBottom: 4 },
    programActions: { flexDirection: "row", alignItems: "center", gap: 14, paddingLeft: 8 },
    deleteConfirm: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
    conflictPanel: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 },
    deleteText: { fontWeight: "700" },
    programDescription: { textTransform: "capitalize" },
    overviewCard: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12 },
    overviewHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
    overviewTitle: { fontSize: 16, fontWeight: "800" },
    overviewItem: { gap: 3 },
    overviewLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.8 },
    overviewValue: { fontSize: 14, lineHeight: 20 },
    metric: { fontSize: 14, lineHeight: 21 },
    calendarCard: { borderRadius: 18, borderWidth: 1, padding: 16 },
    monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 14 },
    monthButton: { width: 34, height: 34, borderRadius: 10, justifyContent: "center", alignItems: "center" },
    monthTitle: { fontSize: 18, fontWeight: "800" },
    weekdayRow: { flexDirection: "row", marginBottom: 6 },
    weekday: { width: "14.2857%", textAlign: "center", fontSize: 10, fontWeight: "800", letterSpacing: 1 },
    calendarGrid: { flexDirection: "row", flexWrap: "wrap" },
    dayCell: { width: "14.2857%", height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center", gap: 3 },
    dayNumber: { fontSize: 14, fontWeight: "700", lineHeight: 18 },
    dot: { width: 6, height: 6, borderRadius: 4 },
    legend: { flexDirection: "row", gap: 14, paddingTop: 12, paddingHorizontal: 4 },
    legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendDot: { width: 7, height: 7, borderRadius: 4 },
    legendText: { fontSize: 11 },
    sectionLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 1, marginTop: 4 },
    selectedDate: { fontSize: 20, fontWeight: "800", marginTop: -8 },
    sessionCard: { padding: 18, borderRadius: 18, borderWidth: 1, gap: 8 },
    sessionHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
    sessionIcon: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    sessionTitle: { fontSize: 16, fontWeight: "800" },
    editInput: { borderWidth: 1, borderRadius: 8, padding: 8, fontSize: 16, fontWeight: "700" },
    editFields: { gap: 8 },
    fieldLabel: { fontSize: 11, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginTop: 3 },
    notesInput: { minHeight: 72, textAlignVertical: "top" },
    exerciseEditRow: { flexDirection: "row", alignItems: "flex-end", gap: 6, flexWrap: "wrap" },
    exerciseEditName: { width: "100%", fontWeight: "700" },
    exerciseField: { flex: 1, minWidth: 70, gap: 4 },
    smallEditInput: { width: "100%", borderWidth: 1, borderRadius: 8, padding: 8 },
    meta: { fontSize: 12, textTransform: "capitalize" },
    activitySummary: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 11 },
    activitySummaryText: { fontSize: 14, fontWeight: "700" },
    exerciseList: { gap: 8, marginTop: 4 },
    exerciseListHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: 2 },
    exerciseListTitle: { fontSize: 14, fontWeight: "800" },
    exerciseCount: { fontSize: 12 },
    exerciseCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 11, borderRadius: 13, borderWidth: 1 },
    exerciseNumber: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    exerciseNumberText: { fontSize: 11, fontWeight: "800" },
    exerciseCopy: { flex: 1, gap: 6 },
    exerciseName: { fontSize: 14, fontWeight: "800" },
    prescriptionRow: { flexDirection: "row", gap: 5, flexWrap: "wrap" },
    prescriptionPill: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 6 },
    prescriptionText: { fontSize: 11, fontWeight: "700" },
    loadBlock: { minWidth: 64, alignItems: "flex-end", paddingLeft: 4 },
    loadLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.8 },
    loadValue: { fontSize: 15, fontWeight: "900", marginTop: 2, textAlign: "right" },
    detail: { lineHeight: 20 },
    actionRow: { flexDirection: "row", gap: 18, paddingTop: 6 },
    empty: { textAlign: "center", paddingVertical: 20 },
});

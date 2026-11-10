import { getLocalYYYYMMDD } from "./date-utils";
import { supabase } from "./supabase";

export type CalendarMode = "running" | "weight_training" | "combined" | "other";
export type CalendarSessionMode = "running" | "weight_training" | "other" | "rest";
export type CalendarSessionStatus = "planned" | "completed" | "skipped";

export interface CalendarSessionDetails {
    warmup?: string;
    cooldown?: string;
    distance_km?: number;
    duration_minutes?: number;
    pace?: string;
    exercises?: {
        name: string;
        sets?: number;
        reps?: string;
        load?: string;
        rpe?: number;
    }[];
    notes?: string;
}

export interface ImportedCalendarSession {
    date: string;
    mode: CalendarSessionMode;
    title: string;
    details?: CalendarSessionDetails;
}

export interface CalendarProgramOverview {
    objective?: string;
    target_outcome?: string;
    weekly_structure?: string;
    progression?: string;
    intensity_guidance?: string;
    recovery_guidance?: string;
    equipment?: string;
    success_metrics?: string[];
    notes?: string;
}

export interface ImportedCalendarProgram {
    name: string;
    mode: CalendarMode;
    start_date: string;
    duration_weeks: number;
    overview?: CalendarProgramOverview;
    sessions: ImportedCalendarSession[];
}

export interface CalendarProgram extends ImportedCalendarProgram {
    id: string;
    source_prompt: string;
    created_at: string;
    updated_at: string;
}

export interface CalendarSession extends ImportedCalendarSession {
    id: string;
    program_id: string;
    status: CalendarSessionStatus;
    completion_notes: string | null;
    completed_at: string | null;
}

function isDate(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00`));
}

function isMode(value: unknown): value is CalendarMode {
    return value === "running" || value === "weight_training" || value === "combined" || value === "other";
}

function isSessionMode(value: unknown): value is CalendarSessionMode {
    return value === "running" || value === "weight_training" || value === "other" || value === "rest";
}

export function validateImportedProgram(value: unknown): { program: ImportedCalendarProgram | null; error: string | null } {
    if (!value || typeof value !== "object") return { program: null, error: "The import must be a JSON object." };
    const raw = value as Partial<ImportedCalendarProgram>;
    if (typeof raw.name !== "string" || !raw.name.trim()) return { program: null, error: "The program needs a name." };
    if (!isMode(raw.mode)) return { program: null, error: "The program mode is invalid." };
    if (!isDate(raw.start_date)) return { program: null, error: "The start_date must use YYYY-MM-DD." };
    const durationWeeks = raw.duration_weeks;
    if (typeof durationWeeks !== "number" || !Number.isInteger(durationWeeks) || durationWeeks < 1 || durationWeeks > 104) {
        return { program: null, error: "duration_weeks must be between 1 and 104." };
    }
    if (!Array.isArray(raw.sessions)) return { program: null, error: "The program needs a sessions array." };
    const startTime = Date.parse(`${raw.start_date}T00:00:00`);
    const end = new Date(startTime);
    end.setDate(end.getDate() + durationWeeks * 7 - 1);
    const endTime = end.getTime();
    const sessions: ImportedCalendarSession[] = [];
    for (const rawSession of raw.sessions) {
        if (!rawSession || typeof rawSession !== "object") return { program: null, error: "Every session must be an object." };
        const session = rawSession as Partial<ImportedCalendarSession>;
        if (!isDate(session.date) || !isSessionMode(session.mode) || typeof session.title !== "string" || !session.title.trim()) {
            return { program: null, error: "Each session needs a valid date, mode, and title." };
        }
        if (session.mode === "rest") continue;
        const sessionTime = Date.parse(`${session.date}T00:00:00`);
        if (sessionTime < startTime || sessionTime > endTime) {
            return { program: null, error: `Session "${session.title}" is outside the program date range.` };
        }
        sessions.push({ date: session.date, mode: session.mode, title: session.title.trim(), details: session.details ?? {} });
    }
    return {
        program: { name: raw.name.trim(), mode: raw.mode, start_date: raw.start_date, duration_weeks: durationWeeks, sessions },
        error: null,
    };
}

export function extractJsonFromResponse(text: string): unknown {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? text;
    return JSON.parse(fenced.trim());
}

export function buildCalendarPrompt(input: {
    mode: CalendarMode;
    startDate: string;
    durationWeeks: number;
    goal: string;
    daysAvailable: string;
    equipment: string;
    limitations: string;
    preferences: string;
    historyLookbackDays: number;
    historySummary: string;
}): string {
    return `Create a ${input.durationWeeks}-week ${input.mode} training program starting on ${input.startDate}.

User requirements:
- Objective and primary goal: ${input.goal || "Not specified"}
- Target outcome: Describe the measurable result the user should achieve by the end of the program.
- Days available: ${input.daysAvailable || "Not specified"}
- Equipment/access: ${input.equipment || "Not specified"}
- Injuries or limitations: ${input.limitations || "None reported"}
- Preferences: ${input.preferences || "Not specified"}

Recent training evidence (${input.historyLookbackDays} day lookback plus all-time bests):
${input.historySummary || "No imported workout history is available."}

Program design requirements:
- Make the objective explicit and connect every training phase to it.
- State the target outcome and measurable success criteria.
- Explain the weekly structure, progression model, intensity guidance, and recovery strategy.
- Use the user's history to set a realistic starting point and explain important assumptions.
- Include warm-ups, cool-downs, rest/recovery days, and safety notes where relevant.

Return ONLY one JSON object in a \`\`\`json code block. Do not include commentary outside it.
Use exactly this shape:
{
  "name": "Short program name",
  "mode": "${input.mode}",
  "start_date": "${input.startDate}",
  "duration_weeks": ${input.durationWeeks},
  "overview": {
    "objective": "What this program is designed to achieve",
    "target_outcome": "Specific outcome by the end of the program",
    "weekly_structure": "How the training week is organized",
    "progression": "How distance, pace, volume, load, or intensity progresses",
    "intensity_guidance": "How to judge effort using pace, RPE, heart rate, or load",
    "recovery_guidance": "Rest, easy-day, sleep, and recovery guidance",
    "equipment": "Required or recommended equipment",
    "success_metrics": ["Measurable success marker 1", "Measurable success marker 2"],
    "notes": "Important assumptions or safety notes"
  },
  "sessions": [
    {
      "date": "YYYY-MM-DD",
      "mode": "running | weight_training | other | rest",
      "title": "Session title",
      "details": {
        "warmup": "Optional",
        "cooldown": "Optional",
        "distance_km": 0,
        "duration_minutes": 0,
        "pace": "Optional",
        "exercises": [{"name": "Exercise", "sets": 3, "reps": "5", "load": "RPE 7", "rpe": 7}],
        "notes": "Optional"
      }
    }
  ]
}
Do not include rest days or recovery-only calendar entries. Use dates within the requested duration.`;
}

export async function buildHistorySummary(lookbackDays: number): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return "";
    const from = new Date();
    from.setDate(from.getDate() - lookbackDays);
    const { data, error } = await supabase
        .from("workouts")
        .select("start_time, title, sets(weight_kg, reps, exercises(name))")
        .eq("user_id", user.id)
        .gte("start_time", from.toISOString())
        .order("start_time", { ascending: false })
        .limit(250);
    if (error) {
        console.error("Calendar history summary error:", error);
        return "";
    }
    const rows = (data ?? []).map((workout: any) => {
        const sets = (workout.sets ?? []).filter((set: any) => Number(set.weight_kg) > 0 && Number(set.reps) > 0);
        const best = sets.reduce((result: string[], set: any) => {
            const name = set.exercises?.name ?? "Unknown exercise";
            return [...result, `${name}: ${set.weight_kg}kg x ${set.reps}`];
        }, []).slice(0, 12);
        return `${workout.start_time.slice(0, 10)} ${workout.title ?? "Workout"} — ${best.join(", ")}`;
    });
    return rows.join("\n");
}

export function sessionForDate(sessions: CalendarSession[], date: Date): CalendarSession[] {
    const key = getLocalYYYYMMDD(date);
    return sessions.filter((session) => session.date === key);
}

export function parsePaceSeconds(pace: string): number | null {
    const match = pace.trim().match(/(?:^|\s)(\d{1,2}):([0-5]\d)(?:\s*\/?\s*(?:km|kilometer|kilometre))?/i);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

export function formatPace(secondsPerKm: number): string {
    const rounded = Math.max(0, Math.round(secondsPerKm));
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}/km`;
}

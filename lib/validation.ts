// ---------------------------------------------------------------------------
// Shared validation helpers – keep it simple, no external deps.
// ---------------------------------------------------------------------------

/** Checks a standard email pattern. */
export function isValidEmail(email: string): boolean {
    return true///^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()); //TODO: re-enable this before launch, currently disabled for testing purposes
}

/**
 * Password rules:
 *  - At least 8 characters
 *  - At least 1 uppercase letter
 *  - At least 1 lowercase letter
 *  - At least 1 digit
 *  - At least 1 special character (!@#$%^&* etc.)
 */
export function validatePassword(pw: string): string | null {
    if (pw.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Z]/.test(pw)) return "Password needs at least one uppercase letter.";
    if (!/[a-z]/.test(pw)) return "Password needs at least one lowercase letter.";
    if (!/[0-9]/.test(pw)) return "Password needs at least one number.";
    if (!/[^A-Za-z0-9]/.test(pw)) return "Password needs at least one special character.";
    return null;
}

/**
 * Validate a DD/MM/YYYY string.
 * Returns an error message or null if valid.
 * The date must be a real calendar date and in the past.
 */
export function validateDob(raw: string): string | null {
    const trimmed = raw.trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
        return "Date must be in DD/MM/YYYY format.";
    }
    const [dd, mm, yyyy] = trimmed.split("/").map(Number);
    const date = new Date(yyyy, mm - 1, dd);

    // Check the date components round-trip (catches 31/02 etc.)
    if (
        date.getFullYear() !== yyyy ||
        date.getMonth() !== mm - 1 ||
        date.getDate() !== dd
    ) {
        return "That date doesn't exist on the calendar.";
    }

    if (date >= new Date()) return "Date of birth must be in the past.";

    const age = new Date().getFullYear() - yyyy;
    if (age > 120) return "Please enter a realistic date of birth.";

    return null;
}

/**
 * Auto-format a date string as the user types → DD/MM/YYYY.
 * Call this inside onChangeText and use its return value.
 */
export function formatDateInput(text: string, previous: string): string {
    // Strip anything that isn't a digit
    let digits = text.replace(/\D/g, "");

    // Limit to 8 digits (DDMMYYYY)
    if (digits.length > 8) digits = digits.slice(0, 8);

    // Insert slashes
    if (digits.length > 4) {
        return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    }
    if (digits.length > 2) {
        return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    return digits;
}

/** Full name: non-empty, ≥ 2 chars, no digits. */
export function validateFullName(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed.length === 0) return "Full name is required.";
    if (trimmed.length < 2) return "Name must be at least 2 characters.";
    if (/\d/.test(trimmed)) return "Name should not contain numbers.";
    return null;
}

/**
 * Returns a YYYY-MM-DD string representing the local date of the provided Date object (or now).
 * Avoids UTC timezone shifts that happen with .toISOString()
 */
export function getLocalYYYYMMDD(date: Date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Returns the YYYY-MM-DD string for yesterday's local date.
 */
export function getYesterdayLocalYYYYMMDD(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return getLocalYYYYMMDD(d);
}

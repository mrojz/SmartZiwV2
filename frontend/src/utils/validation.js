export function isRequired(value) {
    const str = typeof value === 'string' ? value : String(value ?? '');
    return str.trim() ? undefined : 'This field is required';
}

export function isEmail(value) {
    if (!value) return 'Email is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return 'Enter a valid email address';
    return undefined;
}

export function isUrl(value) {
    if (!value) return 'URL is required';
    try {
        const url = new URL(String(value));
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'URL must use http or https';
        return undefined;
    } catch {
        return 'Enter a valid URL';
    }
}

export function isNumberInRange(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'Must be a number';
    if (min !== undefined && num < min) return `Must be at least ${min}`;
    if (max !== undefined && num > max) return `Must be at most ${max}`;
    return undefined;
}

export function matchesPassword(a, b) {
    if (!a) return 'Password is required';
    if (String(a).length < 8) return 'Password must be at least 8 characters';
    if (a !== b) return 'Passwords do not match';
    return undefined;
}

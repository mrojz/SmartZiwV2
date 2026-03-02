import { useState, useRef, useEffect, useMemo } from 'react';

/**
 * SmartSearch — chip-based tokenized filter input.
 *
 * Props:
 *   chips          – array of { field, value } objects (active filters)
 *   onChipsChange  – callback to update the chips array
 *   freeText       – current free-text search string
 *   onFreeTextChange – callback to update free-text
 *   projects       – project data (for value autocomplete)
 *   regions        – region config (for region value autocomplete)
 */

const FILTER_COLUMNS = [
    { key: 'source', label: 'source', desc: 'Data source' },
    { key: 'region', label: 'region', desc: 'Geographic region' },
    { key: 'country', label: 'country', desc: 'Country / Sponsor' },
    { key: 'keyword', label: 'keyword', desc: 'Matched keyword' },
    { key: 'ai', label: 'ai', desc: 'AI verified (Yes/No)' },
    { key: 'decision', label: 'decision', desc: 'Go / No Go' },
    { key: 'id', label: 'id', desc: 'Project ID' },
];

const ALIASES = {
    source: 'source', region: 'region', country: 'country',
    sponsor: 'country', keyword: 'keyword', kw: 'keyword',
    ai: 'ai', verified: 'ai', decision: 'decision', id: 'id',
};

export default function SmartSearch({
    chips, onChipsChange, freeText, onFreeTextChange,
    projects, regions,
}) {
    const [input, setInput] = useState('');
    const [showDrop, setShowDrop] = useState(false);
    const [selIdx, setSelIdx] = useState(0);
    const inputRef = useRef(null);
    const dropRef = useRef(null);

    // ── Parse what the user is currently typing ──────────────────────
    const ctx = useMemo(() => {
        const text = input.trim();
        const colonIdx = text.indexOf(':');
        if (colonIdx === -1) {
            return { phase: 'column', partial: text.toLowerCase() };
        }
        const col = text.slice(0, colonIdx).toLowerCase();
        const val = text.slice(colonIdx + 1);
        return { phase: 'value', column: col, partial: val.toLowerCase(), colRaw: text.slice(0, colonIdx) };
    }, [input]);

    // ── Unique values from data ──────────────────────────────────────
    const columnValues = useMemo(() => {
        const vals = {
            source: new Set(), region: new Set(), country: new Set(),
            keyword: new Set(), ai: new Set(['Yes', 'No']),
            decision: new Set(['Go', 'No Go']), id: new Set(),
        };
        Object.keys(regions || {}).forEach((r) => vals.region.add(r));
        (projects || []).forEach((p) => {
            if (p.source) vals.source.add(p.source);
            if (p.project_sponsor) vals.country.add(p.project_sponsor);
            if (p.project_id) vals.id.add(p.project_id);
            if (p.matched_keywords) {
                p.matched_keywords.split(',').forEach((k) => {
                    const t = k.trim();
                    if (t) vals.keyword.add(t);
                });
            }
        });
        const result = {};
        for (const [k, s] of Object.entries(vals)) result[k] = [...s].sort();
        return result;
    }, [projects, regions]);

    // ── Suggestions ──────────────────────────────────────────────────
    const suggestions = useMemo(() => {
        if (ctx.phase === 'column') {
            if (!ctx.partial) return [];
            return FILTER_COLUMNS
                .filter((c) => c.label.startsWith(ctx.partial))
                .map((c) => ({ type: 'column', label: `${c.label}:`, desc: c.desc, insert: `${c.label}:` }));
        }
        if (ctx.phase === 'value') {
            const resolved = ALIASES[ctx.column] || ctx.column;
            const possible = columnValues[resolved] || [];
            const filtered = ctx.partial
                ? possible.filter((v) => v.toLowerCase().includes(ctx.partial))
                : possible;
            return filtered.slice(0, 12).map((v) => ({
                type: 'value', label: v, desc: resolved,
                chip: { field: ctx.column, value: v },
            }));
        }
        return [];
    }, [ctx, columnValues]);

    useEffect(() => setSelIdx(0), [suggestions.length]);
    useEffect(() => setShowDrop(suggestions.length > 0), [suggestions]);

    // Close on outside click
    useEffect(() => {
        const handler = (e) => {
            if (dropRef.current && !dropRef.current.contains(e.target) &&
                inputRef.current && !inputRef.current.contains(e.target)) {
                setShowDrop(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    // ── Commit a chip ────────────────────────────────────────────────
    const addChip = (chip) => {
        onChipsChange([...chips, chip]);
        setInput('');
        inputRef.current?.focus();
        setShowDrop(false);
    };

    const removeChip = (idx) => {
        onChipsChange(chips.filter((_, i) => i !== idx));
    };

    const selectSuggestion = (s) => {
        if (s.type === 'column') {
            setInput(s.insert);
            inputRef.current?.focus();
            setShowDrop(false);
        } else if (s.chip) {
            addChip(s.chip);
        }
    };

    // ── Try to commit the current input as a chip ────────────────────
    const tryCommit = () => {
        const text = input.trim();
        const colonIdx = text.indexOf(':');
        if (colonIdx > 0 && colonIdx < text.length - 1) {
            const field = text.slice(0, colonIdx).trim();
            let value = text.slice(colonIdx + 1).trim();
            // Strip quotes
            if (value.startsWith('"') && value.endsWith('"')) {
                value = value.slice(1, -1);
            }
            if (field && value) {
                addChip({ field, value });
                return true;
            }
        }
        return false;
    };

    const handleKeyDown = (e) => {
        if (showDrop && suggestions.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelIdx((prev) => (prev + 1) % suggestions.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelIdx((prev) => (prev - 1 + suggestions.length) % suggestions.length);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                if (suggestions[selIdx]) selectSuggestion(suggestions[selIdx]);
                return;
            }
            if (e.key === 'Enter') {
                e.preventDefault();
                // If we have a value suggestion selected, use it
                if (suggestions[selIdx] && suggestions[selIdx].type === 'value') {
                    selectSuggestion(suggestions[selIdx]);
                    return;
                }
                // If it's a column suggestion, insert it
                if (suggestions[selIdx] && suggestions[selIdx].type === 'column') {
                    selectSuggestion(suggestions[selIdx]);
                    return;
                }
            }
            if (e.key === 'Escape') {
                setShowDrop(false);
                return;
            }
        }

        if (e.key === 'Enter') {
            e.preventDefault();
            if (!tryCommit()) {
                // Not a structured token — update free text
                const text = input.trim();
                if (text) {
                    onFreeTextChange(text);
                    setInput('');
                }
            }
        }

        if (e.key === 'Backspace' && input === '' && chips.length > 0) {
            // Remove last chip when backspacing on empty input
            removeChip(chips.length - 1);
        }
    };

    const handleChange = (e) => {
        setInput(e.target.value);
        // If user clears the input, also clear freeText
        if (!e.target.value.trim() && freeText) {
            onFreeTextChange('');
        }
    };

    return (
        <div className="smart-search">
            <div className="smart-search-input-area" onClick={() => inputRef.current?.focus()}>
                <span className="search-icon">🔍</span>
                {chips.map((chip, i) => (
                    <span key={`${chip.field}-${chip.value}-${i}`} className="search-chip">
                        <span className="chip-field">{chip.field}</span>
                        <span className="chip-value">{chip.value}</span>
                        <button className="chip-remove" onClick={(e) => { e.stopPropagation(); removeChip(i); }}>×</button>
                    </span>
                ))}
                {freeText && (
                    <span className="search-chip free-text-chip">
                        <span className="chip-value">{freeText}</span>
                        <button className="chip-remove" onClick={(e) => { e.stopPropagation(); onFreeTextChange(''); }}>×</button>
                    </span>
                )}
                <input
                    ref={inputRef}
                    className="search-input"
                    type="text"
                    placeholder={chips.length > 0 || freeText ? 'Add filter…' : 'Type to search or filter (e.g. source:iadb)'}
                    value={input}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => suggestions.length > 0 && setShowDrop(true)}
                />
            </div>
            {showDrop && suggestions.length > 0 && (
                <div className="search-dropdown" ref={dropRef}>
                    <div className="dropdown-header">
                        {ctx.phase === 'column' ? 'Filter by column' : `Values for ${ctx.column}`}
                    </div>
                    {suggestions.map((s, i) => (
                        <div
                            key={`${s.label}-${i}`}
                            className={`search-suggestion ${i === selIdx ? 'selected' : ''}`}
                            onMouseDown={() => selectSuggestion(s)}
                            onMouseEnter={() => setSelIdx(i)}
                        >
                            <span className={`suggestion-label ${s.type === 'column' ? 'is-column' : 'is-value'}`}>
                                {s.label}
                            </span>
                            <span className="suggestion-desc">{s.desc}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}


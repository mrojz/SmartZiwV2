import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

/* ─── Structured chip parser (field:value tokens) ─────────────────── */
const CHIP_FIELDS = new Set(['source', 'region', 'continent', 'country', 'keyword', 'ai', 'decision', 'id']);

function parseChipTokens(raw) {
    const text = String(raw || '');
    const tokenRegex = /(source|region|continent|country|keyword|ai|decision|id)\s*:\s*([^:]+?)(?=\s+(?:source|region|continent|country|keyword|ai|decision|id)\s*:|$)/gi;
    const chips = [];
    const spans = [];
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
        const field = match[1].toLowerCase();
        const value = match[2].trim();
        if (value) {
            chips.push({ field, value });
            spans.push([match.index, tokenRegex.lastIndex]);
        }
    }
    let free = text;
    for (let i = spans.length - 1; i >= 0; i -= 1) {
        const [s, e] = spans[i];
        free = `${free.slice(0, s)} ${free.slice(e)}`;
    }
    return { chips, freeText: free.replace(/\s+/g, ' ').trim() };
}

/* ─── Suggestion dropdown ─────────────────────────────────────────── */
function SuggestionDrop({ suggestions, selectedIndex, onSelect, onHover, style, dropRef }) {
    if (!suggestions.length) return null;
    return createPortal(
        <div className="usb-suggestion-drop" ref={dropRef} style={style}>
            {suggestions.map((s, i) => (
                <div
                    key={`${s.type}-${s.label}-${i}`}
                    className={`usb-suggestion-item${i === selectedIndex ? ' is-selected' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); onSelect(s); }}
                    onMouseEnter={() => onHover(i)}
                >
                    <span className={`usb-sug-label${s.type === 'column' ? ' is-field' : ''}`}>{s.label}</span>
                    <span className="usb-sug-desc">{s.desc}</span>
                </div>
            ))}
        </div>,
        document.body,
    );
}

/* ─── Filter popover (source, region, continent, decision, verified) ── */
function FilterPopover({ label, options, value, onChange, searchable = true }) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const triggerRef = useRef(null);
    const popRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    const filtered = useMemo(() => {
        if (!query.trim()) return options;
        return options.filter((o) => String(o.label || o).toLowerCase().includes(query.toLowerCase()));
    }, [options, query]);

    useLayoutEffect(() => {
        if (!open || !triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 6, left: rect.left });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (!triggerRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) {
                setOpen(false);
                setQuery('');
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const isActive = Boolean(value);
    const currentLabel = value ? (options.find((o) => (o.value ?? o) === value)?.label ?? value) : null;

    return (
        <div className="usb-filter-wrap">
            <button
                type="button"
                ref={triggerRef}
                className={`usb-filter-trigger${isActive ? ' is-active' : ''}`}
                onClick={() => { setOpen((prev) => !prev); setQuery(''); }}
                aria-pressed={isActive}
            >
                <span>{currentLabel ? `${label}: ${currentLabel}` : label}</span>
                {isActive && (
                    <span
                        className="usb-filter-clear"
                        role="button"
                        aria-label={`Clear ${label} filter`}
                        onMouseDown={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }}
                    >
                        ×
                    </span>
                )}
                {!isActive && <span className="usb-trigger-chevron" aria-hidden="true">▾</span>}
            </button>
            {open && createPortal(
                <div className="usb-filter-popover" ref={popRef} style={{ top: pos.top, left: pos.left }}>
                    {searchable && options.length > 8 && (
                        <div className="usb-pop-search-wrap">
                            <input
                                className="usb-pop-search"
                                type="text"
                                placeholder={`Search ${label.toLowerCase()}…`}
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                autoFocus
                            />
                        </div>
                    )}
                    <div className="usb-pop-list">
                        {filtered.map((opt) => {
                            const optVal = opt.value ?? opt;
                            const optLabel = opt.label ?? opt;
                            const isSelected = value === optVal;
                            return (
                                <button
                                    key={optVal}
                                    type="button"
                                    className={`usb-pop-option${isSelected ? ' is-selected' : ''}`}
                                    onMouseDown={() => { onChange(isSelected ? '' : optVal); setOpen(false); setQuery(''); }}
                                >
                                    {isSelected && <span className="usb-pop-check" aria-hidden="true">✓</span>}
                                    <span>{optLabel}</span>
                                </button>
                            );
                        })}
                        {filtered.length === 0 && <div className="usb-pop-empty">No results</div>}
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}

/* ─── Date range popover ─────────────────────────────────────────── */
function DateRangePopover({ label, from, to, onFromChange, onToChange }) {
    const [open, setOpen] = useState(false);
    const [draftFrom, setDraftFrom] = useState(from);
    const [draftTo, setDraftTo] = useState(to);
    const triggerRef = useRef(null);
    const popRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const isActive = Boolean(from || to);

    useEffect(() => { setDraftFrom(from); }, [from]);
    useEffect(() => { setDraftTo(to); }, [to]);

    useLayoutEffect(() => {
        if (!open || !triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 6, left: rect.left });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (!triggerRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const apply = () => {
        onFromChange(draftFrom);
        onToChange(draftTo);
        setOpen(false);
    };
    const clear = () => {
        setDraftFrom(''); setDraftTo('');
        onFromChange(''); onToChange('');
        setOpen(false);
    };
    const formatShort = (v) => {
        if (!v) return null;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return v;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    };
    const activeLabel = from || to
        ? `${formatShort(from) || 'Any'} → ${formatShort(to) || 'Any'}`
        : null;

    return (
        <div className="usb-filter-wrap">
            <button
                type="button"
                ref={triggerRef}
                className={`usb-filter-trigger${isActive ? ' is-active' : ''}`}
                onClick={() => setOpen((p) => !p)}
            >
                <span>{activeLabel ? `${label}: ${activeLabel}` : label}</span>
                {isActive ? (
                    <span
                        className="usb-filter-clear"
                        role="button"
                        aria-label={`Clear ${label} filter`}
                        onMouseDown={(e) => { e.stopPropagation(); clear(); }}
                    >×</span>
                ) : <span className="usb-trigger-chevron" aria-hidden="true">▾</span>}
            </button>
            {open && createPortal(
                <div className="usb-filter-popover usb-date-popover" ref={popRef} style={{ top: pos.top, left: pos.left }}>
                    <div className="usb-date-grid">
                        <label className="usb-date-label">From</label>
                        <input className="usb-date-input" type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
                        <label className="usb-date-label">To</label>
                        <input className="usb-date-input" type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
                    </div>
                    <div className="usb-date-actions">
                        <button type="button" className="usb-date-apply" onClick={apply}>Apply</button>
                        <button type="button" className="usb-date-clear" onClick={clear}>Clear</button>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}

/* ─── Saved searches popover ─────────────────────────────────────── */
function SavedSearchesPopover({ savedSearches, onSave, onApply, onDelete }) {
    const [open, setOpen] = useState(false);
    const [newName, setNewName] = useState('');
    const triggerRef = useRef(null);
    const popRef = useRef(null);
    const [pos, setPos] = useState({ top: 0, left: 0 });

    useLayoutEffect(() => {
        if (!open || !triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        setPos({ top: rect.bottom + 6, left: rect.right - 240 });
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (!triggerRef.current?.contains(e.target) && !popRef.current?.contains(e.target)) setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div className="usb-filter-wrap">
            <button
                type="button"
                ref={triggerRef}
                className="usb-saved-trigger"
                onClick={() => setOpen((p) => !p)}
                title="Saved searches"
            >
                <span className="usb-saved-icon" aria-hidden="true">⊛</span>
                {savedSearches.length > 0 && <span className="usb-saved-count">{savedSearches.length}</span>}
            </button>
            {open && createPortal(
                <div className="usb-filter-popover usb-saved-popover" ref={popRef} style={{ top: pos.top, left: pos.left }}>
                    <div className="usb-saved-header">Saved searches</div>
                    {savedSearches.length === 0 && (
                        <div className="usb-pop-empty">No saved searches yet</div>
                    )}
                    {savedSearches.map((item) => (
                        <div key={item.id} className="usb-saved-item">
                            <button
                                type="button"
                                className="usb-saved-name"
                                onClick={() => { onApply(item.id); setOpen(false); }}
                            >
                                {item.name}
                            </button>
                            <button
                                type="button"
                                className="usb-saved-delete"
                                onClick={() => onDelete(item.id)}
                                aria-label={`Delete saved search ${item.name}`}
                            >×</button>
                        </div>
                    ))}
                    <div className="usb-saved-save-row">
                        <input
                            className="usb-saved-name-input"
                            type="text"
                            placeholder="Name this search…"
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { onSave(newName.trim()); setNewName(''); setOpen(false); } }}
                        />
                        <button
                            type="button"
                            className="usb-saved-save-btn"
                            disabled={!newName.trim()}
                            onClick={() => { if (newName.trim()) { onSave(newName.trim()); setNewName(''); setOpen(false); } }}
                        >Save</button>
                    </div>
                </div>,
                document.body,
            )}
        </div>
    );
}

/* ─── CHIP_FIELD_LABELS ──────────────────────────────────────────── */
const CHIP_COLUMNS = [
    { key: 'source', label: 'source', desc: 'Data source' },
    { key: 'region', label: 'region', desc: 'Geographic region' },
    { key: 'continent', label: 'continent', desc: 'Continent' },
    { key: 'country', label: 'country', desc: 'Country / Sponsor' },
    { key: 'keyword', label: 'keyword', desc: 'Matched keyword' },
    { key: 'ai', label: 'ai', desc: 'AI verified (Yes/No)' },
    { key: 'decision', label: 'decision', desc: 'Go / No Go' },
    { key: 'id', label: 'id', desc: 'Project ID' },
];

/* ─── Main export ─────────────────────────────────────────────────── */
export default function UnifiedSearchBar({
    // chip / text search
    chips,
    onChipsChange,
    freeText,
    onFreeTextChange,
    // dropdown filters
    source, onSourceChange, sources,
    region, onRegionChange, regions,
    continent, onContinentChange, continents,
    verified, onVerifiedChange,
    decision, onDecisionChange,
    // date range filters
    deadlineFrom, deadlineTo, onDeadlineFromChange, onDeadlineToChange,
    scrapedFrom, scrapedTo, onScrapedFromChange, onScrapedToChange,
    // expiring soon
    expiringSoonOnly, expiringSoonDays, onToggleExpiringSoon, onExpiringSoonDaysChange,
    // saved searches
    savedSearches, onSaveCurrentSearch, onApplySavedSearch, onDeleteSavedSearch,
    // meta
    resultCount,
    onClearAll,
    // data for autocomplete
    allProjects,
    // auto-filter
    autoFilterActive,
    onClearAutoFilter,
    onDismissAutoFilterToast,
}) {
    const [input, setInput] = useState('');
    const [showDrop, setShowDrop] = useState(false);
    const [selIdx, setSelIdx] = useState(0);
    const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 300, maxHeight: 320 });
    const inputRef = useRef(null);
    const inputAreaRef = useRef(null);
    const dropRef = useRef(null);

    /* ── Autocomplete context ── */
    const ctx = useMemo(() => {
        const text = input.trimStart();
        const colonIdx = text.indexOf(':');
        if (colonIdx === -1) return { phase: 'column', partial: text.toLowerCase() };
        const col = text.slice(0, colonIdx).toLowerCase();
        const val = text.slice(colonIdx + 1);
        return { phase: 'value', column: col, partial: val.toLowerCase(), colRaw: text.slice(0, colonIdx) };
    }, [input]);

    /* ── Unique values from data ── */
    const columnValues = useMemo(() => {
        const vals = {
            source: new Set(),
            region: new Set(),
            continent: new Set(),
            country: new Set(),
            keyword: new Set(),
            ai: new Set(['Yes', 'No']),
            decision: new Set(['Go', 'No Go', 'Undecided']),
            id: new Set(),
        };
        Object.keys(regions || {}).forEach((r) => vals.region.add(r));
        (continents || []).forEach((c) => vals.continent.add(c.name_en || c.name_fr || c.code));
        (allProjects || []).forEach((p) => {
            if (p.source) vals.source.add(p.source);
            (p.country_names_en || []).forEach((n) => n && vals.country.add(n));
            (p.country_names_fr || []).forEach((n) => n && vals.country.add(n));
            if (!(p.country_names_en || []).length && !(p.country_names_fr || []).length && p.project_sponsor) vals.country.add(p.project_sponsor);
            if (p.project_id) vals.id.add(p.project_id);
            String(p.matched_keywords || '').split(',').forEach((k) => { const t = k.trim(); if (t) vals.keyword.add(t); });
        });
        const result = {};
        for (const [k, s] of Object.entries(vals)) result[k] = [...s].sort();
        return result;
    }, [allProjects, regions, continents]);

    /* ── Suggestions ── */
    const suggestions = useMemo(() => {
        if (ctx.phase === 'column') {
            if (!ctx.partial) return [];
            return CHIP_COLUMNS
                .filter((c) => c.label.startsWith(ctx.partial))
                .map((c) => ({ type: 'column', label: `${c.label}:`, desc: c.desc, insert: `${c.label}:` }));
        }
        if (ctx.phase === 'value') {
            const possible = columnValues[ctx.column] || [];
            const filtered = ctx.partial ? possible.filter((v) => v.toLowerCase().includes(ctx.partial)) : possible;
            return filtered.slice(0, 12).map((v) => ({
                type: 'value', label: v, desc: ctx.column,
                chip: { field: ctx.column, value: v },
            }));
        }
        return [];
    }, [ctx, columnValues]);

    useEffect(() => setSelIdx(0), [suggestions.length]);
    useEffect(() => setShowDrop(suggestions.length > 0), [suggestions]);

    /* ── Portal dropdown position ── */
    useLayoutEffect(() => {
        if (!showDrop) return undefined;
        const update = () => {
            const anchor = inputAreaRef.current;
            if (!anchor) return;
            const rect = anchor.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom - 12;
            setDropPos({
                left: rect.left, top: rect.bottom + 6,
                width: rect.width,
                maxHeight: Math.max(140, Math.min(320, spaceBelow)),
            });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    }, [showDrop, suggestions.length, chips.length, freeText, input]);

    /* ── Outside click ── */
    useEffect(() => {
        const handler = (e) => {
            if (dropRef.current?.contains(e.target) || inputAreaRef.current?.contains(e.target)) return;
            setShowDrop(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    /* ── Chip management ── */
    const addChip = useCallback((chip) => {
        const key = `${String(chip.field).toLowerCase()}::${String(chip.value).toLowerCase()}`;
        const existing = new Set(chips.map((c) => `${String(c.field).toLowerCase()}::${String(c.value).toLowerCase()}`));
        if (existing.has(key)) { setInput(''); inputRef.current?.focus(); setShowDrop(false); return; }
        onChipsChange([...chips, { field: String(chip.field).toLowerCase(), value: chip.value }]);
        setInput('');
        inputRef.current?.focus();
        setShowDrop(false);
    }, [chips, onChipsChange]);

    const removeChip = useCallback((idx) => onChipsChange(chips.filter((_, i) => i !== idx)), [chips, onChipsChange]);

    const selectSuggestion = useCallback((s) => {
        if (s.type === 'column') { setInput(s.insert); inputRef.current?.focus(); setShowDrop(false); }
        else if (s.chip) addChip(s.chip);
    }, [addChip]);

    const tryCommit = useCallback(() => {
        const text = input.trim();
        if (!text) return false;
        const parsed = parseChipTokens(text);
        if (!parsed.chips.length) return false;
        const existing = new Set(chips.map((c) => `${String(c.field).toLowerCase()}::${String(c.value).toLowerCase()}`));
        const nextChips = [...chips];
        parsed.chips.forEach((chip) => {
            const norm = { field: String(chip.field).toLowerCase(), value: chip.value };
            const k = `${norm.field}::${String(norm.value).toLowerCase()}`;
            if (!existing.has(k)) { existing.add(k); nextChips.push(norm); }
        });
        onChipsChange(nextChips);
        onFreeTextChange(parsed.freeText);
        setInput('');
        setShowDrop(false);
        return true;
    }, [input, chips, onChipsChange, onFreeTextChange]);

    const handleKeyDown = (e) => {
        e.stopPropagation();
        if (showDrop && suggestions.length > 0) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelIdx((p) => (p + 1) % suggestions.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setSelIdx((p) => (p - 1 + suggestions.length) % suggestions.length); return; }
            if (e.key === 'Tab') { e.preventDefault(); if (suggestions[selIdx]) selectSuggestion(suggestions[selIdx]); return; }
            if (e.key === 'Enter') {
                e.preventDefault();
                if (suggestions[selIdx]) { selectSuggestion(suggestions[selIdx]); return; }
            }
            if (e.key === 'Escape') { setShowDrop(false); return; }
        }
        if (e.key === 'Enter') {
            e.preventDefault();
            if (!tryCommit()) {
                const text = input.trim();
                if (text) { onFreeTextChange(text); setInput(''); }
            }
        }
        if (e.key === 'Backspace' && input === '' && chips.length > 0) removeChip(chips.length - 1);
    };

    const handleChange = (e) => {
        setInput(e.target.value);
        if (!e.target.value.trim() && freeText) onFreeTextChange('');
    };

    /* ── Active filter state ── */
    const hasAnyFilter = chips.length > 0 || freeText || source || region || continent || verified || decision
        || deadlineFrom || deadlineTo || scrapedFrom || scrapedTo || expiringSoonOnly;

    /* ── Dropdown options ── */
    const sourceOptions = (sources || []).map((s) => ({ value: s, label: s }));
    const regionOptions = Object.keys(regions || {}).sort().map((r) => ({ value: r, label: r }));
    const continentOptions = (continents || []).map((c) => ({ value: c.name_en, label: c.name_en }));
    const verifiedOptions = [{ value: 'Yes', label: 'Verified' }, { value: 'No', label: 'Not Verified' }];
    const decisionOptions = [{ value: 'Go', label: '✓ Go' }, { value: 'No Go', label: '✗ No Go' }, { value: 'Undecided', label: '– Undecided' }];

    const inputId = 'usb-main-input';

    const formatShortDate = (v) => {
        if (!v) return null;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return v;
        return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    };

    const activeFilterChips = [];
    if (source) activeFilterChips.push({ id: 'source', label: `Source: ${source}`, onRemove: () => onSourceChange('') });
    if (region) activeFilterChips.push({ id: 'region', label: `Region: ${region}`, onRemove: () => onRegionChange('') });
    if (continent) activeFilterChips.push({ id: 'continent', label: `Continent: ${continent}`, onRemove: () => onContinentChange('') });
    if (decision) activeFilterChips.push({ id: 'decision', label: `Decision: ${decision}`, onRemove: () => onDecisionChange('') });
    if (verified) activeFilterChips.push({ id: 'verified', label: `AI: ${verified === 'Yes' ? 'Verified' : 'Not Verified'}`, onRemove: () => onVerifiedChange('') });
    if (deadlineFrom || deadlineTo) {
        activeFilterChips.push({
            id: 'deadline',
            label: `Deadline: ${formatShortDate(deadlineFrom) || 'Any'} → ${formatShortDate(deadlineTo) || 'Any'}`,
            onRemove: () => { onDeadlineFromChange(''); onDeadlineToChange(''); },
        });
    }
    if (scrapedFrom || scrapedTo) {
        const label = autoFilterActive
            ? 'Last 7 days'
            : `Scraped: ${formatShortDate(scrapedFrom) || 'Any'} → ${formatShortDate(scrapedTo) || 'Any'}`;
        activeFilterChips.push({
            id: 'scraped',
            label,
            isAuto: autoFilterActive,
            onRemove: () => { if (autoFilterActive) onClearAutoFilter(); else { onScrapedFromChange(''); onScrapedToChange(''); } },
        });
    }
    if (expiringSoonOnly) {
        activeFilterChips.push({
            id: 'expiring',
            label: `Expiring in ${expiringSoonDays} day${expiringSoonDays === 1 ? '' : 's'}`,
            onRemove: () => onToggleExpiringSoon(),
        });
    }

    return (
        <div className="usb-root">
            {/* ── Auto-filter notice ─────────────────────────────── */}
            {autoFilterActive && (
                <div className="usb-auto-filter-toast" role="status" aria-live="polite">
                    <span className="usb-auto-filter-toast-content">
                        <span className="usb-auto-filter-icon" aria-hidden="true">⏱</span>
                        Showing tenders scraped in the last 7 days.
                    </span>
                    <button type="button" className="usb-auto-filter-clear" onClick={onClearAutoFilter}>Show all</button>
                    <button type="button" className="usb-auto-filter-dismiss" onClick={onDismissAutoFilterToast} aria-label="Dismiss notice">×</button>
                </div>
            )}

            {/* ── Primary row ─────────────────────────────────────── */}
            <div className="usb-primary-row">
                {/* Search input */}
                <div
                    className="usb-search-area"
                    ref={inputAreaRef}
                    onClick={() => inputRef.current?.focus()}
                >
                    <span className="usb-search-icon" aria-hidden="true">
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="8.5" cy="8.5" r="5.5" />
                            <line x1="13.5" y1="13.5" x2="18" y2="18" />
                        </svg>
                    </span>
                    {chips.map((chip, i) => (
                        <span key={`${chip.field}-${chip.value}-${i}`} className="usb-chip">
                            <span className="usb-chip-field">{chip.field}</span>
                            <span className="usb-chip-value">{chip.value}</span>
                            <button className="usb-chip-remove" type="button" onClick={(e) => { e.stopPropagation(); removeChip(i); }} aria-label={`Remove ${chip.field}:${chip.value} filter`}>×</button>
                        </span>
                    ))}
                    {freeText && (
                        <span className="usb-chip usb-chip-free">
                            <span className="usb-chip-value">{freeText}</span>
                            <button className="usb-chip-remove" type="button" onClick={(e) => { e.stopPropagation(); onFreeTextChange(''); }} aria-label="Remove free text search">×</button>
                        </span>
                    )}
                    <label className="visually-hidden" htmlFor={inputId}>Search projects and add structured filters</label>
                    <input
                        id={inputId}
                        ref={inputRef}
                        className="usb-text-input"
                        type="text"
                        name="projectSearch"
                        aria-label="Search projects"
                        placeholder={chips.length > 0 || freeText ? 'Add filter…' : 'Search projects… (e.g. source:iadb)'}
                        value={input}
                        onChange={handleChange}
                        onKeyDown={handleKeyDown}
                        onFocus={() => suggestions.length > 0 && setShowDrop(true)}
                        autoComplete="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                    {hasAnyFilter && (
                        <button
                            type="button"
                            className="usb-clear-all-inline"
                            onClick={onClearAll}
                            title="Clear all filters"
                            aria-label="Clear all filters"
                        >
                            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="4" y1="4" x2="16" y2="16" /><line x1="16" y1="4" x2="4" y2="16" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Filter triggers */}
                <div className="usb-filters-row">
                    <FilterPopover label="Source" options={sourceOptions} value={source} onChange={onSourceChange} />
                    <FilterPopover label="Region" options={regionOptions} value={region} onChange={onRegionChange} searchable={regionOptions.length > 6} />
                    <FilterPopover label="Continent" options={continentOptions} value={continent} onChange={onContinentChange} />
                    <FilterPopover label="Decision" options={decisionOptions} value={decision} onChange={onDecisionChange} searchable={false} />
                    <FilterPopover label="AI Status" options={verifiedOptions} value={verified} onChange={onVerifiedChange} searchable={false} />
                    <DateRangePopover
                        label="Deadline"
                        from={deadlineFrom}
                        to={deadlineTo}
                        onFromChange={onDeadlineFromChange}
                        onToChange={onDeadlineToChange}
                    />

                    {/* Expiring soon toggle */}
                    <div className="usb-filter-wrap usb-expiring-wrap">
                        <label className={`usb-filter-trigger usb-expiring-trigger${expiringSoonOnly ? ' is-active' : ''}`}>
                            <input
                                type="number"
                                className="usb-expiring-days"
                                min={1}
                                max={365}
                                value={expiringSoonDays}
                                onChange={(e) => onExpiringSoonDaysChange(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                aria-label="Expiring soon days"
                            />
                            <span>day expiry</span>
                            <input
                                type="checkbox"
                                className="usb-expiring-check"
                                checked={expiringSoonOnly}
                                onChange={onToggleExpiringSoon}
                                aria-label="Expiring soon filter"
                            />
                        </label>
                    </div>

                    {/* Saved searches */}
                    <SavedSearchesPopover
                        savedSearches={savedSearches || []}
                        onSave={onSaveCurrentSearch}
                        onApply={onApplySavedSearch}
                        onDelete={onDeleteSavedSearch}
                    />
                </div>
            </div>

            {/* ── Meta row: results count ─────────────────────────── */}
            <div className="usb-meta-row">
                <span className="usb-result-count">
                    <strong>{resultCount}</strong> results
                </span>
                <span className="usb-hint">Click row to inspect · Space selects · J/K moves</span>
                {hasAnyFilter && (
                    <button type="button" className="usb-clear-all-text" onClick={onClearAll}>
                        Clear all filters
                    </button>
                )}
            </div>

            {/* ── Active filter chips ─────────────────────────────── */}
            {activeFilterChips.length > 0 && (
                <div className="usb-active-filters">
                    {activeFilterChips.map((chip) => (
                        <span key={chip.id} className={`usb-active-filter-chip${chip.isAuto ? ' is-auto' : ''}`}>
                            <span>{chip.label}</span>
                            <button
                                type="button"
                                className="usb-active-filter-remove"
                                onClick={chip.onRemove}
                                aria-label={`Remove ${chip.label} filter`}
                            >×</button>
                        </span>
                    ))}
                </div>
            )}

            {/* ── Autocomplete dropdown ──────────────────────────── */}
            {showDrop && suggestions.length > 0 && (
                <SuggestionDrop
                    suggestions={suggestions}
                    selectedIndex={selIdx}
                    onSelect={selectSuggestion}
                    onHover={setSelIdx}
                    dropRef={dropRef}
                    style={{
                        top: `${dropPos.top}px`,
                        left: `${dropPos.left}px`,
                        width: `${dropPos.width}px`,
                        maxHeight: `${dropPos.maxHeight}px`,
                    }}
                />
            )}
        </div>
    );
}

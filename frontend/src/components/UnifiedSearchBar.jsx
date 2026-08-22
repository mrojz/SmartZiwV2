import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ChevronDown, Check, Bookmark } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

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
        <div className="z-50 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md" ref={dropRef} style={style}>
            {suggestions.map((s, i) => (
                <div
                    key={`${s.type}-${s.label}-${i}`}
                    className={`flex cursor-default items-center justify-between gap-3 px-3 py-2 text-sm select-none${i === selectedIndex ? ' bg-accent text-accent-foreground' : ''}`}
                    onMouseDown={(e) => { e.preventDefault(); onSelect(s); }}
                    onMouseEnter={() => onHover(i)}
                >
                    <span className={s.type === 'column' ? 'font-semibold text-primary' : 'font-medium'}>{s.label}</span>
                    <span className="text-xs text-muted-foreground">{s.desc}</span>
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

    const filtered = useMemo(() => {
        if (!query.trim()) return options;
        return options.filter((o) => String(o.label || o).toLowerCase().includes(query.toLowerCase()));
    }, [options, query]);

    const isActive = Boolean(value);
    const currentLabel = value ? (options.find((o) => (o.value ?? o) === value)?.label ?? value) : null;

    return (
        <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant={isActive ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-9 gap-1 text-sm"
                    aria-pressed={isActive}
                >
                    <span className="max-w-44 truncate">{currentLabel ? `${label}: ${currentLabel}` : label}</span>
                    {isActive ? (
                        <span
                            role="button"
                            aria-label={`Clear ${label} filter`}
                            tabIndex={-1}
                            className="rounded-sm p-0.5 hover:bg-foreground/10"
                            onMouseDown={(e) => { e.stopPropagation(); onChange(''); setOpen(false); setQuery(''); }}
                        >
                            <X className="h-4 w-4" />
                        </span>
                    ) : <ChevronDown className="h-4 w-4 opacity-60" />}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-60 p-0">
                <Command>
                    {searchable && options.length > 8 && (
                        <CommandInput placeholder={`Search ${label.toLowerCase()}…`} value={query} onValueChange={setQuery} autoFocus />
                    )}
                    <CommandList>
                        <CommandEmpty>No results</CommandEmpty>
                        {filtered.map((opt) => {
                            const optVal = opt.value ?? opt;
                            const optLabel = opt.label ?? opt;
                            const isSelected = value === optVal;
                            return (
                                <CommandItem
                                    key={optVal}
                                    value={optLabel}
                                    onSelect={() => { onChange(isSelected ? '' : optVal); setOpen(false); setQuery(''); }}
                                >
                                    <Check className={`mr-2 h-4 w-4${isSelected ? '' : ' opacity-0'}`} />
                                    <span className="truncate">{optLabel}</span>
                                </CommandItem>
                            );
                        })}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

/* ─── Date range popover ─────────────────────────────────────────── */
function DateRangePopover({ label, from, to, onFromChange, onToChange }) {
    const [open, setOpen] = useState(false);
    const [draftFrom, setDraftFrom] = useState(from);
    const [draftTo, setDraftTo] = useState(to);
    const isActive = Boolean(from || to);

    useEffect(() => { setDraftFrom(from); }, [from]);
    useEffect(() => { setDraftTo(to); }, [to]);

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
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant={isActive ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-9 gap-1 text-sm"
                >
                    <span className="max-w-48 truncate">{activeLabel ? `${label}: ${activeLabel}` : label}</span>
                    {isActive ? (
                        <span
                            role="button"
                            aria-label={`Clear ${label} filter`}
                            tabIndex={-1}
                            className="rounded-sm p-0.5 hover:bg-foreground/10"
                            onMouseDown={(e) => { e.stopPropagation(); clear(); }}
                        >
                            <X className="h-4 w-4" />
                        </span>
                    ) : <ChevronDown className="h-4 w-4 opacity-60" />}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64">
                <div className="grid gap-3">
                    <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">From</Label>
                        <Input type="date" value={draftFrom} onChange={(e) => setDraftFrom(e.target.value)} />
                    </div>
                    <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">To</Label>
                        <Input type="date" value={draftTo} onChange={(e) => setDraftTo(e.target.value)} />
                    </div>
                </div>
                <div className="mt-3 flex gap-2">
                    <Button type="button" size="sm" className="flex-1" onClick={apply}>Apply</Button>
                    <Button type="button" size="sm" variant="outline" className="flex-1" onClick={clear}>Clear</Button>
                </div>
            </PopoverContent>
        </Popover>
    );
}

/* ─── Saved searches popover ─────────────────────────────────────── */
function SavedSearchesPopover({ savedSearches, onSave, onApply, onDelete }) {
    const [open, setOpen] = useState(false);
    const [newName, setNewName] = useState('');

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="h-9 gap-1" title="Saved searches">
                    <Bookmark className="h-4 w-4" />
                    {savedSearches.length > 0 && (
                        <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">{savedSearches.length}</span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
                <div className="text-sm font-medium">Saved searches</div>
                {savedSearches.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">No saved searches yet</div>}
                {savedSearches.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 text-sm">
                        <button
                            type="button"
                            className="flex-1 truncate rounded-md px-2 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
                            onClick={() => { onApply(item.id); setOpen(false); }}
                        >
                            {item.name}
                        </button>
                        <button
                            type="button"
                            className="rounded-md px-1.5 py-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => onDelete(item.id)}
                            aria-label={`Delete saved search ${item.name}`}
                        >×</button>
                    </div>
                ))}
                <div className="mt-2 flex gap-2 border-t pt-2">
                    <Input
                        className="h-9"
                        type="text"
                        placeholder="Name this search…"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { onSave(newName.trim()); setNewName(''); setOpen(false); } }}
                    />
                    <Button
                        type="button"
                        size="sm"
                        disabled={!newName.trim()}
                        onClick={() => { if (newName.trim()) { onSave(newName.trim()); setNewName(''); setOpen(false); } }}
                    >Save</Button>
                </div>
            </PopoverContent>
        </Popover>
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
        activeFilterChips.push({
            id: 'scraped',
            label: `Scraped: ${formatShortDate(scrapedFrom) || 'Any'} → ${formatShortDate(scrapedTo) || 'Any'}`,
            onRemove: () => { onScrapedFromChange(''); onScrapedToChange(''); },
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
        <div className="usb-root tender-filter-bar rounded-lg border bg-card p-6 shadow-sm">

            {/* ── Primary row ─────────────────────────────────────── */}
            <div className="flex flex-wrap items-center gap-2">
                {/* Search input */}
                <div
                    className="usb-search-area flex h-9 min-w-[260px] flex-1 cursor-text items-center gap-1 rounded-lg border border-input bg-background px-2.5 transition-[border-color,box-shadow] duration-150 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15"
                    ref={inputAreaRef}
                    onClick={() => inputRef.current?.focus()}
                >
                    <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {chips.map((chip, i) => (
                        <Badge key={`${chip.field}-${chip.value}-${i}`} variant="outline" className="h-6 shrink-0 gap-1 rounded-md px-1.5 font-normal">
                            <span className="text-[0.62rem] font-bold uppercase tracking-wide text-primary">{chip.field}</span>
                            <span className="text-xs font-medium text-foreground">{chip.value}</span>
                            <button
                                className="ml-0.5 rounded-sm text-muted-foreground hover:text-destructive"
                                type="button"
                                onClick={(e) => { e.stopPropagation(); removeChip(i); }}
                                aria-label={`Remove ${chip.field}:${chip.value} filter`}
                            >×</button>
                        </Badge>
                    ))}
                    {freeText && (
                        <Badge variant="outline" className="h-6 shrink-0 gap-1 rounded-md px-1.5 font-normal">
                            <span className="text-xs font-medium text-foreground">{freeText}</span>
                            <button
                                className="ml-0.5 rounded-sm text-muted-foreground hover:text-destructive"
                                type="button"
                                onClick={(e) => { e.stopPropagation(); onFreeTextChange(''); }}
                                aria-label="Remove free text search"
                            >×</button>
                        </Badge>
                    )}
                    <label className="sr-only" htmlFor={inputId}>Search projects and add structured filters</label>
                    <Input
                        id={inputId}
                        ref={inputRef}
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
                        className="h-9 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
                    />
                    {hasAnyFilter && (
                        <button
                            type="button"
                            className="shrink-0 rounded-sm p-1 text-muted-foreground hover:text-destructive"
                            onClick={onClearAll}
                            title="Clear all filters"
                            aria-label="Clear all filters"
                        >
                            <X className="h-4 w-4" />
                        </button>
                    )}
                </div>

                {/* Filter triggers */}
                <div className="flex flex-wrap items-center gap-1.5">
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
                    <label className={`flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors${expiringSoonOnly ? ' border-primary/40 bg-primary/5' : ' border-input bg-background'}`}>
                        <input
                            type="number"
                            className="w-12 bg-transparent text-xs outline-none"
                            min={1}
                            max={365}
                            value={expiringSoonDays}
                            onChange={(e) => onExpiringSoonDaysChange(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="Expiring soon days"
                        />
                        <span className="text-xs text-muted-foreground">day expiry</span>
                        <input
                            type="checkbox"
                            className="accent-primary"
                            checked={expiringSoonOnly}
                            onChange={onToggleExpiringSoon}
                            aria-label="Expiring soon filter"
                        />
                    </label>

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
            <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-muted-foreground">
                    <strong className="font-semibold text-foreground">{resultCount}</strong> results
                </span>
                <span className="hidden text-xs text-muted-foreground md:inline">Click row to inspect · Space selects · J/K moves</span>
                {hasAnyFilter && (
                    <Button type="button" variant="ghost" size="sm" onClick={onClearAll}>
                        Clear all filters
                    </Button>
                )}
            </div>

            {/* ── Active filter chips ─────────────────────────────── */}
            {activeFilterChips.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                    {activeFilterChips.map((chip) => (
                        <Badge
                            key={chip.id}
                            variant="outline"
                            className="h-7 gap-0.5 rounded-full pr-1 font-medium"
                        >
                            <span className="pl-1">{chip.label}</span>
                            <button
                                type="button"
                                className="rounded-full p-0.5 leading-none hover:bg-foreground/15"
                                onClick={chip.onRemove}
                                aria-label={`Remove ${chip.label} filter`}
                            >×</button>
                        </Badge>
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

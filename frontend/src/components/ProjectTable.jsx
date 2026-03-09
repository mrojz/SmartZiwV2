import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import ContextMenu from './ContextMenu';
import SmartSearch from './SmartSearch';
import { Table } from '@/components/application/table/table';

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

function formatDisplayDate(value) {
  if (!value) return '-';
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    const day = String(direct.getDate()).padStart(2, '0');
    const month = String(direct.getMonth() + 1).padStart(2, '0');
    const year = direct.getFullYear();
    return `${day}/${month}/${year}`;
  }
  const parts = String(value).split('/');
  if (parts.length === 3) {
    const [month, day, year] = parts;
    return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
  }
  return value;
}

function formatPlaceLabel(value) {
  if (!value) return '-';
  return String(value)
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((part) => {
      if (!part) return part;
      if (part === part.toUpperCase()) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

function sourceClass(source) {
  const s = (source || '').toLowerCase();
  if (s.includes('iadb')) return 'iadb';
  if (s.includes('world bank')) return 'wb';
  if (s.includes('global')) return 'gt';
  if (s.includes('giz')) return 'giz';
  if (s.includes('development')) return 'devaid';
  if (s.includes('dgmarket')) return 'dgm';
  if (s.includes('africa')) return 'ag';
  return '';
}

function getProjectBaseKey(project) {
  return [
    project?.source || '',
    project?.project_id || '',
    project?.project_url || '',
    project?.document_url || '',
    project?.project_name || '',
    project?.project_description || '',
    project?.project_sponsor || '',
    project?.project_end_date || '',
  ].join('::');
}

function getProjectRowId(project, fallbackIndex = -1) {
  return project?.__rowId || `${getProjectBaseKey(project)}__fallback_${fallbackIndex}`;
}

const ADVANCED_QUERY_FIELDS = [
  { key: 'source', label: 'source:', desc: 'Data source' },
  { key: 'decision', label: 'decision:', desc: 'Go / No Go / Undecided' },
  { key: 'region', label: 'region:', desc: 'Region name' },
  { key: 'continent', label: 'continent:', desc: 'Continent' },
  { key: 'verified', label: 'verified:', desc: 'Verified / Unverified' },
  { key: 'country', label: 'country:', desc: 'Country / sponsor' },
  { key: 'signals', label: 'signals:', desc: 'Matched signal keyword' },
  { key: 'published_date', label: 'published_date:', desc: 'Published date' },
  { key: 'deadline', label: 'deadline:', desc: 'Effective deadline' },
  { key: 'last_scraped', label: 'last_scraped:', desc: 'Scraped date' },
  { key: 'id', label: 'id:', desc: 'Project ID' },
];

function quoteAdvancedValue(value) {
  return /\s/.test(String(value || '')) ? `"${value}"` : String(value || '');
}

function getAdvancedQueryContext(text, caret) {
  const beforeCaret = String(text || '').slice(0, caret);
  const valueMatch = beforeCaret.match(/([a-z_][a-z0-9_]*)\s*:\s*(?:"([^"]*)|([^\s()]*))$/i);
  if (valueMatch) {
    const fullMatch = valueMatch[0];
    const rawField = String(valueMatch[1] || '').toLowerCase();
    const quotedPartial = valueMatch[2];
    const plainPartial = valueMatch[3];
    const partial = quotedPartial ?? plainPartial ?? '';
    return {
      phase: 'value',
      field: rawField,
      partial: partial.toLowerCase(),
      quoted: quotedPartial !== undefined,
      replaceStart: beforeCaret.length - partial.length,
      segmentStart: beforeCaret.length - fullMatch.length,
    };
  }

  const fieldMatch = beforeCaret.match(/(?:^|[\s(])(?:AND|OR|NOT)?\s*([a-z_][a-z0-9_]*)$/i);
  if (fieldMatch) {
    const partial = fieldMatch[1] || '';
    return {
      phase: 'field',
      partial: partial.toLowerCase(),
      replaceStart: beforeCaret.length - partial.length,
    };
  }

  return { phase: 'none', partial: '', replaceStart: caret };
}

function AdvancedQueryInput({
  value,
  onChange,
  error,
  sources,
  regions,
  continents,
  projects,
}) {
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  const [caret, setCaret] = useState(String(value || '').length);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const valueMap = useMemo(() => {
    const countries = new Set();
    const keywords = new Set();
    const ids = new Set();
    const publishedDates = new Set();
    const deadlines = new Set();
    const scrapedDates = new Set();

    (projects || []).forEach((project) => {
      (project.country_names_en || []).forEach((name) => name && countries.add(name));
      (project.country_names_fr || []).forEach((name) => name && countries.add(name));
      if (!(project.country_names_en || []).length && !(project.country_names_fr || []).length && project.project_sponsor) {
        countries.add(project.project_sponsor);
      }
      String(project.matched_keywords || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item) => keywords.add(item));
      if (project.project_id) ids.add(project.project_id);
      if (project.project_start_date) publishedDates.add(formatDisplayDate(project.project_start_date));
      const deadlineValue = project.effective_deadline || project.manual_deadline || project.scraped_deadline || project.project_end_date;
      if (deadlineValue) deadlines.add(formatDisplayDate(deadlineValue));
      if (project.scraped_at) scrapedDates.add(formatDisplayDate(project.scraped_at));
    });

    return {
      source: [...new Set((sources || []).filter(Boolean))].sort(),
      decision: ['Go', 'No Go', 'Undecided'],
      region: Object.keys(regions || {}).sort(),
      continent: (continents || []).map((item) => item.name_en).filter(Boolean).sort(),
      verified: ['Verified', 'Unverified'],
      country: [...countries].sort(),
      signals: [...keywords].sort(),
      published_date: [...publishedDates].sort(),
      deadline: [...deadlines].sort(),
      last_scraped: [...scrapedDates].sort(),
      id: [...ids].sort(),
    };
  }, [sources, regions, continents, projects]);

  const context = useMemo(() => getAdvancedQueryContext(value, caret), [value, caret]);

  const suggestions = useMemo(() => {
    if (context.phase === 'field') {
      const query = context.partial;
      return ADVANCED_QUERY_FIELDS
        .filter((field) => !query || field.key.startsWith(query))
        .map((field) => ({
          type: 'field',
          label: field.label,
          desc: field.desc,
          insertValue: `${field.key}:`,
        }));
    }

    if (context.phase === 'value') {
      const options = valueMap[context.field] || [];
      const query = context.partial;
      return options
        .filter((option) => !query || String(option).toLowerCase().includes(query))
        .slice(0, 12)
        .map((option) => ({
          type: 'value',
          label: String(option),
          desc: context.field,
          insertValue: quoteAdvancedValue(option),
        }));
    }

    return [];
  }, [context, valueMap]);

  useEffect(() => {
    setSelectedIndex(0);
    setOpen(suggestions.length > 0 && (context.phase === 'field' || context.phase === 'value'));
  }, [suggestions.length, context.phase]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const commitSuggestion = useCallback((suggestion) => {
    const text = String(value || '');
    const before = text.slice(0, context.replaceStart);
    const after = text.slice(caret);
    const nextValue = `${before}${suggestion.insertValue}${after}`;
    const nextCaret = before.length + suggestion.insertValue.length;
    onChange(nextValue);
    setOpen(false);
    requestAnimationFrame(() => {
      if (!inputRef.current) return;
      inputRef.current.focus();
      inputRef.current.setSelectionRange(nextCaret, nextCaret);
      setCaret(nextCaret);
    });
  }, [value, context.replaceStart, caret, onChange]);

  const updateCaret = useCallback((event) => {
    const nextCaret = event.target.selectionStart ?? String(event.target.value || '').length;
    setCaret(nextCaret);
  }, []);

  const handleKeyDown = (event) => {
    event.stopPropagation();

    if (open && suggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        commitSuggestion(suggestions[selectedIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        return;
      }
    }

    if (event.key === 'Escape') {
      event.stopPropagation();
    }
  };

  return (
    <div className="advanced-query-editor" ref={wrapperRef}>
      <input
        ref={inputRef}
        type="text"
        name="advancedQuery"
        aria-label="Advanced filter query"
        className={`advanced-query-input ${error ? 'has-error' : ''}`}
        placeholder='source:DGMarket AND decision:"No Go"'
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          updateCaret(event);
        }}
        onClick={updateCaret}
        onKeyUp={updateCaret}
        onSelect={updateCaret}
        onFocus={() => setOpen(suggestions.length > 0)}
        onKeyDown={handleKeyDown}
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      {open && suggestions.length > 0 ? (
        <div className="advanced-query-dropdown">
          {suggestions.map((suggestion, index) => (
            <button
              key={`${suggestion.type}-${suggestion.label}-${index}`}
              type="button"
              className={`advanced-query-option ${index === selectedIndex ? 'is-selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                commitSuggestion(suggestion);
              }}
            >
              <span className={`advanced-query-option-label ${suggestion.type === 'field' ? 'is-field' : ''}`}>{suggestion.label}</span>
              <span className="advanced-query-option-desc">{suggestion.desc}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function ProjectTable({
  projects,
  allProjects,
  onDecisionChange,
  onDelete,
  onBulkDelete,
  regions,
  chips,
  onChipsChange,
  freeText,
  onFreeTextChange,
  advancedQuery,
  onAdvancedQueryChange,
  advancedQueryEnabled,
  onAdvancedQueryEnabledChange,
  advancedQueryError,
  source,
  onSourceChange,
  verified,
  onVerifiedChange,
  sources,
  region,
  onRegionChange,
  continent,
  onContinentChange,
  continents,
  decision,
  onDecisionChangeFilter,
  deadlineFrom,
  deadlineTo,
  onDeadlineFromChange,
  onDeadlineToChange,
  scrapedFrom,
  scrapedTo,
  onScrapedFromChange,
  onScrapedToChange,
  onClearFilters,
  onProjectSelect,
  activeProjectId,
  onClearActiveProject,
}) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [openHeaderFilter, setOpenHeaderFilter] = useState(null);
  const [filtersCollapsed, setFiltersCollapsed] = useState(() => {
    try {
      return sessionStorage.getItem('pw_filters_collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [deadlineDraft, setDeadlineDraft] = useState({ from: deadlineFrom, to: deadlineTo });
  const [scrapedDraft, setScrapedDraft] = useState({ from: scrapedFrom, to: scrapedTo });
  const headerFilterRef = useRef(null);
  const headerCheckboxRef = useRef(null);

  useEffect(() => {
    setPage(0);
    setSelectedRowIds(new Set());
    setLastSelectedIndex(null);
    setFocusedRowIndex(null);
  }, [projects.length]);


  useEffect(() => {
    setDeadlineDraft({ from: deadlineFrom, to: deadlineTo });
  }, [deadlineFrom, deadlineTo]);

  useEffect(() => {
    setScrapedDraft({ from: scrapedFrom, to: scrapedTo });
  }, [scrapedFrom, scrapedTo]);

  useEffect(() => {
    try {
      sessionStorage.setItem('pw_filters_collapsed', filtersCollapsed ? '1' : '0');
    } catch {
      // Ignore sessionStorage access issues.
    }
  }, [filtersCollapsed]);

  useEffect(() => {
    if (!openHeaderFilter) return undefined;
    const handlePointerDown = (event) => {
      if (headerFilterRef.current && !headerFilterRef.current.contains(event.target)) {
        setOpenHeaderFilter(null);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [openHeaderFilter]);

  const countryToRegion = useMemo(() => {
    const map = {};
    Object.entries(regions || {}).forEach(([regionName, countries]) => {
      countries.forEach((c) => {
        map[String(c).toLowerCase()] = regionName;
      });
    });
    return map;
  }, [regions]);

  const getRegion = useCallback((sponsor) => {
    if (!sponsor) return '-';
    const lower = String(sponsor).toLowerCase();
    for (const [country, regionName] of Object.entries(countryToRegion)) {
      if (lower.includes(country)) return regionName;
    }
    return '-';
  }, [countryToRegion]);

  const columns = [
    { key: '_select', label: '', type: 'none' },
    { key: '_project', label: 'Project', type: 'string' },
    { key: '_region', label: 'Region', type: 'string' },
    { key: '_published', label: 'Published Date', type: 'date' },
    { key: '_deadline', label: 'Deadline', type: 'date' },
    { key: 'matched_keywords', label: 'Signals', type: 'string' },
    { key: '_decision', label: 'Decision', type: 'string' },
    { key: '_verification', label: 'Verification', type: 'string' },
    { key: 'scraped_at', label: 'Last scraped', type: 'date' },
    { key: '_actions', label: '', type: 'none' },
  ];

  const parseDate = (str) => {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length === 3) return new Date(parts[2], parts[0] - 1, parts[1]);
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const getSortValue = useCallback((p, colKey) => {
    switch (colKey) {
      case '_project':
        return p.project_name || p.project_description || '';
      case '_region':
        return p.project_sponsor || '';
      case '_published':
        return p.project_start_date || '';
      case '_deadline':
        return p.effective_deadline || p.manual_deadline || p.scraped_deadline || p.project_end_date || '';
      case '_decision': {
        const dScore = p.decision === 'Go' ? 2 : p.decision === 'No Go' ? 0 : 1;
        const vScore = p.ai_verified === 'Yes' ? 1 : 0;
        return `${dScore}${vScore}`;
      }
      case '_verification':
        return p.ai_verified === 'Yes' ? 'verified' : 'unverified';
      default:
        return p[colKey] || '';
    }
  }, []);

  const sorted = useMemo(() => {
    if (!sortCol) return projects;
    const col = columns.find((c) => c.key === sortCol);
    if (!col || col.type === 'none') return projects;

    return [...projects].sort((a, b) => {
      const valA = getSortValue(a, sortCol);
      const valB = getSortValue(b, sortCol);
      let cmp = 0;
      if (col.type === 'date') {
        const dA = parseDate(valA);
        const dB = parseDate(valB);
        cmp = (dA || new Date(0)) - (dB || new Date(0));
      } else {
        cmp = String(valA).localeCompare(String(valB), undefined, { sensitivity: 'base' });
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [projects, sortCol, sortDir, getSortValue]);

  const allProjectRowIds = useMemo(() => allProjects.map((project, index) => getProjectRowId(project, index)), [allProjects]);
  const getRowIdByIndex = useCallback((index) => {
    const project = allProjects[index];
    return getProjectRowId(project, index);
  }, [allProjects]);
  const projectIndexByRowId = useMemo(() => {
    const map = new Map();
    allProjects.forEach((project, index) => {
      map.set(getProjectRowId(project, index), index);
    });
    return map;
  }, [allProjects]);

  const totalPages = Math.ceil(sorted.length / rowsPerPage);
  const pageData = sorted.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const startItem = sorted.length === 0 ? 0 : page * rowsPerPage + 1;
  const endItem = Math.min((page + 1) * rowsPerPage, sorted.length);

  const sortDescriptor = sortCol
    ? { column: sortCol, direction: sortDir === 'asc' ? 'ascending' : 'descending' }
    : undefined;
  const tableBodyKey = useMemo(() => {
    const selectedKey = Array.from(selectedRowIds).sort().join('|');
    return `${page}:${rowsPerPage}:${selectedKey}:${focusedRowIndex ?? ''}:${activeProjectId ?? ''}`;
  }, [selectedRowIds, focusedRowIndex, activeProjectId, page, rowsPerPage]);

  const handleSortChange = (descriptor) => {
    setSortCol(descriptor?.column ? String(descriptor.column) : null);
    setSortDir(descriptor?.direction === 'descending' ? 'desc' : 'asc');
  };

  const visibleRowIds = useMemo(() => pageData.map((project) => {
    const directRowId = project?.__rowId;
    const realIndex = directRowId ? (projectIndexByRowId.get(directRowId) ?? allProjects.indexOf(project)) : allProjects.indexOf(project);
    return getProjectRowId(project, realIndex);
  }), [pageData, projectIndexByRowId, allProjects]);
  const visibleSelectedCount = useMemo(() => visibleRowIds.filter((rowId) => selectedRowIds.has(rowId)).length, [visibleRowIds, selectedRowIds]);
  const allOnPageSelected = visibleRowIds.length > 0 && visibleSelectedCount === visibleRowIds.length;
  const someOnPageSelected = visibleSelectedCount > 0 && visibleSelectedCount < visibleRowIds.length;

  useEffect(() => {
    if (!headerCheckboxRef.current) return;
    headerCheckboxRef.current.indeterminate = someOnPageSelected;
  }, [someOnPageSelected]);

  const toggleSelectAll = () => {
    const next = new Set(selectedRowIds);
    if (allOnPageSelected) {
      visibleRowIds.forEach((rowId) => next.delete(rowId));
    } else {
      visibleRowIds.forEach((rowId) => next.add(rowId));
    }
    setSelectedRowIds(next);
    if (pageData[0]) setLastSelectedIndex(allProjects.indexOf(pageData[0]));
  };

  const toggleSelectRow = (project, realIndex, isRange = false) => {
    const next = new Set(selectedRowIds);
    const projectKey = getProjectRowId(project, realIndex);
    if (isRange && lastSelectedIndex !== null) {
      const [start, end] = [lastSelectedIndex, realIndex].sort((a, b) => a - b);
      for (let i = start; i <= end; i += 1) {
        const rangeProject = allProjects[i];
        if (rangeProject) next.add(getProjectRowId(rangeProject, i));
      }
    } else if (next.has(projectKey)) {
      next.delete(projectKey);
    } else {
      next.add(projectKey);
    }
    setSelectedRowIds(next);
    setLastSelectedIndex(realIndex);
  };

  const handleBulkDecision = (nextDecision) => {
    allProjects.forEach((project, idx) => {
      if (selectedRowIds.has(getProjectRowId(project, idx))) onDecisionChange(idx, nextDecision);
    });
    setSelectedRowIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selectedRowIds.size} selected project${selectedRowIds.size === 1 ? '' : 's'}?`)) return;
    const selectedProjects = allProjects.filter((project, idx) => selectedRowIds.has(getProjectRowId(project, idx)));
    if (onBulkDelete) {
      await onBulkDelete(selectedProjects);
      setSelectedRowIds(new Set());
      return;
    }
    const indices = selectedProjects
      .map((project) => allProjects.indexOf(project))
      .filter((idx) => idx >= 0)
      .sort((a, b) => b - a);
    indices.forEach((idx) => onDelete?.(allProjects[idx], idx));
    setSelectedRowIds(new Set());
  };

  const hasAnyFilter = chips?.length > 0 || freeText || source || region || continent || verified || decision || deadlineFrom || deadlineTo || scrapedFrom || scrapedTo || (advancedQueryEnabled && advancedQuery.trim());
  const activeFilters = [
    source ? { key: 'source', label: `Source: ${source}`, clear: () => onSourceChange('') } : null,
    region ? { key: 'region', label: `Region: ${region}`, clear: () => onRegionChange('') } : null,
    continent ? { key: 'continent', label: `Continent: ${continent}`, clear: () => onContinentChange('') } : null,
    verified ? { key: 'verified', label: `AI: ${verified === 'Yes' ? 'Verified' : 'Not verified'}`, clear: () => onVerifiedChange('') } : null,
    decision ? { key: 'decision', label: `Decision: ${decision}`, clear: () => onDecisionChangeFilter('') } : null,
    deadlineFrom || deadlineTo ? { key: 'deadline', label: `Deadline: ${formatDisplayDate(deadlineFrom) === '-' ? 'Any' : formatDisplayDate(deadlineFrom)} to ${formatDisplayDate(deadlineTo) === '-' ? 'Any' : formatDisplayDate(deadlineTo)}`, clear: () => { onDeadlineFromChange(''); onDeadlineToChange(''); } } : null,
    scrapedFrom || scrapedTo ? { key: 'scraped', label: `Last scraped: ${formatDisplayDate(scrapedFrom) === '-' ? 'Any' : formatDisplayDate(scrapedFrom)} to ${formatDisplayDate(scrapedTo) === '-' ? 'Any' : formatDisplayDate(scrapedTo)}`, clear: () => { onScrapedFromChange(''); onScrapedToChange(''); } } : null,
    advancedQueryEnabled && advancedQuery.trim() ? { key: 'advancedQuery', label: 'Advanced logic active', clear: () => { onAdvancedQueryChange(''); onAdvancedQueryEnabledChange(false); } } : null,
  ].filter(Boolean);
  const collapsedSummary = [
    freeText ? `Search: ${freeText}` : null,
    chips.length ? `${chips.length} structured filter${chips.length === 1 ? '' : 's'}` : null,
    activeFilters.length ? `${activeFilters.length} dropdown/date filter${activeFilters.length === 1 ? '' : 's'} active` : null,
    advancedQueryEnabled && advancedQuery.trim() ? `Logic: ${advancedQuery}` : null,
  ].filter(Boolean);

  const openProject = useCallback((project, realIndex) => {
    setFocusedRowIndex(realIndex);
    onProjectSelect?.(project, realIndex);
  }, [onProjectSelect]);

  const handleRowClick = useCallback((event, project, realIndex) => {
    const target = event.target;
    if (
      target instanceof Element
      && target.closest('button, a, input, select, textarea, [role="button"], [role="menu"], [role="menuitem"], .td-checkbox, .td-actions, .context-trigger, .context-menu')
    ) {
      return;
    }
    openProject(project, realIndex);
  }, [openProject]);

  useEffect(() => {
    if (!pageData.length || focusedRowIndex !== null) return;
    setFocusedRowIndex(allProjects.indexOf(pageData[0]));
  }, [pageData, allProjects, focusedRowIndex]);

  const handleTableKeyDown = (e) => {
    const target = e.target;
    const activeElement = document.activeElement;
    const editorIsActive = (element) => element instanceof Element
      && element.closest('.smart-search, .advanced-query-editor, input, textarea, select, [contenteditable="true"]');
    if (editorIsActive(target) || editorIsActive(activeElement)) return;
    if (!pageData.length) return;
    const realIndexes = pageData
      .map((item) => {
        const directRowId = item?.__rowId;
        if (directRowId && projectIndexByRowId.has(directRowId)) return projectIndexByRowId.get(directRowId);
        return allProjects.indexOf(item);
      })
      .filter((index) => index >= 0);
    if (!realIndexes.length) return;
    const fallbackIndex = realIndexes[0];
    const currentIndex = focusedRowIndex !== null && realIndexes.includes(focusedRowIndex) ? focusedRowIndex : fallbackIndex;
    const currentPosition = Math.max(realIndexes.indexOf(currentIndex), 0);

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelectedRowIds(new Set(visibleRowIds));
      setLastSelectedIndex(realIndexes[realIndexes.length - 1] || null);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      setSelectedRowIds(new Set());
      onClearActiveProject?.();
      return;
    }

    if (e.key.toLowerCase() === 'j') {
      e.preventDefault();
      setFocusedRowIndex(realIndexes[Math.min(currentPosition + 1, realIndexes.length - 1)]);
      return;
    }

    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setFocusedRowIndex(realIndexes[Math.max(currentPosition - 1, 0)]);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      openProject(pageData[currentPosition], realIndexes[currentPosition]);
      return;
    }

    if (e.key === ' ') {
      e.preventDefault();
      const currentProject = allProjects[currentIndex];
      if (currentProject) toggleSelectRow(currentProject, currentIndex, e.shiftKey);
    }
  };


  const applyHeaderFilter = (key) => {
    if (key === '_deadline') {
      onDeadlineFromChange(deadlineDraft.from);
      onDeadlineToChange(deadlineDraft.to);
    }
    if (key === 'scraped_at') {
      onScrapedFromChange(scrapedDraft.from);
      onScrapedToChange(scrapedDraft.to);
    }
    setOpenHeaderFilter(null);
  };

  const clearHeaderFilter = (key) => {
    if (key === '_deadline') {
      setDeadlineDraft({ from: '', to: '' });
      onDeadlineFromChange('');
      onDeadlineToChange('');
    }
    if (key === 'scraped_at') {
      setScrapedDraft({ from: '', to: '' });
      onScrapedFromChange('');
      onScrapedToChange('');
    }
    setOpenHeaderFilter(null);
  };

  const renderHeaderFilter = (key) => {
    const isDeadline = key === '_deadline';
    const isScraped = key === 'scraped_at';
    if (!isDeadline && !isScraped) return null;
    const isOpen = openHeaderFilter === key;
    const draft = isDeadline ? deadlineDraft : scrapedDraft;

    return (
      <div className="column-filter-anchor" ref={isOpen ? headerFilterRef : null}>
        <button
          type="button"
          className={`column-filter-icon-btn ${isOpen ? 'is-open' : ''}`}
          aria-label={isDeadline ? 'Filter deadline' : 'Filter last scraped'}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpenHeaderFilter((prev) => (prev === key ? null : key));
          }}
        >
          ?
        </button>
        {isOpen ? (
          <div className="column-filter-popover" onClick={(event) => event.stopPropagation()}>
            <label className="column-filter-field">
              <span>Start date</span>
              <input
                type="date"
                name={isDeadline ? 'deadlineStart' : 'scrapedStart'}
                aria-label={isDeadline ? 'Deadline start date' : 'Last scraped start date'}
                value={draft.from}
                onChange={(event) => (isDeadline ? setDeadlineDraft((prev) => ({ ...prev, from: event.target.value })) : setScrapedDraft((prev) => ({ ...prev, from: event.target.value })))}
              />
            </label>
            <label className="column-filter-field">
              <span>End date</span>
              <input
                type="date"
                name={isDeadline ? 'deadlineEnd' : 'scrapedEnd'}
                aria-label={isDeadline ? 'Deadline end date' : 'Last scraped end date'}
                value={draft.to}
                onChange={(event) => (isDeadline ? setDeadlineDraft((prev) => ({ ...prev, to: event.target.value })) : setScrapedDraft((prev) => ({ ...prev, to: event.target.value })))}
              />
            </label>
            <div className="column-filter-actions">
              <button type="button" className="column-filter-apply" onClick={() => applyHeaderFilter(key)}>Apply</button>
              <button type="button" className="column-filter-clear-btn" onClick={() => clearHeaderFilter(key)}>Clear</button>
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="table-wrapper table-surface table-workspace" tabIndex={0} onKeyDown={handleTableKeyDown}>
      <div className="table-toolbar table-toolbar-card">
        <div className="table-toolbar-row table-toolbar-row-primary">
          <div className="table-toolbar-primary-copy">
            <div className="table-toolbar-search-wrap">
              <SmartSearch
                chips={chips}
                onChipsChange={onChipsChange}
                freeText={freeText}
                onFreeTextChange={onFreeTextChange}
                projects={allProjects}
                regions={regions}
                continents={continents}
              />
            </div>
            <div className="table-toolbar-meta">
              <span className="toolbar-count"><strong>{projects.length}</strong> results</span>
              <span className="toolbar-hint">Click row to inspect, Space selects, J/K moves</span>
            </div>
          </div>
          <div className="table-toolbar-controls">
            <button
              type="button"
              className={`toolbar-toggle-btn ${advancedQueryEnabled ? 'is-active' : ''}`}
              onClick={() => onAdvancedQueryEnabledChange(!advancedQueryEnabled)}
            >
              <span>Advanced query</span>
            </button>
            <button
              type="button"
              className={`toolbar-toggle-btn toolbar-collapse-btn ${filtersCollapsed ? 'is-collapsed' : ''}`}
              onClick={() => setFiltersCollapsed((prev) => !prev)}
            >
              <span>{filtersCollapsed ? 'Show filters' : 'Hide filters'}</span>
              <span className="toolbar-chevron" aria-hidden="true">⌄</span>
            </button>
          </div>
        </div>
        {filtersCollapsed ? (
          <div className="table-toolbar-row table-toolbar-collapsed-summary">
            {collapsedSummary.length ? collapsedSummary.map((item) => (
              <span key={item} className="collapsed-filter-summary">{item}</span>
            )) : <span className="collapsed-filter-summary is-empty">No active search or filters</span>}
          </div>
        ) : (
          <>
            {advancedQueryEnabled ? (
              <div className="table-toolbar-row table-toolbar-advanced">
                <div className="advanced-query-card">
                <div className="advanced-query-header">
                  <span className="advanced-query-title">Advanced logic</span>
                  <span className="advanced-query-hint">Use AND, OR, NOT, parentheses, and quoted values. Example: (NOT source:DGMarket AND decision:&quot;Go&quot;) OR source:IADB</span>
                </div>
                  <AdvancedQueryInput
                    value={advancedQuery}
                    onChange={onAdvancedQueryChange}
                    error={advancedQueryError}
                    sources={sources}
                    regions={regions}
                    continents={continents}
                    projects={allProjects}
                  />
                  {advancedQueryError ? <div className="advanced-query-error">{advancedQueryError}</div> : null}
                  {!advancedQueryError && advancedQuery.trim() ? <div className="advanced-query-preview">Active logic: {advancedQuery}</div> : null}
                </div>
              </div>
            ) : null}
            <div className="table-toolbar-row table-toolbar-filters">
              <div className="filter-group">
                <span className="filter-group-label">Filters</span>
                <select className="filter-select filter-select-compact" name="sourceFilter" aria-label="Filter by source" value={source} onChange={(e) => onSourceChange(e.target.value)}>
                  <option value="">Source</option>
                  {(sources || []).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <select className="filter-select filter-select-compact" name="regionFilter" aria-label="Filter by region" value={region} onChange={(e) => onRegionChange(e.target.value)}>
                  <option value="">Region</option>
                  {Object.keys(regions || {}).sort().map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <select className="filter-select filter-select-compact" name="continentFilter" aria-label="Filter by continent" value={continent} onChange={(e) => onContinentChange(e.target.value)}>
                  <option value="">Continent</option>
                  {(continents || []).map((item) => <option key={item.code} value={item.name_en}>{item.name_en}</option>)}
                </select>
                <select className="filter-select filter-select-compact" name="verificationFilter" aria-label="Filter by verification status" value={verified} onChange={(e) => onVerifiedChange(e.target.value)}>
                  <option value="">Verification</option>
                  <option value="Yes">Verified</option>
                  <option value="No">Not Verified</option>
                </select>
                <select className="filter-select filter-select-compact" name="decisionFilter" aria-label="Filter by decision" value={decision} onChange={(e) => onDecisionChangeFilter(e.target.value)}>
                  <option value="">Decision</option>
                  <option value="Go">Go</option>
                  <option value="No Go">No Go</option>
                  <option value="Undecided">Undecided</option>
                </select>
              </div>
              {hasAnyFilter ? <button className="clear-btn clear-btn-sm" onClick={onClearFilters}>Clear all</button> : null}
            </div>
            {activeFilters.length > 0 ? (
              <div className="table-toolbar-row table-toolbar-active-filters">
                {activeFilters.map((filter) => (
                  <button key={filter.key} className="active-filter-chip" onClick={filter.clear}>
                    {filter.label}
                    <span aria-hidden="true">x</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {selectedRowIds.size > 0 ? (
        <div className="bulk-action-bar bulk-action-bar-sticky">
          <div className="bulk-primary">
            <span className="bulk-count">{selectedRowIds.size} project{selectedRowIds.size === 1 ? '' : 's'} selected</span>
            <button className="bulk-clear" onClick={toggleSelectAll}>{allOnPageSelected ? 'Unselect visible' : 'Select visible'}</button>
            <button className="bulk-clear" onClick={() => setSelectedRowIds(new Set())}>Clear</button>
          </div>
          <div className="bulk-actions">
            <button className="bulk-btn go" onClick={() => handleBulkDecision('Go')}>Mark Go</button>
            <button className="bulk-btn nogo" onClick={() => handleBulkDecision('No Go')}>Mark No Go</button>
            <button className="bulk-btn delete" onClick={() => { void handleBulkDelete(); }}>Delete</button>
          </div>
        </div>
      ) : null}

      <Table aria-label="Projects table" className="app-table projects-table" sortDescriptor={sortDescriptor} onSortChange={handleSortChange}>
        <Table.Header columns={columns}>
          {(col) => (
            <Table.Head id={col.key} isRowHeader={col.key === '_project'} allowsSorting={col.type !== 'none'} className={`${col.key === '_select' ? 'th-checkbox' : ''} ${col.key === '_actions' ? 'th-actions' : ''} ${col.key === '_deadline' ? 'th-has-date-filter' : ''} ${col.key === 'scraped_at' ? 'th-has-date-filter th-scraped-filter' : ''}`}>
              <div className="th-content th-content-with-filter">
                {col.key === '_select' ? <input ref={headerCheckboxRef} type="checkbox" name="selectVisibleRows" aria-label="Select all visible rows" checked={allOnPageSelected} aria-checked={someOnPageSelected ? 'mixed' : allOnPageSelected} className={someOnPageSelected ? 'is-indeterminate' : ''} onClick={(e) => e.stopPropagation()} onChange={toggleSelectAll} title="Select all visible rows" /> : <><span>{col.label}</span>{renderHeaderFilter(col.key)}</>}
              </div>
            </Table.Head>
          )}
        </Table.Header>

        <Table.Body key={tableBodyKey} items={pageData}>
          {(p) => {
            const realIndex = p?.__rowId ? (projectIndexByRowId.get(p.__rowId) ?? allProjects.indexOf(p)) : allProjects.indexOf(p);
            const rowId = getProjectRowId(p, realIndex);
            const isSelected = selectedRowIds.has(rowId);
            const isVerified = p.ai_verified === 'Yes';
            const displayName = p.project_name || p.project_description || '-';
            const regionName = p.primary_region_name || getRegion(p.project_sponsor);
            const sponsorLabel = formatPlaceLabel(p.project_sponsor || '-');
            const regionLabel = regionName !== '-' ? formatPlaceLabel(regionName) : '-';
            const rowEntityId = p.project_id || p.project_name || '';

            return (
              <Table.Row
                id={rowId}
                columns={columns}
                onClick={(event) => handleRowClick(event, p, realIndex)}
                className={`clickable-row ${p.decision === 'No Go' ? 'row-nogo' : ''} ${isSelected ? 'row-selected' : ''} ${rowEntityId && activeProjectId === rowEntityId ? 'row-active-view' : ''} ${focusedRowIndex === realIndex ? 'row-focused' : ''}`}
              >
                {(columnKey) => {
                  const key = typeof columnKey === 'string' ? columnKey : (columnKey?.key || columnKey?.id || '');

                  if (key === '_select') {
                    return (
                      <Table.Cell
                        className="td-checkbox"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (e.target instanceof Element && e.target.closest('input')) return;
                          toggleSelectRow(p, realIndex, e.shiftKey);
                        }}
                      >
                        <input
                          type="checkbox"
                          name={`select-${rowId}`}
                          aria-label={`Select ${displayName}`}
                          checked={isSelected}
                          aria-checked={isSelected}
                          className={isSelected ? 'is-checked' : ''}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => toggleSelectRow(p, realIndex, e.nativeEvent.shiftKey)}
                        />
                      </Table.Cell>
                    );
                  }

                  if (key === '_project') {
                    return (
                      <Table.Cell className="td-project">
                        <div className="project-cell">
                          <span className="project-cell-name" title={displayName}>{displayName}</span>
                          <span className="project-cell-meta">
                            <span className="project-cell-id">{p.project_id}</span>
                            <span className={`badge badge-source badge-source-sm ${sourceClass(p.source)}`}>{p.source}</span>
                          </span>
                        </div>
                      </Table.Cell>
                    );
                  }

                  if (key === '_region') {
                    return (
                      <Table.Cell className="td-country td-region">
                        <div className="country-cell">
                          <span className="country-cell-name">{sponsorLabel}</span>
                          {regionLabel !== '-' ? <span className="country-cell-region">{regionLabel}</span> : null}
                        </div>
                      </Table.Cell>
                    );
                  }

                  if (key === '_published') {
                    return <Table.Cell className="td-timeline">{formatDisplayDate(p.project_start_date)}</Table.Cell>;
                  }

                  if (key === '_deadline') {
                    return <Table.Cell className="td-timeline">{formatDisplayDate(p.effective_deadline || p.manual_deadline || p.scraped_deadline || p.project_end_date)}</Table.Cell>;
                  }

                  if (key === 'matched_keywords') {
                    return (
                      <Table.Cell className="td-keywords">
                        {p.matched_keywords ? (() => {
                          const kws = p.matched_keywords.split(',').map((k) => k.trim()).filter(Boolean);
                          const shown = kws.slice(0, 2);
                          const remaining = kws.length - shown.length;
                          return (
                            <>
                              {shown.map((kw) => <span key={kw} className="keyword-tag">{kw}</span>)}
                              {remaining > 0 ? <span className="keyword-tag keyword-more" title={kws.slice(2).join(', ')}>+{remaining}</span> : null}
                            </>
                          );
                        })() : <span className="text-muted">-</span>}
                      </Table.Cell>
                    );
                  }

                  if (key === '_decision') {
                    return (
                      <Table.Cell className="td-status">
                        <div className="status-cell">
                          <span className={`status-dot ${p.decision === 'Go' ? 'status-dot-positive' : p.decision === 'No Go' ? 'status-dot-negative' : isVerified ? 'status-dot-warning' : 'status-dot-neutral'}`} title={isVerified ? 'AI Verified' : 'Not Verified'} />
                          {p.decision ? <span className={`status-badge ${p.decision === 'Go' ? 'status-go' : 'status-nogo'}`}>{p.decision}</span> : <span className="status-badge status-pending">Pending</span>}
                        </div>
                      </Table.Cell>
                    );
                  }

                  if (key === '_verification') {
                    return (
                      <Table.Cell className="td-verification">
                        <span className={`verification-chip ${isVerified ? 'is-verified' : 'is-unverified'}`}>{isVerified ? 'Verified' : 'Unverified'}</span>
                      </Table.Cell>
                    );
                  }

                  if (key === 'scraped_at') {
                    return <Table.Cell className="td-scraped" title={p.scraped_at ? new Date(p.scraped_at).toLocaleString() : ''}>{formatDisplayDate(p.scraped_at)}</Table.Cell>;
                  }

                  return (
                    <Table.Cell className="td-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="context-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          setContextMenu({ rect, project: p, realIndex });
                        }}
                        title="Actions"
                      >
                        ...
                      </button>
                    </Table.Cell>
                  );
                }}
              </Table.Row>
            );
          }}
        </Table.Body>
      </Table>

      {pageData.length === 0 ? (
        <div className="table-empty-state">
          <div className="table-empty-inner">
            <h3>No tenders match your filters</h3>
            <p>Try adjusting your search or filters</p>
          </div>
        </div>
      ) : null}

      {sorted.length > 0 ? (
        <div className="pagination-bar">
          <div className="pagination-info">Showing <strong>{startItem}-{endItem}</strong> of <strong>{sorted.length}</strong></div>
          <div className="pagination-controls">
            <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(0)} title="First page">{'<<'}</button>
            <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page">{'<'}</button>
            <span className="pagination-pages">Page <strong>{page + 1}</strong> of <strong>{totalPages}</strong></span>
            <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Next page">{'>'}</button>
            <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Last page">{'>>'}</button>
          </div>
          <div className="pagination-size">
            <label>Rows:</label>
            <select name="projectRowsPerPage" aria-label="Projects rows per page" value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }}>
              {ROWS_PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        </div>
      ) : null}

      {contextMenu ? (
        <ContextMenu
          anchorRect={contextMenu.rect}
          onClose={() => setContextMenu(null)}
          items={[
            {
              icon: 'G',
              label: contextMenu.project.decision === 'Go' ? 'Undo Go' : 'Mark as Go',
              active: contextMenu.project.decision === 'Go',
              onClick: () => onDecisionChange(contextMenu.realIndex, contextMenu.project.decision === 'Go' ? '' : 'Go'),
            },
            {
              icon: 'N',
              label: contextMenu.project.decision === 'No Go' ? 'Undo No Go' : 'Mark as No Go',
              active: contextMenu.project.decision === 'No Go',
              onClick: () => onDecisionChange(contextMenu.realIndex, contextMenu.project.decision === 'No Go' ? '' : 'No Go'),
            },
            { divider: true },
            ...(contextMenu.project.project_url ? [{ icon: 'O', label: 'Open Project', onClick: () => window.open(contextMenu.project.project_url, '_blank') }] : []),
            ...(contextMenu.project.document_url ? [{ icon: 'D', label: 'Open Document', onClick: () => window.open(contextMenu.project.document_url, '_blank') }] : []),
            { divider: true },
            {
              icon: 'X',
              label: 'Delete',
              danger: true,
              onClick: () => {
                const name = contextMenu.project.project_name || contextMenu.project.project_description || 'this project';
                if (window.confirm(`Delete "${name.slice(0, 60)}"?`)) onDelete?.(contextMenu.project, contextMenu.realIndex);
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}

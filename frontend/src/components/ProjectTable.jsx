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

export default function ProjectTable({
  projects,
  allProjects,
  onDecisionChange,
  onDelete,
  regions,
  chips,
  onChipsChange,
  freeText,
  onFreeTextChange,
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

  const allProjectRowIds = useMemo(() => {
    const seen = new Map();
    return allProjects.map((project) => {
      const baseKey = getProjectBaseKey(project);
      const occurrence = (seen.get(baseKey) || 0) + 1;
      seen.set(baseKey, occurrence);
      return `${baseKey}__${occurrence}`;
    });
  }, [allProjects]);

  const getRowIdByIndex = useCallback((index) => allProjectRowIds[index] || `row__${index}`, [allProjectRowIds]);

  const totalPages = Math.ceil(sorted.length / rowsPerPage);
  const pageData = sorted.slice(page * rowsPerPage, (page + 1) * rowsPerPage);
  const startItem = sorted.length === 0 ? 0 : page * rowsPerPage + 1;
  const endItem = Math.min((page + 1) * rowsPerPage, sorted.length);

  const sortDescriptor = sortCol
    ? { column: sortCol, direction: sortDir === 'asc' ? 'ascending' : 'descending' }
    : undefined;

  const handleSortChange = (descriptor) => {
    setSortCol(descriptor?.column ? String(descriptor.column) : null);
    setSortDir(descriptor?.direction === 'descending' ? 'desc' : 'asc');
  };

  const visibleRowIds = useMemo(() => pageData.map((project) => getRowIdByIndex(allProjects.indexOf(project))), [pageData, allProjects, getRowIdByIndex]);
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
    const projectKey = getRowIdByIndex(realIndex);
    if (isRange && lastSelectedIndex !== null) {
      const [start, end] = [lastSelectedIndex, realIndex].sort((a, b) => a - b);
      for (let i = start; i <= end; i += 1) {
        const rangeProject = allProjects[i];
        if (rangeProject) next.add(getRowIdByIndex(i));
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
      if (selectedRowIds.has(getRowIdByIndex(idx))) onDecisionChange(idx, nextDecision);
    });
    setSelectedRowIds(new Set());
  };

  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${selectedRowIds.size} selected project${selectedRowIds.size === 1 ? '' : 's'}?`)) return;
    const indices = allProjects
      .map((project, idx) => (selectedRowIds.has(getRowIdByIndex(idx)) ? idx : -1))
      .filter((idx) => idx >= 0)
      .sort((a, b) => b - a);
    indices.forEach((idx) => onDelete?.(idx));
    setSelectedRowIds(new Set());
  };

  const hasAnyFilter = chips?.length > 0 || freeText || source || region || continent || verified || decision || deadlineFrom || deadlineTo || scrapedFrom || scrapedTo;
  const activeFilters = [
    source ? { key: 'source', label: `Source: ${source}`, clear: () => onSourceChange('') } : null,
    region ? { key: 'region', label: `Region: ${region}`, clear: () => onRegionChange('') } : null,
    continent ? { key: 'continent', label: `Continent: ${continent}`, clear: () => onContinentChange('') } : null,
    verified ? { key: 'verified', label: `AI: ${verified === 'Yes' ? 'Verified' : 'Not verified'}`, clear: () => onVerifiedChange('') } : null,
    decision ? { key: 'decision', label: `Decision: ${decision}`, clear: () => onDecisionChangeFilter('') } : null,
    deadlineFrom || deadlineTo ? { key: 'deadline', label: `Deadline: ${formatDisplayDate(deadlineFrom) === '-' ? 'Any' : formatDisplayDate(deadlineFrom)} to ${formatDisplayDate(deadlineTo) === '-' ? 'Any' : formatDisplayDate(deadlineTo)}`, clear: () => { onDeadlineFromChange(''); onDeadlineToChange(''); } } : null,
    scrapedFrom || scrapedTo ? { key: 'scraped', label: `Last scraped: ${formatDisplayDate(scrapedFrom) === '-' ? 'Any' : formatDisplayDate(scrapedFrom)} to ${formatDisplayDate(scrapedTo) === '-' ? 'Any' : formatDisplayDate(scrapedTo)}`, clear: () => { onScrapedFromChange(''); onScrapedToChange(''); } } : null,
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
    const searchIsActive = (target instanceof Element && target.closest('.smart-search'))
      || (activeElement instanceof Element && activeElement.closest('.smart-search'));
    if (searchIsActive) return;
    if (!pageData.length) return;
    const realIndexes = pageData.map((item) => allProjects.indexOf(item));
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
                value={draft.from}
                onChange={(event) => (isDeadline ? setDeadlineDraft((prev) => ({ ...prev, from: event.target.value })) : setScrapedDraft((prev) => ({ ...prev, from: event.target.value })))}
              />
            </label>
            <label className="column-filter-field">
              <span>End date</span>
              <input
                type="date"
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
          <SmartSearch
            chips={chips}
            onChipsChange={onChipsChange}
            freeText={freeText}
            onFreeTextChange={onFreeTextChange}
            projects={allProjects}
            regions={regions}
            continents={continents}
          />
          <div className="table-toolbar-meta">
            <span className="toolbar-count"><strong>{projects.length}</strong> results</span>
            <span className="toolbar-hint">Click row to inspect, Space selects, J/K moves</span>
          </div>
        </div>
        <div className="table-toolbar-row table-toolbar-filters">
          <div className="filter-group">
            <span className="filter-group-label">Filters</span>
            <select className="filter-select filter-select-compact" value={source} onChange={(e) => onSourceChange(e.target.value)}>
              <option value="">Source</option>
              {(sources || []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="filter-select filter-select-compact" value={region} onChange={(e) => onRegionChange(e.target.value)}>
              <option value="">Region</option>
              {Object.keys(regions || {}).sort().map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <select className="filter-select filter-select-compact" value={continent} onChange={(e) => onContinentChange(e.target.value)}>
              <option value="">Continent</option>
              {(continents || []).map((item) => <option key={item.code} value={item.name_en}>{item.name_en}</option>)}
            </select>
            <select className="filter-select filter-select-compact" value={verified} onChange={(e) => onVerifiedChange(e.target.value)}>
              <option value="">Verification</option>
              <option value="Yes">Verified</option>
              <option value="No">Not Verified</option>
            </select>
            <select className="filter-select filter-select-compact" value={decision} onChange={(e) => onDecisionChangeFilter(e.target.value)}>
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
            <button className="bulk-btn delete" onClick={handleBulkDelete}>Delete</button>
          </div>
        </div>
      ) : null}

      <Table aria-label="Projects table" className="app-table projects-table" sortDescriptor={sortDescriptor} onSortChange={handleSortChange}>
        <Table.Header columns={columns}>
          {(col) => (
            <Table.Head id={col.key} isRowHeader={col.key === '_project'} allowsSorting={col.type !== 'none'} className={`${col.key === '_select' ? 'th-checkbox' : ''} ${col.key === '_actions' ? 'th-actions' : ''} ${col.key === '_deadline' ? 'th-has-date-filter' : ''} ${col.key === 'scraped_at' ? 'th-has-date-filter th-scraped-filter' : ''}`}>
              <div className="th-content th-content-with-filter">
                {col.key === '_select' ? <input ref={headerCheckboxRef} type="checkbox" checked={allOnPageSelected} aria-checked={someOnPageSelected ? 'mixed' : allOnPageSelected} className={someOnPageSelected ? 'is-indeterminate' : ''} onClick={(e) => e.stopPropagation()} onChange={toggleSelectAll} title="Select all visible rows" /> : <><span>{col.label}</span>{renderHeaderFilter(col.key)}</>}
              </div>
            </Table.Head>
          )}
        </Table.Header>

        <Table.Body items={pageData}>
          {(p) => {
            const realIndex = allProjects.indexOf(p);
            const rowId = getRowIdByIndex(realIndex);
            const isSelected = selectedRowIds.has(rowId);
            const isVerified = p.ai_verified === 'Yes';
            const displayName = p.project_name || p.project_description || '-';
            const regionName = p.primary_region_name || getRegion(p.project_sponsor);
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
                      <Table.Cell className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={isSelected} aria-checked={isSelected} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleSelectRow(p, realIndex, e.nativeEvent.shiftKey)} />
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
                          <span className="country-cell-name">{p.project_sponsor || '-'}</span>
                          {regionName !== '-' ? <span className="country-cell-region">{regionName}</span> : null}
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
            <select value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }}>
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
                if (window.confirm(`Delete "${name.slice(0, 60)}"?`)) onDelete?.(contextMenu.realIndex);
              },
            },
          ]}
        />
      ) : null}
    </div>
  );
}

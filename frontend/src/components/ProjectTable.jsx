import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import ContextMenu from './ContextMenu';
import UnifiedSearchBar from './UnifiedSearchBar';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

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

function initials(name = '', email = '') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (String(email || '?')[0] || '?').toUpperCase();
}

function CommentSignalIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="project-row-signal-icon">
      <path d="M5.5 5.5h9a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9.7l-3.2 2.4c-.5.4-1.2 0-.9-.7l.6-1.7H5.5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AttachmentSignalIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="project-row-signal-icon">
      <path d="M7.4 10.8 11.9 6.3a2.6 2.6 0 1 1 3.7 3.7l-5.8 5.8a4 4 0 1 1-5.6-5.6l6.3-6.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  expiringSoonOnly,
  expiringSoonDays,
  onToggleExpiringSoon,
  onExpiringSoonDaysChange,
  savedSearches,
  onSaveCurrentSearch,
  onApplySavedSearch,
  onDeleteSavedSearch,
  canManageDecision,
  onProjectSelect,
  activeProjectId,
  onClearActiveProject,
  autoFilterActive,
  onClearAutoFilter,
  onStartDemo,
}) {
  const [sortCol, setSortCol] = useState('scraped_at');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selectedRowIds, setSelectedRowIds] = useState(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState(null);
  const [focusedRowIndex, setFocusedRowIndex] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const headerCheckboxRef = useRef(null);

  useEffect(() => {
    setPage(0);
    setSelectedRowIds(new Set());
    setLastSelectedIndex(null);
    setFocusedRowIndex(null);
  }, [projects.length]);


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
    { key: '_project_id', label: 'Project ID', type: 'string' },
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
      case '_project_id':
        return p.project_id || '';
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

  const handleSortClick = (key) => {
    if (sortCol !== key) handleSortChange({ column: key, direction: 'ascending' });
    else handleSortChange({ column: key, direction: sortDir === 'asc' ? 'descending' : 'ascending' });
  };

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
    if (!canManageDecision) return;
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
      && element.closest('.usb-search-area, input, textarea, select, [contenteditable="true"]');
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


  return (
    <div className="space-y-4" tabIndex={0} onKeyDown={handleTableKeyDown}>
      <UnifiedSearchBar
        chips={chips}
        onChipsChange={onChipsChange}
        freeText={freeText}
        onFreeTextChange={onFreeTextChange}
        source={source}
        onSourceChange={onSourceChange}
        sources={sources}
        region={region}
        onRegionChange={onRegionChange}
        regions={regions}
        continent={continent}
        onContinentChange={onContinentChange}
        continents={continents}
        verified={verified}
        onVerifiedChange={onVerifiedChange}
        decision={decision}
        onDecisionChange={onDecisionChangeFilter}
        deadlineFrom={deadlineFrom}
        deadlineTo={deadlineTo}
        onDeadlineFromChange={onDeadlineFromChange}
        onDeadlineToChange={onDeadlineToChange}
        scrapedFrom={scrapedFrom}
        scrapedTo={scrapedTo}
        onScrapedFromChange={onScrapedFromChange}
        onScrapedToChange={onScrapedToChange}
        expiringSoonOnly={expiringSoonOnly}
        expiringSoonDays={expiringSoonDays}
        onToggleExpiringSoon={onToggleExpiringSoon}
        onExpiringSoonDaysChange={onExpiringSoonDaysChange}
        savedSearches={savedSearches}
        onSaveCurrentSearch={onSaveCurrentSearch}
        onApplySavedSearch={onApplySavedSearch}
        onDeleteSavedSearch={onDeleteSavedSearch}
        resultCount={projects.length}
        onClearAll={onClearFilters}
        allProjects={allProjects}
        autoFilterActive={autoFilterActive}
        onClearAutoFilter={onClearAutoFilter}
      />

      {selectedRowIds.size > 0 ? (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{selectedRowIds.size} project{selectedRowIds.size === 1 ? '' : 's'} selected</span>
            <Button type="button" variant="ghost" size="sm" onClick={toggleSelectAll}>{allOnPageSelected ? 'Unselect visible' : 'Select visible'}</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedRowIds(new Set())}>Clear</Button>
          </div>
          <div className="flex items-center gap-2">
            {canManageDecision ? <Button type="button" size="sm" className="bg-green-700 text-white hover:bg-green-800" onClick={() => handleBulkDecision('Go')}>Mark Go</Button> : null}
            {canManageDecision ? <Button type="button" size="sm" variant="outline" className="text-red-700 hover:bg-red-50 hover:text-red-700" onClick={() => handleBulkDecision('No Go')}>Mark No Go</Button> : null}
            <Button type="button" size="sm" variant="destructive" onClick={() => { void handleBulkDelete(); }}>Delete</Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border bg-card shadow-sm">

        <Table aria-label="Projects table" className="app-table projects-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  className={`${col.key === '_select' ? 'th-checkbox' : ''} ${col.key === '_actions' ? 'th-actions' : ''} ${col.key === '_deadline' ? 'th-has-date-filter' : ''} ${col.key === 'scraped_at' ? 'th-has-date-filter th-scraped-filter' : ''} ${col.type !== 'none' ? 'cursor-pointer select-none' : ''}`}
                  aria-sort={sortCol === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  onClick={col.type !== 'none' ? () => handleSortClick(col.key) : undefined}
                >
                  {col.key === '_select' ? (
                    <input ref={headerCheckboxRef} type="checkbox" name="selectVisibleRows" aria-label="Select all visible rows" checked={allOnPageSelected} aria-checked={someOnPageSelected ? 'mixed' : allOnPageSelected} className={someOnPageSelected ? 'is-indeterminate' : ''} onClick={(e) => e.stopPropagation()} onChange={toggleSelectAll} title="Select all visible rows" />
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      {col.label}
                      {col.type !== 'none' ? (
                        sortCol === col.key
                          ? (sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                          : <ArrowUpDown className="h-3 w-3 opacity-60" />
                      ) : null}
                    </span>
                  )}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>

          <TableBody key={tableBodyKey}>
            {pageData.map((p) => {
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
                <TableRow
                  key={rowId}
                  onClick={(event) => handleRowClick(event, p, realIndex)}
                  className={`clickable-row ${p.decision === 'No Go' ? 'row-nogo' : ''} ${isSelected ? 'row-selected' : ''} ${rowEntityId && activeProjectId === rowEntityId ? 'row-active-view' : ''} ${focusedRowIndex === realIndex ? 'row-focused' : ''}`}
                >
                  {columns.map((columnKey) => {
                    const key = typeof columnKey === 'string' ? columnKey : (columnKey?.key || columnKey?.id || '');

                    if (key === '_select') {
                      return (
                        <TableCell
                          key={key}
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
                        </TableCell>
                      );
                    }

                    if (key === '_project') {
                      const assignedUsers = p.assigned_users || [];
                      return (
                        <TableCell key={key} className="td-project">
                          <div className="project-cell">
                            <span className="project-cell-name" title={displayName}>{displayName}</span>
                            <span className="project-cell-meta">
                              <Badge variant="outline" className={`badge badge-source badge-source-sm ${sourceClass(p.source)}`}>{p.source}</Badge>
                            </span>
                            <div className="project-row-signals">
                              {(p.comment_count || 0) > 0 ? (
                                <span className="project-row-signal" title="Comments">
                                  <CommentSignalIcon />
                                  <span>{p.comment_count || 0}</span>
                                </span>
                              ) : null}
                              {(p.comment_document_count || 0) > 0 ? (
                                <span className="project-row-signal" title="Comment attachments">
                                  <AttachmentSignalIcon />
                                  <span>{p.comment_document_count || 0}</span>
                                </span>
                              ) : null}
                              {assignedUsers.length ? (
                                <span className="project-row-assignees" title={assignedUsers.map((user) => user.name || user.email).join(', ')}>
                                  <span className="project-row-assignees-label">Working on</span>
                                  <span className="project-row-assignee-stack">
                                    {assignedUsers.slice(0, 3).map((user) => (
                                      <span key={user.id} className="project-row-assignee" aria-label={user.name || user.email}>
                                        {initials(user.name || '', user.email || '')}
                                      </span>
                                    ))}
                                    {assignedUsers.length > 3 ? <span className="project-row-assignee project-row-assignee-more">+{assignedUsers.length - 3}</span> : null}
                                  </span>
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                      );
                    }

                    if (key === '_project_id') {
                      return (
                        <TableCell key={key} className="td-project-id">
                          <span className="project-id-value" title={p.project_id || ''}>{p.project_id || '-'}</span>
                        </TableCell>
                      );
                    }

                    if (key === '_region') {
                      return (
                        <TableCell key={key} className="td-country td-region">
                          <div className="country-cell">
                            <span className="country-cell-name">{sponsorLabel}</span>
                            {regionLabel !== '-' ? <span className="country-cell-region">{regionLabel}</span> : null}
                          </div>
                        </TableCell>
                      );
                    }

                    if (key === '_published') {
                      return <TableCell key={key} className="td-timeline">{formatDisplayDate(p.project_start_date)}</TableCell>;
                    }

                    if (key === '_deadline') {
                      return <TableCell key={key} className="td-timeline">{formatDisplayDate(p.effective_deadline || p.manual_deadline || p.scraped_deadline || p.project_end_date)}</TableCell>;
                    }

                    if (key === 'matched_keywords') {
                      return (
                        <TableCell key={key} className="td-keywords">
                          {p.matched_keywords ? (() => {
                            const kws = p.matched_keywords.split(',').map((k) => k.trim()).filter(Boolean);
                            const shown = kws.slice(0, 2);
                            const remaining = kws.length - shown.length;
                            return (
                              <>
                                {shown.map((kw) => <Badge key={kw} variant="outline" className="m-0.5 font-medium">{kw}</Badge>)}
                                {remaining > 0 ? <Badge variant="secondary" className="m-0.5 font-medium" title={kws.slice(2).join(', ')}>+{remaining}</Badge> : null}
                              </>
                            );
                          })() : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                      );
                    }

                    if (key === '_decision') {
                      return (
                        <TableCell key={key} className="td-status">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.decision === 'Go' ? 'bg-green-600' : p.decision === 'No Go' ? 'bg-red-600' : isVerified ? 'bg-amber-600' : 'bg-muted-foreground/40'}`}
                              title={isVerified ? 'AI Verified' : 'Not Verified'}
                            />
                            {p.decision ? (
                              <Badge className={p.decision === 'Go' ? 'bg-green-700 text-white' : 'bg-red-700 text-white'}>{p.decision}</Badge>
                            ) : (
                              <Badge className="bg-amber-600 text-white">Pending</Badge>
                            )}
                          </div>
                        </TableCell>
                      );
                    }

                    if (key === '_verification') {
                      return (
                        <TableCell key={key} className="td-verification">
                          {isVerified ? (
                            <Badge className="bg-green-700 text-white">Verified</Badge>
                          ) : (
                            <Badge variant="secondary">Unverified</Badge>
                          )}
                        </TableCell>
                      );
                    }

                    if (key === 'scraped_at') {
                      return <TableCell key={key} className="td-scraped" title={p.scraped_at ? new Date(p.scraped_at).toLocaleString() : ''}>{formatDisplayDate(p.scraped_at)}</TableCell>;
                    }

                    return (
                      <TableCell key={key} className="td-actions" onClick={(e) => e.stopPropagation()}>
                        {p.project_url ? (
                          <button
                            className="context-trigger context-trigger-open"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(p.project_url, '_blank');
                            }}
                            title="Open project"
                          >
                            {'->'}
                          </button>
                        ) : null}
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
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>

        {pageData.length === 0 ? (
          <div className="border-t px-6 py-16 text-center">
            <h3 className="text-lg font-semibold">No tenders match your filters</h3>
            <p className="mt-1 text-sm text-muted-foreground">Try adjusting your search or filters</p>
            {onStartDemo ? (
              <Button type="button" variant="outline" className="mt-4" onClick={onStartDemo}>
                Show me around
              </Button>
            ) : null}
          </div>
        ) : null}

        {sorted.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <span className="text-sm text-muted-foreground">Showing <strong className="font-semibold text-foreground">{startItem}-{endItem}</strong> of <strong className="font-semibold text-foreground">{sorted.length}</strong></span>
            <div className="flex items-center gap-1">
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(0)} title="First page">{'<<'}</Button>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page">{'<'}</Button>
              <span className="px-2 text-sm text-muted-foreground">Page <strong className="font-semibold text-foreground">{page + 1}</strong> of <strong className="font-semibold text-foreground">{totalPages}</strong></span>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Next page">{'>'}</Button>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Last page">{'>>'}</Button>
            </div>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">Rows:
              <select name="projectRowsPerPage" aria-label="Projects rows per page" value={rowsPerPage} onChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }} className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none">
                {ROWS_PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
        ) : null}
      </div>

      {contextMenu ? (
        <ContextMenu
          anchorRect={contextMenu.rect}
          onClose={() => setContextMenu(null)}
          items={[
            ...(canManageDecision ? [{
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
            { divider: true }] : []),
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

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import ContextMenu from './ContextMenu';
import UnifiedSearchBar from './UnifiedSearchBar';
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
}) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
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
    <div className="table-wrapper table-surface table-workspace" tabIndex={0} onKeyDown={handleTableKeyDown}>
      <div className="table-toolbar table-toolbar-card">
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
        />
      </div>

      {selectedRowIds.size > 0 ? (
        <div className="bulk-action-bar bulk-action-bar-sticky">
          <div className="bulk-primary">
            <span className="bulk-count">{selectedRowIds.size} project{selectedRowIds.size === 1 ? '' : 's'} selected</span>
            <button className="bulk-clear" onClick={toggleSelectAll}>{allOnPageSelected ? 'Unselect visible' : 'Select visible'}</button>
            <button className="bulk-clear" onClick={() => setSelectedRowIds(new Set())}>Clear</button>
          </div>
          <div className="bulk-actions">
            {canManageDecision ? <button className="bulk-btn go" onClick={() => handleBulkDecision('Go')}>Mark Go</button> : null}
            {canManageDecision ? <button className="bulk-btn nogo" onClick={() => handleBulkDecision('No Go')}>Mark No Go</button> : null}
            <button className="bulk-btn delete" onClick={() => { void handleBulkDelete(); }}>Delete</button>
          </div>
        </div>
      ) : null}

      <Table aria-label="Projects table" className="app-table projects-table" sortDescriptor={sortDescriptor} onSortChange={handleSortChange}>
        <Table.Header columns={columns}>
          {(col) => (
            <Table.Head id={col.key} isRowHeader={col.key === '_project'} allowsSorting={col.type !== 'none'} className={`${col.key === '_select' ? 'th-checkbox' : ''} ${col.key === '_actions' ? 'th-actions' : ''} ${col.key === '_deadline' ? 'th-has-date-filter' : ''} ${col.key === 'scraped_at' ? 'th-has-date-filter th-scraped-filter' : ''}`}>
              <div className="th-content th-content-with-filter">
                {col.key === '_select' ? <input ref={headerCheckboxRef} type="checkbox" name="selectVisibleRows" aria-label="Select all visible rows" checked={allOnPageSelected} aria-checked={someOnPageSelected ? 'mixed' : allOnPageSelected} className={someOnPageSelected ? 'is-indeterminate' : ''} onClick={(e) => e.stopPropagation()} onChange={toggleSelectAll} title="Select all visible rows" /> : <span>{col.label}</span>}
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
                    const assignedUsers = p.assigned_users || [];
                    return (
                      <Table.Cell className="td-project">
                        <div className="project-cell">
                          <span className="project-cell-name" title={displayName}>{displayName}</span>
                          <span className="project-cell-meta">
                            <span className="project-cell-id">{p.project_id}</span>
                            <span className={`badge badge-source badge-source-sm ${sourceClass(p.source)}`}>{p.source}</span>
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

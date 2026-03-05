import { useState, useMemo, useCallback } from 'react';
import ContextMenu from './ContextMenu';
import SmartSearch from './SmartSearch';
import { Table } from '@/components/application/table/table';

const ROWS_PER_PAGE_OPTIONS = [25, 50, 100];

function relativeTime(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
  decision,
  onDecisionChangeFilter,
  startDateFrom,
  onStartDateFromChange,
  startDateTo,
  onStartDateToChange,
  endDateFrom,
  onEndDateFromChange,
  endDateTo,
  onEndDateToChange,
  onClearFilters,
  onProjectSelect,
  activeProjectId,
}) {
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [showStartFilter, setShowStartFilter] = useState(false);
  const [showEndFilter, setShowEndFilter] = useState(false);

  const projectsKey = projects.length;
  const [prevKey, setPrevKey] = useState(projectsKey);
  if (projectsKey !== prevKey) {
    setPage(0);
    setPrevKey(projectsKey);
    setSelectedRows(new Set());
  }

  const countryToRegion = useMemo(() => {
    const map = {};
    Object.entries(regions || {}).forEach(([regionName, countries]) => {
      countries.forEach((c) => {
        map[c.toLowerCase()] = regionName;
      });
    });
    return map;
  }, [regions]);

  const getRegion = useCallback(
    (sponsor) => {
      if (!sponsor) return '-';
      const lower = sponsor.toLowerCase();
      for (const [country, regionName] of Object.entries(countryToRegion)) {
        if (lower.includes(country)) return regionName;
      }
      return '-';
    },
    [countryToRegion],
  );

  const columns = [
    { key: '_select', label: '', type: 'none', width: '36px' },
    { key: '_project', label: 'Project', type: 'string' },
    { key: '_country', label: 'Country / Region', type: 'string' },
    { key: '_startDate', label: 'Start Date', type: 'date' },
    { key: '_endDate', label: 'End Date', type: 'date' },
    { key: 'matched_keywords', label: 'Keywords', type: 'string' },
    { key: '_decision', label: 'Decision', type: 'string' },
    { key: 'scraped_at', label: 'Scraped', type: 'date' },
    { key: '_actions', label: '', type: 'none', width: '52px' },
  ];

  const parseDate = (str) => {
    if (!str) return null;
    const parts = str.split('/');
    if (parts.length === 3) {
      return new Date(parts[2], parts[0] - 1, parts[1]);
    }
    const d = new Date(str);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const getSortValue = useCallback((p, colKey) => {
    switch (colKey) {
      case '_project':
        return p.project_name || p.project_description || '';
      case '_country':
        return p.project_sponsor || '';
      case '_startDate':
        return p.project_start_date || '';
      case '_endDate':
        return p.project_end_date || '';
      case '_decision': {
        const dScore = p.decision === 'Go' ? 2 : p.decision === 'No Go' ? 0 : 1;
        const vScore = p.ai_verified === 'Yes' ? 1 : 0;
        return `${dScore}${vScore}`;
      }
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

  const allOnPageSelected =
    pageData.length > 0 && pageData.every((p) => selectedRows.has(allProjects.indexOf(p)));

  const toggleSelectAll = () => {
    const next = new Set(selectedRows);
    if (allOnPageSelected) {
      pageData.forEach((p) => next.delete(allProjects.indexOf(p)));
    } else {
      pageData.forEach((p) => next.add(allProjects.indexOf(p)));
    }
    setSelectedRows(next);
  };

  const toggleSelectRow = (realIndex) => {
    const next = new Set(selectedRows);
    if (next.has(realIndex)) next.delete(realIndex);
    else next.add(realIndex);
    setSelectedRows(next);
  };

  const handleBulkDecision = (nextDecision) => {
    selectedRows.forEach((idx) => onDecisionChange(idx, nextDecision));
    setSelectedRows(new Set());
  };

  const handleBulkDelete = () => {
    if (!window.confirm(`Delete ${selectedRows.size} selected project${selectedRows.size === 1 ? '' : 's'}?`)) {
      return;
    }
    const indices = [...selectedRows].sort((a, b) => b - a);
    indices.forEach((idx) => onDelete?.(idx));
    setSelectedRows(new Set());
  };

  const hasStartFilter = startDateFrom || startDateTo;
  const hasEndFilter = endDateFrom || endDateTo;
  const hasAnyFilter =
    chips?.length > 0 ||
    freeText ||
    source ||
    verified ||
    decision ||
    startDateFrom ||
    startDateTo ||
    endDateFrom ||
    endDateTo;

  return (
    <div className="table-wrapper table-surface">
      <div className="table-toolbar">
        <div className="table-toolbar-row">
          <SmartSearch
            chips={chips}
            onChipsChange={onChipsChange}
            freeText={freeText}
            onFreeTextChange={onFreeTextChange}
            projects={allProjects}
            regions={regions}
          />
          <span className="toolbar-count">
            <strong>{projects.length}</strong> results
          </span>
        </div>
        <div className="table-toolbar-row table-toolbar-filters">
          <select
            className="filter-select filter-select-compact"
            value={source}
            onChange={(e) => onSourceChange(e.target.value)}
          >
            <option value="">Source</option>
            {(sources || []).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            className="filter-select filter-select-compact"
            value={verified}
            onChange={(e) => onVerifiedChange(e.target.value)}
          >
            <option value="">AI Status</option>
            <option value="Yes">Verified</option>
            <option value="No">Not Verified</option>
          </select>
          <select
            className="filter-select filter-select-compact"
            value={decision}
            onChange={(e) => onDecisionChangeFilter(e.target.value)}
          >
            <option value="">Decision</option>
            <option value="Go">Go</option>
            <option value="No Go">No Go</option>
            <option value="Undecided">Undecided</option>
          </select>
          {hasAnyFilter && (
            <button className="clear-btn clear-btn-sm" onClick={onClearFilters}>
              Clear all
            </button>
          )}
        </div>
      </div>

      {selectedRows.size > 0 && (
        <div className="bulk-action-bar">
          <span className="bulk-count">
            {selectedRows.size} project{selectedRows.size === 1 ? '' : 's'} selected
          </span>
          <div className="bulk-actions">
            <button className="bulk-btn go" onClick={() => handleBulkDecision('Go')}>Mark Go</button>
            <button className="bulk-btn nogo" onClick={() => handleBulkDecision('No Go')}>Mark No Go</button>
            <button className="bulk-btn delete" onClick={handleBulkDelete}>Delete</button>
          </div>
          <button className="bulk-clear" onClick={() => setSelectedRows(new Set())}>Clear</button>
        </div>
      )}

      {(showStartFilter || showEndFilter) && (
        <div className="table-toolbar-row" style={{ marginBottom: 8 }}>
          {showStartFilter && (
            <div className="col-filter-panel">
              <span className="col-filter-label">Start Date range:</span>
              <input
                type="date"
                className="col-filter-date"
                value={startDateFrom}
                onChange={(e) => onStartDateFromChange(e.target.value)}
                placeholder="From"
              />
              <span className="col-filter-sep">to</span>
              <input
                type="date"
                className="col-filter-date"
                value={startDateTo}
                onChange={(e) => onStartDateToChange(e.target.value)}
                placeholder="To"
              />
              {hasStartFilter && (
                <button
                  className="col-filter-clear"
                  onClick={() => {
                    onStartDateFromChange('');
                    onStartDateToChange('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {showEndFilter && (
            <div className="col-filter-panel">
              <span className="col-filter-label">End Date range:</span>
              <input
                type="date"
                className="col-filter-date"
                value={endDateFrom}
                onChange={(e) => onEndDateFromChange(e.target.value)}
                placeholder="From"
              />
              <span className="col-filter-sep">to</span>
              <input
                type="date"
                className="col-filter-date"
                value={endDateTo}
                onChange={(e) => onEndDateToChange(e.target.value)}
                placeholder="To"
              />
              {hasEndFilter && (
                <button
                  className="col-filter-clear"
                  onClick={() => {
                    onEndDateFromChange('');
                    onEndDateToChange('');
                  }}
                >
                  Clear
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <Table
        aria-label="Projects table"
        className="app-table projects-table"
        sortDescriptor={sortDescriptor}
        onSortChange={handleSortChange}
      >
        <Table.Header columns={columns}>
          {(col) => (
            <Table.Head
              id={col.key}
              allowsSorting={col.type !== 'none'}
              className={`${col.key === '_select' ? 'th-checkbox' : ''} ${col.key === '_actions' ? 'th-actions' : ''
                } ${col.key === '_startDate' || col.key === '_endDate' ? 'th-date-col' : ''}`}
            >
              <div className="th-content">
                {col.key === '_select' ? (
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAll}
                    title="Select all on this page"
                  />
                ) : col.label}
                {col.key === '_startDate' && (
                  <button
                    className={`col-filter-toggle ${hasStartFilter ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowStartFilter((v) => !v);
                    }}
                    title="Filter start date"
                  >
                    v
                  </button>
                )}
                {col.key === '_endDate' && (
                  <button
                    className={`col-filter-toggle ${hasEndFilter ? 'active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowEndFilter((v) => !v);
                    }}
                    title="Filter end date"
                  >
                    v
                  </button>
                )}
              </div>
            </Table.Head>
          )}
        </Table.Header>

        <Table.Body items={pageData}>
          {(p) => {
            const realIndex = allProjects.indexOf(p);
            const isSelected = selectedRows.has(realIndex);
            const isVerified = p.ai_verified === 'Yes';
            const displayName = p.project_name || p.project_description || '-';
            const regionName = getRegion(p.project_sponsor);
            const rowEntityId = p.project_id || p.project_name || '';

            return (
              <Table.Row
                id={`${p.project_id || 'row'}-${realIndex}`}
                columns={columns}
                className={`clickable-row ${p.decision === 'No Go' ? 'row-nogo' : ''} ${isSelected ? 'row-selected' : ''
                  } ${rowEntityId && activeProjectId === rowEntityId ? 'row-active-view' : ''}`}
                onClick={() => onProjectSelect?.(p)}
              >
                {(columnKey) => {
                  const key = typeof columnKey === 'string' ? columnKey : (columnKey?.key || columnKey?.id || '');
                  if (key === '_select') {
                    return (
                      <Table.Cell className="td-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectRow(realIndex)}
                        />
                      </Table.Cell>
                    );
                  }

                  if (key === '_project') {
                    return (
                      <Table.Cell
                        className="td-project"
                        onClick={() => {
                          onProjectSelect?.(p);
                        }}
                      >
                        <div className="project-cell">
                          <span className="project-cell-name" title={displayName}>{displayName}</span>
                          <span className="project-cell-meta">
                            <span className="project-cell-id">{p.project_id}</span>
                            <span className={`badge badge-source badge-source-sm ${sourceClass(p.source)}`}>
                              {p.source}
                            </span>
                          </span>
                        </div>
                      </Table.Cell>
                    );
                  }

                  if (key === '_country') {
                    return (
                      <Table.Cell className="td-country">
                        <div className="country-cell">
                          <span className="country-cell-name">{p.project_sponsor || '-'}</span>
                          {regionName !== '-' && <span className="country-cell-region">{regionName}</span>}
                        </div>
                      </Table.Cell>
                    );
                  }

                  if (key === '_startDate') return <Table.Cell className="td-date">{p.project_start_date || '-'}</Table.Cell>;
                  if (key === '_endDate') return <Table.Cell className="td-date">{p.project_end_date || '-'}</Table.Cell>;

                  if (key === 'matched_keywords') {
                    return (
                      <Table.Cell className="td-keywords">
                        {p.matched_keywords ? (
                          (() => {
                            const kws = p.matched_keywords.split(',').map((k) => k.trim()).filter(Boolean);
                            const shown = kws.slice(0, 2);
                            const remaining = kws.length - shown.length;
                            return (
                              <>
                                {shown.map((kw) => (
                                  <span key={kw} className="keyword-tag">{kw}</span>
                                ))}
                                {remaining > 0 && (
                                  <span className="keyword-tag keyword-more" title={kws.slice(2).join(', ')}>
                                    +{remaining}
                                  </span>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          <span className="text-muted">-</span>
                        )}
                      </Table.Cell>
                    );
                  }

                  if (key === '_decision') {
                    return (
                      <Table.Cell className="td-status" onClick={(e) => e.stopPropagation()}>
                        <div className="status-cell">
                          <span
                            className={`status-dot ${p.decision === 'Go'
                                ? 'status-dot-positive'
                                : p.decision === 'No Go'
                                  ? 'status-dot-negative'
                                  : isVerified
                                    ? 'status-dot-warning'
                                    : 'status-dot-neutral'
                              }`}
                            title={isVerified ? 'AI Verified' : 'Not Verified'}
                          />
                          {p.decision ? (
                            <span className={`status-badge ${p.decision === 'Go' ? 'status-go' : 'status-nogo'}`}>
                              {p.decision}
                            </span>
                          ) : (
                            <span className="status-badge status-pending">Pending</span>
                          )}
                        </div>
                      </Table.Cell>
                    );
                  }

                  if (key === 'scraped_at') {
                    return (
                      <Table.Cell className="td-scraped" title={p.scraped_at ? new Date(p.scraped_at).toLocaleString() : ''}>
                        {relativeTime(p.scraped_at)}
                      </Table.Cell>
                    );
                  }

                  return (
                    <Table.Cell className="td-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="context-trigger"
                        onClick={(e) => {
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

      {pageData.length === 0 && (
        <div className="table-empty-state">
          <div className="table-empty-inner">
            <h3>No tenders match your filters</h3>
            <p>Try adjusting your search or filters</p>
          </div>
        </div>
      )}
      {sorted.length > 0 && (
        <div className="pagination-bar">
          <div className="pagination-info">
            Showing <strong>{startItem}-{endItem}</strong> of <strong>{sorted.length}</strong>
          </div>
          <div className="pagination-controls">
            <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(0)} title="First page">{'<<'}</button>
            <button className="pagination-btn" disabled={page === 0} onClick={() => setPage(page - 1)} title="Previous page">{'<'}</button>
            <span className="pagination-pages">
              Page <strong>{page + 1}</strong> of <strong>{totalPages}</strong>
            </span>
            <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)} title="Next page">{'>'}</button>
            <button className="pagination-btn" disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)} title="Last page">{'>>'}</button>
          </div>
          <div className="pagination-size">
            <label>Rows:</label>
            <select
              value={rowsPerPage}
              onChange={(e) => {
                setRowsPerPage(Number(e.target.value));
                setPage(0);
              }}
            >
              {ROWS_PER_PAGE_OPTIONS.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {contextMenu && (
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
            ...(contextMenu.project.project_url
              ? [
                {
                  icon: 'O',
                  label: 'Open Project',
                  onClick: () => window.open(contextMenu.project.project_url, '_blank'),
                },
              ]
              : []),
            ...(contextMenu.project.document_url
              ? [
                {
                  icon: 'D',
                  label: 'Open Document',
                  onClick: () => window.open(contextMenu.project.document_url, '_blank'),
                },
              ]
              : []),
            { divider: true },
            {
              icon: 'X',
              label: 'Delete',
              danger: true,
              onClick: () => {
                const name =
                  contextMenu.project.project_name || contextMenu.project.project_description || 'this project';
                if (window.confirm(`Delete "${name.slice(0, 60)}"?`)) {
                  onDelete?.(contextMenu.realIndex);
                }
              },
            },
          ]}
        />
      )}
    </div>
  );
}




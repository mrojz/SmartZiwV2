export default function FilterBar({
  source,
  onSourceChange,
  verified,
  onVerifiedChange,
  keyword,
  onKeywordChange,
  keywords,
  sources,
  region,
  onRegionChange,
  regions,
  status,
  onStatusChange,
  onClear,
}) {
  const hasFilters = source || verified || keyword || region || status;
  const activeCount = [source, verified, keyword, region, status].filter(Boolean).length;

  return (
    <div className="filter-bar">
      <div className="filter-inner">
        <select
          className="filter-select filter-select-compact"
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
        >
          <option value="">Source</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <select
          className="filter-select filter-select-compact"
          value={region}
          onChange={(e) => onRegionChange(e.target.value)}
        >
          <option value="">Region</option>
          {Object.keys(regions || {}).sort().map((r) => (
            <option key={r} value={r}>{r}</option>
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
          value={status}
          onChange={(e) => onStatusChange(e.target.value)}
        >
          <option value="">Decision</option>
          <option value="Go">Go</option>
          <option value="No Go">No Go</option>
          <option value="Undecided">Undecided</option>
        </select>

        <select
          className="filter-select filter-select-compact"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
        >
          <option value="">Keyword</option>
          {keywords.map((kw) => (
            <option key={kw} value={kw}>{kw}</option>
          ))}
        </select>

        {hasFilters && (
          <button className="clear-btn" onClick={onClear}>
            Clear{activeCount > 0 ? ` (${activeCount})` : ''}
          </button>
        )}
      </div>
    </div>
  );
}

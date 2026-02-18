import SmartSearch from './SmartSearch';

export default function FilterBar({
  chips,
  onChipsChange,
  freeText,
  onFreeTextChange,
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
  onClear,
  projects,
}) {
  const hasFilters = chips.length > 0 || freeText || source || verified || keyword || region;

  return (
    <div className="filter-bar">
      <div className="filter-inner">
        {/* Smart search with autocomplete */}
        <SmartSearch
          chips={chips}
          onChipsChange={onChipsChange}
          freeText={freeText}
          onFreeTextChange={onFreeTextChange}
          projects={projects}
          regions={regions}
        />

        {/* Source */}
        <select
          className="filter-select"
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
        >
          <option value="">All Sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Region */}
        <select
          className="filter-select"
          value={region}
          onChange={(e) => onRegionChange(e.target.value)}
        >
          <option value="">All Regions</option>
          {Object.keys(regions || {}).sort().map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>

        {/* AI Verified */}
        <select
          className="filter-select"
          value={verified}
          onChange={(e) => onVerifiedChange(e.target.value)}
        >
          <option value="">AI Verified: All</option>
          <option value="Yes">✅ Verified</option>
          <option value="No">❌ Not Verified</option>
        </select>

        {/* Keywords */}
        <select
          className="filter-select"
          value={keyword}
          onChange={(e) => onKeywordChange(e.target.value)}
        >
          <option value="">All Keywords</option>
          {keywords.map((kw) => (
            <option key={kw} value={kw}>{kw}</option>
          ))}
        </select>

        {/* Clear */}
        {hasFilters && (
          <button className="clear-btn" onClick={onClear}>
            ✕ Clear
          </button>
        )}
      </div>
    </div>
  );
}

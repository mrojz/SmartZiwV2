import { useState } from 'react';

function sourceClass(source) {
    const s = (source || '').toLowerCase();
    if (s.includes('iadb')) return 'iadb';
    if (s.includes('world bank')) return 'wb';
    if (s.includes('global')) return 'gt';
    if (s.includes('giz')) return 'giz';
    if (s.includes('development')) return 'devaid';
    if (s.includes('dgmarket')) return 'dgm';
    return '';
}

function formatFileSize(bytes) {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extIcon(ext) {
    const e = (ext || '').toLowerCase();
    if (e.includes('pdf')) return '📕';
    if (e.includes('doc')) return '📘';
    if (e.includes('xls')) return '📗';
    if (e.includes('ppt')) return '📙';
    return '📄';
}
const API = '/api';

export default function ProjectDetailModal({ project, onClose, onDecisionChange, index }) {
    const [activeTab, setActiveTab] = useState('overview');

    if (!project) return null;

    const {
        project_id,
        project_name,
        project_description,
        project_start_date,
        project_end_date,
        project_sponsor,
        source,
        original_source,
        document_url,
        project_url,
        matched_keywords,
        ai_verified,
        decision,
        scraped_at,
        documents,
        doc_analysis,
    } = project;

    const isVerified = ai_verified === 'Yes';
    const displayName = project_name || project_description || '—';
    const keywords = matched_keywords
        ? matched_keywords.split(',').map((k) => k.trim()).filter(Boolean)
        : [];

    const hasDocuments = documents && documents.length > 0;
    const hasAnalysis = doc_analysis && Object.keys(doc_analysis).length > 0;

    const tabs = [
        { key: 'overview', label: 'Overview', icon: '📋' },
        { key: 'documents', label: 'Documents', icon: '📎', count: hasDocuments ? documents.length : 0 },
        { key: 'analysis', label: 'AI Analysis', icon: '🤖' },
    ];

    const handleDecision = (value) => {
        const next = decision === value ? '' : value;
        onDecisionChange?.(index, next);
    };

    // Flatten analyses for display
    const analyses = hasAnalysis
        ? doc_analysis.analyses
            ? doc_analysis.analyses
            : [doc_analysis]
        : [];

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="project-modal" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header">
                    <div className="modal-header-top">
                        <div className="modal-badges">
                            <span className={`badge badge-source ${sourceClass(source)}`}>{source}</span>
                            <span className={`badge ${isVerified ? 'badge-verified' : 'badge-unverified'}`}>
                                {isVerified ? '✓ AI Verified' : '✗ Not Verified'}
                            </span>
                            {decision && (
                                <span className={`badge ${decision === 'Go' ? 'badge-go' : 'badge-nogo'}`}>
                                    {decision}
                                </span>
                            )}
                            {original_source && original_source !== 'Unknown' && (
                                <span className="badge badge-origin" title="Original funding source">
                                    🏦 {original_source}
                                </span>
                            )}
                        </div>
                        <button className="modal-close" onClick={onClose} title="Close">✕</button>
                    </div>
                    <h2 className="modal-title">{displayName}</h2>
                    <span className="modal-id">ID: {project_id}</span>
                </div>

                {/* Tabs — always shown */}
                <div className="modal-tabs">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            className={`modal-tab ${activeTab === tab.key ? 'active' : ''}`}
                            onClick={() => setActiveTab(tab.key)}
                        >
                            {tab.icon} {tab.label}
                            {tab.count != null && <span className="tab-count">{tab.count}</span>}
                        </button>
                    ))}
                </div>

                {/* Body */}
                <div className="modal-body">
                    {/* ── Overview Tab ── */}
                    {activeTab === 'overview' && (
                        <div className="modal-overview">
                            {/* Description */}
                            {project_description && project_description !== project_name && (
                                <div className="modal-section">
                                    <h4>Description</h4>
                                    <p className="modal-description-text">{project_description}</p>
                                </div>
                            )}

                            {/* Key Details Grid */}
                            <div className="modal-section">
                                <h4>Details</h4>
                                <div className="detail-grid">
                                    <div className="detail-item">
                                        <span className="detail-label">🌍 Country</span>
                                        <span className="detail-value">{project_sponsor || '—'}</span>
                                    </div>
                                    <div className="detail-item">
                                        <span className="detail-label">📅 Published</span>
                                        <span className="detail-value">{project_start_date || '—'}</span>
                                    </div>
                                    <div className="detail-item">
                                        <span className="detail-label">⏰ Deadline</span>
                                        <span className="detail-value">{project_end_date || '—'}</span>
                                    </div>
                                    <div className="detail-item">
                                        <span className="detail-label">📡 Source</span>
                                        <span className="detail-value">{source || '—'}</span>
                                    </div>
                                    {original_source && original_source !== 'Unknown' && (
                                        <div className="detail-item">
                                            <span className="detail-label">🏦 Original Source</span>
                                            <span className="detail-value">{original_source}</span>
                                        </div>
                                    )}
                                    {scraped_at && (
                                        <div className="detail-item">
                                            <span className="detail-label">🕐 Scraped</span>
                                            <span className="detail-value">
                                                {new Date(scraped_at).toLocaleDateString('en-US', {
                                                    month: 'short', day: 'numeric', year: 'numeric',
                                                    hour: '2-digit', minute: '2-digit',
                                                })}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Keywords */}
                            {keywords.length > 0 && (
                                <div className="modal-section">
                                    <h4>Matched Keywords</h4>
                                    <div className="modal-keywords">
                                        {keywords.map((kw) => (
                                            <span key={kw} className="keyword-tag">{kw}</span>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Links */}
                            <div className="modal-section">
                                <h4>Links</h4>
                                <div className="modal-links">
                                    {project_url && (
                                        <a className="modal-link" href={project_url} target="_blank" rel="noopener noreferrer">
                                            🔗 Project Page
                                        </a>
                                    )}
                                    {document_url && (
                                        <a className="modal-link document" href={document_url} target="_blank" rel="noopener noreferrer">
                                            📄 Document Link
                                        </a>
                                    )}
                                    {!project_url && !document_url && <span className="no-data">No links available</span>}
                                </div>
                            </div>

                            {/* Decision */}
                            <div className="modal-section">
                                <h4>Decision</h4>
                                <div className="modal-decisions">
                                    <button
                                        className={`decision-btn go ${decision === 'Go' ? 'active' : ''}`}
                                        onClick={() => handleDecision('Go')}
                                    >
                                        ✓ Go
                                    </button>
                                    <button
                                        className={`decision-btn nogo ${decision === 'No Go' ? 'active' : ''}`}
                                        onClick={() => handleDecision('No Go')}
                                    >
                                        ✗ No Go
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Documents Tab ── */}
                    {activeTab === 'documents' && (
                        <div className="modal-documents">
                            {hasDocuments ? (
                                <div className="modal-section">
                                    <h4>Downloaded Documents ({documents.length})</h4>
                                    <div className="doc-list">
                                        {documents.map((doc, i) => (
                                            <div key={i} className="doc-item">
                                                <span className="doc-icon">{extIcon(doc.extension)}</span>
                                                <div className="doc-info">
                                                    <span className="doc-name">{doc.title || doc.filename}</span>
                                                    <span className="doc-meta">
                                                        {doc.extension?.toUpperCase().replace('.', '')}
                                                        {doc.size ? ` · ${formatFileSize(doc.size)}` : ''}
                                                    </span>
                                                </div>
                                                <div className="doc-actions">
                                                    {doc.filename && (
                                                        <a
                                                            className="doc-download"
                                                            href={`${API}/documents/${encodeURIComponent(project_id)}/${encodeURIComponent(doc.filename)}`}
                                                            download
                                                            title="Download file"
                                                        >
                                                            ⬇
                                                        </a>
                                                    )}
                                                    {doc.url && (
                                                        <a
                                                            className="doc-download"
                                                            href={doc.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            title="Open original source"
                                                        >
                                                            ↗
                                                        </a>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div className="modal-empty-state">
                                    <span className="empty-icon">📂</span>
                                    <h4>No Documents Scraped</h4>
                                    <p>No documents were found or downloaded for this project. Documents are scraped automatically during sync for AI-verified projects.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── AI Analysis Tab ── */}
                    {activeTab === 'analysis' && (
                        <div className="modal-analysis">
                            {hasAnalysis ? (
                                analyses.map((analysis, aIdx) => (
                                    <div key={aIdx} className="analysis-block">
                                        {analysis.document && analyses.length > 1 && (
                                            <h4 className="analysis-doc-title">{extIcon('.pdf')} {analysis.document}</h4>
                                        )}

                                        {analysis.summary && (
                                            <div className="modal-section">
                                                <h4>📝 Summary</h4>
                                                <p className="analysis-text">{analysis.summary}</p>
                                            </div>
                                        )}

                                        {analysis.requirements?.length > 0 && (
                                            <div className="modal-section">
                                                <h4>📋 Requirements</h4>
                                                <ul className="analysis-list">
                                                    {analysis.requirements.map((r, i) => (
                                                        <li key={i}>{r}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {analysis.phases?.length > 0 && (
                                            <div className="modal-section">
                                                <h4>📊 Phases</h4>
                                                <ul className="analysis-list">
                                                    {analysis.phases.map((ph, i) => (
                                                        <li key={i}>{ph}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {analysis.deliverables?.length > 0 && (
                                            <div className="modal-section">
                                                <h4>📦 Deliverables</h4>
                                                <ul className="analysis-list">
                                                    {analysis.deliverables.map((d, i) => (
                                                        <li key={i}>{d}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {analysis.skills_required?.length > 0 && (
                                            <div className="modal-section">
                                                <h4>🎯 Skills Required</h4>
                                                <div className="modal-keywords">
                                                    {analysis.skills_required.map((s, i) => (
                                                        <span key={i} className="keyword-tag skill">{s}</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {analysis.evaluation_criteria?.length > 0 && (
                                            <div className="modal-section">
                                                <h4>⚖️ Evaluation Criteria</h4>
                                                <ul className="analysis-list">
                                                    {analysis.evaluation_criteria.map((c, i) => (
                                                        <li key={i}>{c}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        <div className="analysis-extras">
                                            {analysis.budget && (
                                                <div className="analysis-extra-item">
                                                    <span className="extra-label">💰 Budget</span>
                                                    <span className="extra-value">{analysis.budget}</span>
                                                </div>
                                            )}
                                            {analysis.eligibility && (
                                                <div className="analysis-extra-item">
                                                    <span className="extra-label">✅ Eligibility</span>
                                                    <span className="extra-value">{analysis.eligibility}</span>
                                                </div>
                                            )}
                                            {analysis.key_dates && (
                                                <>
                                                    {analysis.key_dates.submission_deadline && (
                                                        <div className="analysis-extra-item">
                                                            <span className="extra-label">📅 Submission Deadline</span>
                                                            <span className="extra-value">{analysis.key_dates.submission_deadline}</span>
                                                        </div>
                                                    )}
                                                    {analysis.key_dates.project_start && (
                                                        <div className="analysis-extra-item">
                                                            <span className="extra-label">🚀 Project Start</span>
                                                            <span className="extra-value">{analysis.key_dates.project_start}</span>
                                                        </div>
                                                    )}
                                                    {analysis.key_dates.project_end && (
                                                        <div className="analysis-extra-item">
                                                            <span className="extra-label">🏁 Project End</span>
                                                            <span className="extra-value">{analysis.key_dates.project_end}</span>
                                                        </div>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="modal-empty-state">
                                    <span className="empty-icon">🤖</span>
                                    <h4>No AI Analysis Available</h4>
                                    <p>This project has not been analyzed yet. AI analysis runs automatically during sync for projects with downloaded documents.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

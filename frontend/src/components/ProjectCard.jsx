import { useState } from 'react';
import ProjectDetailModal from './ProjectDetailModal';

function sourceClass(source) {
    const s = (source || '').toLowerCase();
    if (s.includes('iadb')) return 'iadb';
    if (s.includes('world bank')) return 'wb';
    if (s.includes('global')) return 'gt';
    return '';
}

export default function ProjectCard({ project, index, onDecisionChange, onDelete }) {
    const [showModal, setShowModal] = useState(false);
    const {
        project_id,
        project_name,
        project_description,
        project_start_date,
        project_end_date,
        project_sponsor,
        source,
        document_url,
        project_url,
        matched_keywords,
        ai_verified,
        decision,
    } = project;

    const isVerified = ai_verified === 'Yes';
    const displayName = project_name || project_description || '—';
    const keywords = matched_keywords
        ? matched_keywords.split(',').map((k) => k.trim()).filter(Boolean)
        : [];

    const handleDecision = (value) => {
        const next = decision === value ? '' : value;
        onDecisionChange(index, next);
    };

    return (
        <>
            <div
                className={`project-card ${isVerified ? 'verified' : ''} ${decision === 'Go' ? 'decision-go' : decision === 'No Go' ? 'decision-nogo' : ''}`}
                onClick={() => setShowModal(true)}
                style={{ cursor: 'pointer' }}
            >
                <div className="card-header">
                    <span className="card-id">{project_id}</span>
                    <div className="card-badges">
                        {decision && (
                            <span className={`badge ${decision === 'Go' ? 'badge-go' : 'badge-nogo'}`}>
                                {decision}
                            </span>
                        )}
                        <span className={`badge badge-source ${sourceClass(source)}`}>
                            {source}
                        </span>
                        <span className={`badge ${isVerified ? 'badge-verified' : 'badge-unverified'}`}>
                            {isVerified ? '✓ AI' : '✗ AI'}
                        </span>
                    </div>
                </div>

                <h3 className="card-title" title={displayName}>{displayName}</h3>
                <p className="card-description" title={project_description}>{project_description}</p>

                <div className="card-meta">
                    <span className="meta-item">
                        <span className="meta-icon">🌍</span>
                        {project_sponsor || '—'}
                    </span>
                    <span className="meta-item">
                        <span className="meta-icon">📅</span>
                        {project_start_date || '—'}
                    </span>
                    <span className="meta-item">
                        <span className="meta-icon">⏰</span>
                        {project_end_date || '—'}
                    </span>
                </div>

                {keywords.length > 0 && (
                    <div className="card-keywords">
                        {keywords.map((kw) => (
                            <span key={kw} className="keyword-tag">{kw}</span>
                        ))}
                    </div>
                )}

                <div className="card-footer">
                    <div className="card-links">
                        {project_url && (
                            <a className="card-link" href={project_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                                🔗 Project
                            </a>
                        )}
                        {document_url && (
                            <a className="card-link document" href={document_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                                📄 Document
                            </a>
                        )}
                    </div>
                    <div className="card-decisions" onClick={(e) => e.stopPropagation()}>
                        <button
                            className={`decision-btn go ${decision === 'Go' ? 'active' : ''}`}
                            onClick={() => handleDecision('Go')}
                            title="Mark as Go"
                        >
                            ✓ Go
                        </button>
                        <button
                            className={`decision-btn nogo ${decision === 'No Go' ? 'active' : ''}`}
                            onClick={() => handleDecision('No Go')}
                            title="Mark as No Go"
                        >
                            ✗ No Go
                        </button>
                        <button
                            className="decision-btn delete"
                            onClick={() => {
                                if (window.confirm(`Delete "${displayName.slice(0, 60)}"?`)) {
                                    onDelete?.(index);
                                }
                            }}
                            title="Delete project"
                        >
                            🗑
                        </button>
                    </div>
                </div>
            </div>

            {showModal && (
                <ProjectDetailModal
                    project={project}
                    index={index}
                    onClose={() => setShowModal(false)}
                    onDecisionChange={onDecisionChange}
                />
            )}
        </>
    );
}

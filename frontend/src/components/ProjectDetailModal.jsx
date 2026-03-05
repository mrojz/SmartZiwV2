import { createPortal } from 'react-dom';
import { X } from '@untitledui/icons';
import { Button } from '@/components/base/buttons/button';
import { Badge, BadgeWithDot } from '@/components/base/badges/badges';
import type { BadgeTypes } from "@/components/base/badges/badge-types";

function sourceColor(source) {
  const s = (source || '').toLowerCase();
  if (s.includes('iadb')) return 'blue';
  if (s.includes('world bank')) return 'indigo';
  if (s.includes('global')) return 'purple';
  if (s.includes('giz')) return 'orange';
  if (s.includes('development')) return 'success';
  if (s.includes('dgmarket')) return 'pink';
  if (s.includes('africa')) return 'warning';
  return 'gray';
}

export default function ProjectDetailModal({ project, onClose, onDecisionChange, index }) {
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
  } = project;

  const isVerified = ai_verified === 'Yes';
  const displayName = project_name || project_description || '-';
  const keywords = matched_keywords
    ? matched_keywords.split(',').map((k) => k.trim()).filter(Boolean)
    : [];

  const handleDecision = (value) => {
    const next = decision === value ? '' : value;
    onDecisionChange?.(index, next);
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="project-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-top">
            <div className="modal-badges">
              <Badge color={sourceColor(source)}>{source}</Badge>
              <BadgeWithDot color={isVerified ? 'success' : 'gray'}>
                {isVerified ? 'AI Verified' : 'Not Verified'}
              </BadgeWithDot>
              {decision && (
                <Badge color={decision === 'Go' ? 'success' : 'error'}>
                  {decision}
                </Badge>
              )}
              {original_source && original_source !== 'Unknown' && (
                <Badge color="blue" title="Original funding source">
                  {original_source}
                </Badge>
              )}
            </div>
            <Button color="tertiary" size="sm" iconLeading={X} onPress={onClose} aria-label="Close" />
          </div>
          <h2 className="modal-title">{displayName}</h2>
          <span className="modal-id">ID: {project_id}</span>
        </div>

        <div className="modal-body">
          <div className="modal-overview">
            {project_description && project_description !== project_name && (
              <div className="modal-section">
                <h4>Description</h4>
                <p className="modal-description-text">{project_description}</p>
              </div>
            )}

            <div className="modal-section">
              <h4>Details</h4>
              <div className="detail-grid">
                <div className="detail-item">
                  <span className="detail-label">Country</span>
                  <span className="detail-value">{project_sponsor || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Published</span>
                  <span className="detail-value">{project_start_date || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Deadline</span>
                  <span className="detail-value">{project_end_date || '-'}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Source</span>
                  <span className="detail-value">{source || '-'}</span>
                </div>
                {original_source && original_source !== 'Unknown' && (
                  <div className="detail-item">
                    <span className="detail-label">Original Source</span>
                    <span className="detail-value">{original_source}</span>
                  </div>
                )}
                {scraped_at && (
                  <div className="detail-item">
                    <span className="detail-label">Scraped</span>
                    <span className="detail-value">
                      {new Date(scraped_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {keywords.length > 0 && (
              <div className="modal-section">
                <h4>Matched Keywords</h4>
                <div className="modal-keywords">
                  {keywords.map((kw) => (
                    <Badge key={kw} color="brand" size="sm">{kw}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-section">
              <h4>Links</h4>
              <div className="modal-links">
                {project_url && (
                  <a className="modal-link" href={project_url} target="_blank" rel="noopener noreferrer" title={project_url}>
                    {project_url}
                  </a>
                )}
                {document_url && (
                  <a className="modal-link document" href={document_url} target="_blank" rel="noopener noreferrer">
                    Document Link
                  </a>
                )}
                {!project_url && !document_url && <span className="no-data">No links available</span>}
              </div>
            </div>

            <div className="modal-section">
              <h4>Decision</h4>
              <div className="modal-decisions">
                <Button
                  color={decision === 'Go' ? 'primary' : 'secondary'}
                  onPress={() => handleDecision('Go')}
                >
                  Go
                </Button>
                <Button
                  color={decision === 'No Go' ? 'primary-destructive' : 'secondary'}
                  onPress={() => handleDecision('No Go')}
                >
                  No Go
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

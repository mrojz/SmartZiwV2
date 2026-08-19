export function initials(name = '', email = '') {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (email[0] || '?').toUpperCase();
}

export function isImageAttachment(att = {}) {
    const mime = String(att?.mimeType || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    const name = String(att?.originalName || att?.url || '').toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name);
}

export function isPdfAttachment(att = {}) {
    const mime = String(att?.mimeType || '').toLowerCase();
    if (mime === 'application/pdf') return true;
    const name = String(att?.originalName || att?.url || '').toLowerCase();
    return /\.pdf($|\?)/i.test(name);
}

export function normalizeCommentAttachment(raw) {
    if (!raw) return null;

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;
        const normalizedUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/')
            ? trimmed
            : `/${trimmed.replace(/^\.?\//, '')}`;
        const fileName = normalizedUrl.split('/').filter(Boolean).pop() || 'attachment';
        const lowerName = fileName.toLowerCase();
        const mimeType = /\.pdf($|\?)/i.test(lowerName)
            ? 'application/pdf'
            : (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(lowerName) ? `image/${lowerName.split('.').pop().replace('jpg', 'jpeg')}` : '');
        return {
            fileId: normalizedUrl,
            originalName: decodeURIComponent(fileName),
            mimeType,
            url: normalizedUrl,
        };
    }

    const source = raw && typeof raw === 'object' ? raw : {};
    const rawUrl = source.url || source.fileUrl || source.path || source.href || source.link || source.downloadUrl || '';
    const normalizedUrl = rawUrl
        ? (String(rawUrl).startsWith('http://') || String(rawUrl).startsWith('https://') || String(rawUrl).startsWith('/')
            ? String(rawUrl)
            : `/${String(rawUrl).replace(/^\.?\//, '')}`)
        : '';
    const originalName = source.originalName || source.filename || source.fileName || source.name || (normalizedUrl.split('/').filter(Boolean).pop() || 'attachment');
    const mimeType = source.mimeType || source.contentType || source.type || source.fileType || '';

    if (!normalizedUrl && !originalName) return null;

    return {
        ...source,
        fileId: source.fileId || source.id || normalizedUrl || originalName,
        originalName: String(originalName || 'attachment'),
        mimeType: String(mimeType || ''),
        url: normalizedUrl,
    };
}

export function normalizeComment(comment = {}) {
    return {
        ...comment,
        attachments: (Array.isArray(comment.attachments) ? comment.attachments : [])
            .map(normalizeCommentAttachment)
            .filter(Boolean),
    };
}

export function colorFromSeed(seed = '') {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360;
    return `hsl(${hash} 45% 46%)`;
}

export function formatDisplayDate(value) {
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

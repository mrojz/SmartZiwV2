import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    initials,
    isImageAttachment,
    isPdfAttachment,
    normalizeCommentAttachment,
    normalizeComment,
    colorFromSeed,
    formatDisplayDate,
} from './tenderDisplay.js';

describe('initials', () => {
    it('returns two initials for a full name', () => {
        assert.strictEqual(initials('Ada Lovelace'), 'AL');
    });

    it('returns one initial for a single name', () => {
        assert.strictEqual(initials('Ada'), 'A');
    });

    it('falls back to email when name is empty', () => {
        assert.strictEqual(initials('', 'ada@example.com'), 'A');
    });

    it('returns question mark when nothing is provided', () => {
        assert.strictEqual(initials('', ''), '?');
    });
});

describe('isImageAttachment', () => {
    it('detects image by mime type', () => {
        assert.strictEqual(isImageAttachment({ mimeType: 'image/png' }), true);
    });

    it('detects image by file extension', () => {
        assert.strictEqual(isImageAttachment({ originalName: 'photo.jpg' }), true);
        assert.strictEqual(isImageAttachment({ url: 'https://example.com/photo.webp' }), true);
    });

    it('rejects non-image attachments', () => {
        assert.strictEqual(isImageAttachment({ mimeType: 'application/pdf', originalName: 'doc.pdf' }), false);
        assert.strictEqual(isImageAttachment({}), false);
    });
});

describe('isPdfAttachment', () => {
    it('detects PDF by mime type', () => {
        assert.strictEqual(isPdfAttachment({ mimeType: 'application/pdf' }), true);
    });

    it('detects PDF by file extension', () => {
        assert.strictEqual(isPdfAttachment({ originalName: 'report.pdf' }), true);
        assert.strictEqual(isPdfAttachment({ url: 'https://example.com/report.pdf?token=abc' }), true);
    });

    it('rejects non-PDF attachments', () => {
        assert.strictEqual(isPdfAttachment({ mimeType: 'image/png', originalName: 'photo.png' }), false);
        assert.strictEqual(isPdfAttachment({}), false);
    });
});

describe('normalizeCommentAttachment', () => {
    it('normalizes a URL string', () => {
        const result = normalizeCommentAttachment('https://example.com/file.pdf');
        assert.strictEqual(result?.fileId, 'https://example.com/file.pdf');
        assert.strictEqual(result?.url, 'https://example.com/file.pdf');
        assert.strictEqual(result?.originalName, 'file.pdf');
        assert.strictEqual(result?.mimeType, 'application/pdf');
    });

    it('prepends a slash to relative paths', () => {
        const result = normalizeCommentAttachment('uploads/image.png');
        assert.strictEqual(result?.url, '/uploads/image.png');
        assert.strictEqual(result?.mimeType, 'image/png');
    });

    it('normalizes an object attachment', () => {
        const result = normalizeCommentAttachment({
            id: 'att-1',
            url: '/files/report.pdf',
            originalName: 'Annual Report.pdf',
            mimeType: 'application/pdf',
        });
        assert.strictEqual(result?.fileId, 'att-1');
        assert.strictEqual(result?.url, '/files/report.pdf');
        assert.strictEqual(result?.originalName, 'Annual Report.pdf');
        assert.strictEqual(result?.mimeType, 'application/pdf');
    });

    it('returns null for empty input', () => {
        assert.strictEqual(normalizeCommentAttachment(''), null);
        assert.strictEqual(normalizeCommentAttachment(null), null);
        assert.strictEqual(normalizeCommentAttachment(undefined), null);
    });
});

describe('normalizeComment', () => {
    it('normalizes comment attachments', () => {
        const comment = {
            id: 'c1',
            body: 'See attached',
            attachments: ['https://example.com/a.png', { url: '/files/b.pdf', mimeType: 'application/pdf' }],
        };
        const normalized = normalizeComment(comment);
        assert.strictEqual(normalized.id, 'c1');
        assert.strictEqual(normalized.attachments.length, 2);
        assert.strictEqual(normalized.attachments[0].mimeType, 'image/png');
        assert.strictEqual(normalized.attachments[1].mimeType, 'application/pdf');
    });

    it('handles comments with no attachments', () => {
        const normalized = normalizeComment({ id: 'c2', body: 'Hello' });
        assert.deepStrictEqual(normalized.attachments, []);
    });
});

describe('colorFromSeed', () => {
    it('returns a stable HSL color for a seed', () => {
        assert.strictEqual(colorFromSeed('Alice'), colorFromSeed('Alice'));
    });

    it('returns different colors for different seeds', () => {
        assert.notStrictEqual(colorFromSeed('Alice'), colorFromSeed('Bob'));
    });

    it('returns a valid HSL string', () => {
        assert.match(colorFromSeed('test'), /^hsl\(\d+ \d+% \d+%\)$/);
    });
});

describe('formatDisplayDate', () => {
    it('formats an ISO date as DD/MM/YYYY', () => {
        assert.strictEqual(formatDisplayDate('2026-08-19T12:00:00'), '19/08/2026');
    });

    it('formats a US-style date as DD/MM/YYYY', () => {
        assert.strictEqual(formatDisplayDate('08/19/2026'), '19/08/2026');
    });

    it('returns dash for empty values', () => {
        assert.strictEqual(formatDisplayDate(''), '-');
        assert.strictEqual(formatDisplayDate(null), '-');
        assert.strictEqual(formatDisplayDate(undefined), '-');
    });

    it('returns the original value when it cannot parse', () => {
        assert.strictEqual(formatDisplayDate('not a date'), 'not a date');
    });
});

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
    getTenderIdFromHash,
    buildTenderHash,
    buildSheetHash,
    buildFullPageHash,
    isTenderSheetHash,
    isTenderFullPageHash,
    serializeFilters,
    deserializeFilters,
    buildDashboardHash,
} from './tenderRouting.js';

describe('tenderRouting', () => {
    it('parses tender id from hash', () => {
        assert.strictEqual(getTenderIdFromHash('#/tenders/abc-123'), 'abc-123');
        assert.strictEqual(getTenderIdFromHash('#tenders/abc%20123'), 'abc 123');
        assert.strictEqual(getTenderIdFromHash('#/tenders/abc-123/sheet'), 'abc-123');
        assert.strictEqual(getTenderIdFromHash('#dashboard'), '');
    });

    it('builds tender hash (full-page alias)', () => {
        assert.strictEqual(buildTenderHash('abc-123'), '#/tenders/abc-123');
        assert.strictEqual(buildTenderHash(''), '#dashboard');
    });

    it('builds sheet hash', () => {
        assert.strictEqual(buildSheetHash('abc-123'), '#/tenders/abc-123/sheet');
        assert.strictEqual(buildSheetHash(''), '#dashboard');
    });

    it('builds full-page hash', () => {
        assert.strictEqual(buildFullPageHash('abc-123'), '#/tenders/abc-123');
        assert.strictEqual(buildFullPageHash(''), '#dashboard');
    });

    it('detects sheet vs full-page hashes', () => {
        assert.strictEqual(isTenderSheetHash('#/tenders/abc-123/sheet'), true);
        assert.strictEqual(isTenderSheetHash('#/tenders/abc-123'), false);
        assert.strictEqual(isTenderSheetHash('#dashboard'), false);

        assert.strictEqual(isTenderFullPageHash('#/tenders/abc-123'), true);
        assert.strictEqual(isTenderFullPageHash('#/tenders/abc-123/sheet'), false);
        assert.strictEqual(isTenderFullPageHash('#dashboard'), false);
        assert.strictEqual(isTenderFullPageHash('#/tenders/abc-123?filter=1'), true);
    });

    it('serializes only non-default filters', () => {
        assert.strictEqual(serializeFilters({ source: 'worldbank' }), 'source=worldbank');
        assert.strictEqual(serializeFilters({ verified: 'Yes' }), '');
        assert.strictEqual(serializeFilters({ q: 'health', source: 'worldbank' }), 'q=health&source=worldbank');
    });

    it('round-trips filters', () => {
        const filters = { q: 'health', source: 'worldbank', verified: 'Yes' };
        const restored = deserializeFilters(serializeFilters(filters));
        assert.strictEqual(restored.q, 'health');
        assert.strictEqual(restored.source, 'worldbank');
        assert.strictEqual(restored.verified, 'Yes');
    });

    it('builds dashboard hash with filters', () => {
        assert.strictEqual(buildDashboardHash({ source: 'worldbank' }), '#/dashboard?source=worldbank');
        assert.strictEqual(buildDashboardHash({}), '#dashboard');
    });
});

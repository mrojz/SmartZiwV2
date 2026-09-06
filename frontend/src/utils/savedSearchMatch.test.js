import { describe, it } from 'node:test';
import assert from 'node:assert';
import { filterProjects, parseFilterDate } from './savedSearchMatch.js';

const PROJECTS = [
    {
        project_id: 'P1',
        project_name: 'Firewall procurement',
        project_description: 'Supply of next-gen firewalls',
        project_sponsor: 'Ministry of Finance Tunisia',
        source: 'World Bank',
        ai_verified: 'Yes',
        region_names: ['Middle East & North Africa'],
        country_names_en: ['Tunisia'],
        scraped_at: '2026-09-05T08:00:00',
        effective_deadline: '2026-10-01',
    },
    {
        project_id: 'P2',
        project_name: 'School construction',
        project_description: 'Build schools',
        project_sponsor: 'Ministry of Education Niger',
        source: 'IADB',
        ai_verified: 'No',
        region_names: ['Africa Western & Central'],
        country_names_en: ['Niger'],
        scraped_at: '2026-09-01T08:00:00',
        effective_deadline: '2026-09-03',
    },
];

describe('filterProjects', () => {
    it('filters by free text across id, name, description, sponsor', () => {
        const out = filterProjects(PROJECTS, { freeText: 'firewall' });
        assert.deepStrictEqual(out.map((p) => p.project_id), ['P1']);
    });

    it('filters by source and verified', () => {
        assert.deepStrictEqual(
            filterProjects(PROJECTS, { source: 'IADB' }).map((p) => p.project_id),
            ['P2'],
        );
        assert.deepStrictEqual(
            filterProjects(PROJECTS, { verified: 'Yes' }).map((p) => p.project_id),
            ['P1'],
        );
    });

    it('filters by keyword chips on source field', () => {
        const out = filterProjects(PROJECTS, { chips: [{ field: 'source', value: 'world bank' }] });
        assert.deepStrictEqual(out.map((p) => p.project_id), ['P1']);
    });

    it('filters by region with sponsor-country fallback', () => {
        const regions = { 'North Africa': ['tunisia'] };
        const out = filterProjects(PROJECTS, { region: 'North Africa' }, regions);
        assert.deepStrictEqual(out.map((p) => p.project_id), ['P1']);
    });

    it('filters by decision state', () => {
        const withDecision = [{ ...PROJECTS[0], decision: 'GO' }, { ...PROJECTS[1] }];
        assert.deepStrictEqual(
            filterProjects(withDecision, { decision: 'Undecided' }).map((p) => p.project_id),
            ['P2'],
        );
    });

    it('filters by scraped date range', () => {
        const out = filterProjects(PROJECTS, { scrapedFrom: '2026-09-03', scrapedTo: '2026-09-06' });
        assert.deepStrictEqual(out.map((p) => p.project_id), ['P1']);
    });

    it('returns everything for empty filters', () => {
        assert.strictEqual(filterProjects(PROJECTS, {}).length, 2);
    });
});

describe('parseFilterDate', () => {
    it('parses ISO strings and mm/dd/yyyy', () => {
        assert.ok(parseFilterDate('2026-09-05T08:00:00') instanceof Date);
        assert.strictEqual(parseFilterDate('09/05/2026').getMonth(), 8);
        assert.strictEqual(parseFilterDate(''), null);
        assert.strictEqual(parseFilterDate('garbage'), null);
    });
});

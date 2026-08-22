import { describe, it } from 'node:test';
import assert from 'node:assert';
import { getProjectSeedKey, attachProjectRowIds } from './projects.js';

describe('projects', () => {
    it('computes a stable seed key', () => {
        const p = { source: 'wb', project_id: '123', project_name: 'Road' };
        assert.strictEqual(getProjectSeedKey(p), getProjectSeedKey(p));
    });

    it('attaches unique row ids', () => {
        const items = [{ project_id: '1' }, { project_id: '1' }, { project_id: '2' }];
        const withIds = attachProjectRowIds(items);
        assert.strictEqual(withIds.length, 3);
        assert.notStrictEqual(withIds[0].__rowId, withIds[1].__rowId);
        assert.strictEqual(attachProjectRowIds(withIds)[0].__rowId, withIds[0].__rowId);
    });
});

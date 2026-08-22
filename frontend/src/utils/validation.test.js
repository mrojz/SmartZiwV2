import { describe, it } from 'node:test';
import assert from 'node:assert';
import { isRequired, isEmail, isUrl, isNumberInRange, matchesPassword } from './validation.js';

describe('validation', () => {
    it('requires non-empty values', () => {
        assert.strictEqual(isRequired('hello'), undefined);
        assert.strictEqual(isRequired('  '), 'This field is required');
        assert.strictEqual(isRequired(''), 'This field is required');
        assert.strictEqual(isRequired(null), 'This field is required');
    });

    it('validates email', () => {
        assert.strictEqual(isEmail('a@b.com'), undefined);
        assert.strictEqual(isEmail('user.name+tag@example.co.uk'), undefined);
        assert.strictEqual(isEmail(''), 'Email is required');
        assert.strictEqual(isEmail('bad'), 'Enter a valid email address');
        assert.strictEqual(isEmail('a@b'), 'Enter a valid email address');
    });

    it('validates URL', () => {
        assert.strictEqual(isUrl('https://example.com'), undefined);
        assert.strictEqual(isUrl('http://localhost:8080'), undefined);
        assert.strictEqual(isUrl(''), 'URL is required');
        assert.strictEqual(isUrl('ftp://example.com'), 'URL must use http or https');
        assert.strictEqual(isUrl('not a url'), 'Enter a valid URL');
    });

    it('validates number range', () => {
        assert.strictEqual(isNumberInRange(0.5, 0, 2), undefined);
        assert.strictEqual(isNumberInRange(0, 0, 2), undefined);
        assert.strictEqual(isNumberInRange(2, 0, 2), undefined);
        assert.strictEqual(isNumberInRange(-0.1, 0, 2), 'Must be at least 0');
        assert.strictEqual(isNumberInRange(3, 0, 2), 'Must be at most 2');
        assert.strictEqual(isNumberInRange('abc', 0, 2), 'Must be a number');
    });

    it('validates password match', () => {
        assert.strictEqual(matchesPassword('password123', 'password123'), undefined);
        assert.strictEqual(matchesPassword('', ''), 'Password is required');
        assert.strictEqual(matchesPassword('short', 'short'), 'Password must be at least 8 characters');
        assert.strictEqual(matchesPassword('password123', 'other'), 'Passwords do not match');
    });
});

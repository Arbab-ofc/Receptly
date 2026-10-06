import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authErrorMessage } from '../apps/web/src/lib/auth-errors.js';

test('closing or cancelling the Google popup does not display an error', () => {
  for (const code of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request']) {
    assert.equal(authErrorMessage({ code }), '');
  }
});

test('Google sign-in failures provide actionable messages without Firebase internals', () => {
  const cases = [
    ['auth/popup-blocked', /allow popups/],
    ['auth/account-exists-with-different-credential', /another sign-in method/],
    ['auth/network-request-failed', /internet connection/],
    ['auth/too-many-requests', /wait a moment/],
    ['auth/web-storage-unsupported', /browser storage/],
    ['auth/unauthorized-domain', /use email and password/],
    ['auth/operation-not-allowed', /use email and password/],
  ] as const;
  for (const [code, expected] of cases) {
    const message = authErrorMessage({ code, message: 'FirebaseError: private details' });
    assert.match(message, expected);
    assert.doesNotMatch(message, /FirebaseError|private details|auth\//);
  }
});

test('email sign-in messages remain safe and unknown failures never expose raw errors', () => {
  assert.equal(
    authErrorMessage({ code: 'auth/invalid-credential' }),
    'Email or password is incorrect.',
  );
  assert.match(authErrorMessage({ code: 'auth/email-already-in-use' }), /already exists/);
  for (const error of [null, undefined, new Error('secret stack'), { code: 'unknown' }]) {
    assert.equal(authErrorMessage(error), 'Unable to sign in. Please try again.');
  }
});

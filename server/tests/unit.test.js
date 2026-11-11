import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { totpAt, verifyTotp, base32Encode, base32Decode, generateTotpSecret, sha256 } from '../src/utils/crypto.js';
import { cleanText, extractHashtags, extractMentions, deviceLabel, escapeRegex } from '../src/utils/text.js';
import { encodeCursor, decodeCursor } from '../src/utils/pagination.js';
import { detectImage } from '../src/services/uploadService.js';
import { PNG_1PX } from './helpers.js';

describe('crypto utils', () => {
  test('TOTP matches the RFC 6238 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    // RFC 6238 gives 94287082 for 8 digits at t=59; the 6 digit code is its last six digits
    assert.equal(totpAt(secret, 59000), '287082');
  });
  test('verifyTotp accepts the current code and rejects a wrong one', () => {
    const secret = generateTotpSecret();
    assert.equal(verifyTotp(secret, totpAt(secret)), true);
    assert.equal(verifyTotp(secret, '000000') && verifyTotp(secret, '111111'), false);
    assert.equal(verifyTotp(secret, 'abcdef'), false);
  });
  test('base32 round trips', () => {
    const buf = Buffer.from('circle-secret-bytes');
    assert.deepEqual(base32Decode(base32Encode(buf)), buf);
  });
  test('sha256 is stable', () => assert.equal(sha256('a'), 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb'));
});

describe('text utils', () => {
  test('cleanText strips markup, control characters and javascript: URLs', () => {
    assert.equal(cleanText('<script>alert(1)</script>hi'), 'alert(1)hi');
    assert.equal(cleanText('  a\u0000b  '), 'ab');
    assert.equal(cleanText('<img src=x onerror=alert(1)>ok'), 'ok');
    assert.ok(!cleanText('click javascript:alert(1)').includes('javascript:'));
  });
  test('hashtags are extracted, lowercased, de-duplicated and capped', () => {
    assert.deepEqual(extractHashtags('Love #React and #react plus #Node_js'), ['react', 'node_js']);
    assert.deepEqual(extractHashtags('no tags here, price is #1'), []);
    assert.equal(extractHashtags(Array.from({ length: 20 }, (_, i) => `#tag${i}`).join(' '), 10).length, 10);
  });
  test('mentions are extracted', () => assert.deepEqual(extractMentions('hi @Alice and @bob_1, mail a@b.com'), ['alice', 'bob_1']));
  test('escapeRegex neutralises metacharacters', () => assert.equal(new RegExp(escapeRegex('a.b*c')).test('aXbbc'), false));
  test('deviceLabel summarises a user agent', () => assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), 'Chrome on Windows'));
});

describe('pagination cursors', () => {
  test('encode/decode round trip', () => {
    const id = '64b7f0c2a1b2c3d4e5f60718';
    assert.equal(String(decodeCursor(encodeCursor(id))), id);
  });
  test('garbage cursors are rejected', () => assert.throws(() => decodeCursor('not-a-cursor'), /Invalid cursor/));
});

describe('upload type sniffing', () => {
  test('recognises real image bytes and ignores the claimed type', () => {
    assert.equal(detectImage(PNG_1PX).ext, 'png');
    assert.equal(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])).ext, 'jpg');
    assert.equal(detectImage(Buffer.from('GIF89a......')).ext, 'gif');
    assert.equal(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
    assert.equal(detectImage(Buffer.from('MZ\u0090\u0000 this is an exe')), null);
  });
});

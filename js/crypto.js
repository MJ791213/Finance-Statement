/* Encrypts the workspace in the browser before it is uploaded.
 * key = PBKDF2-SHA256(password, per-user random salt, 600k rounds) → AES-GCM-256.
 * A new random IV is used for every save. The key never leaves this tab and is
 * not extractable. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const ITERATIONS = 600000;
  const subtle = () => root.crypto.subtle;

  const toB64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const randomB64 = (n) => toB64(root.crypto.getRandomValues(new Uint8Array(n)));

  async function deriveKey(password, saltB64) {
    const base = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(saltB64), iterations: ITERATIONS },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  async function encrypt(key, saltB64, text) {
    const iv = root.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle().encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return { salt: saltB64, iv: toB64(iv), ciphertext: toB64(ct) };
  }

  /* Throws if the key is wrong (AES-GCM authentication fails). */
  async function decrypt(key, blob) {
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(blob.iv) }, key, fromB64(blob.ciphertext));
    return new TextDecoder().decode(pt);
  }

  FS.Crypto = { deriveKey, encrypt, decrypt, newSalt: () => randomB64(16), ITERATIONS };
})(typeof window !== 'undefined' ? window : globalThis);

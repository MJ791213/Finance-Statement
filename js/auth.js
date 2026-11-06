/* Sign in / create account / unlock screens. When the user is signed in and
 * their workspace is decrypted, hands over to FS.App.start(). */
(function (root) {
  'use strict';
  const FS = root.FS;
  const $ = (sel, el = document) => el.querySelector(sel);
  const esc = FS.escapeHtml;
  const MIN_PW = 8;

  let backend = null;
  let mode = 'signin'; // signin | signup | unlock | confirm | setup | loading
  let pendingUser = null; // signed-in user waiting for the unlock password
  let message = null; // { kind: 'err'|'ok', text }
  let busy = false;
  let lastEmail = '';

  const box = () => $('#auth');

  function render() {
    const el = box();
    el.hidden = false;
    const msg = message ? `<p class="auth-msg ${message.kind}">${esc(message.text)}</p>` : '';
    const dis = busy ? 'disabled' : '';
    let html;
    if (mode === 'setup') {
      html = `<h2>Setup needed</h2>
        <p>This copy of the app is not connected to a Supabase project yet, so there is nowhere to save accounts.</p>
        <ol class="small"><li>Create a free project at supabase.com.</li>
          <li>Open <em>SQL Editor</em>, paste <code>supabase/schema.sql</code> and run it.</li>
          <li>Copy the Project URL and the anon public key from <em>Project Settings → API</em> into <code>js/config.js</code>.</li>
          <li>Reload this page.</li></ol>
        <p class="small muted">Full steps are in README.md.</p>`;
    } else if (mode === 'loading') {
      html = `<p class="muted">Loading…</p>`;
    } else if (mode === 'confirm') {
      html = `<h2>Check your email</h2>
        <p>We sent a confirmation link to <strong>${esc(lastEmail)}</strong>. Click it, then sign in here.</p>
        <button class="primary" data-auth="to-signin">Go to sign in</button>`;
    } else if (mode === 'unlock') {
      html = `<h2>Welcome back, ${esc(pendingUser.displayName)}</h2>
        <p class="small muted">${esc(pendingUser.email)} · Enter your password to decrypt your workspace.</p>
        <form id="auth-form" data-form="unlock" autocomplete="on">
          <input type="email" name="email" value="${esc(pendingUser.email)}" autocomplete="username" hidden>
          <label>Password <input type="password" name="password" required autocomplete="current-password" autofocus></label>
          ${msg}<button class="primary" type="submit" ${dis}>${busy ? 'Unlocking…' : 'Unlock'}</button>
        </form>
        <p class="small"><button class="link" data-auth="signout">Not you? Log out</button></p>`;
    } else {
      const signup = mode === 'signup';
      html = `<div class="auth-tabs"><button data-auth="to-signin" class="${signup ? '' : 'active'}">Sign in</button><button data-auth="to-signup" class="${signup ? 'active' : ''}">Create account</button></div>
        <form id="auth-form" data-form="${mode}" autocomplete="on">
          ${signup ? `<label>Your name <input name="name" required maxlength="40" autocomplete="nickname" placeholder="Shown at the top of the page"></label>` : ''}
          <label>Email <input type="email" name="email" required autocomplete="username" value="${esc(lastEmail)}"></label>
          <label>Password <input type="password" name="password" required ${signup ? `minlength="${MIN_PW}"` : ''} autocomplete="${signup ? 'new-password' : 'current-password'}"></label>
          ${signup ? `<label>Repeat password <input type="password" name="password2" required autocomplete="new-password"></label>
            <p class="auth-warn small">⚠ Your statements are encrypted with this password before they are saved. <strong>There is no password reset</strong>: if you forget it, your saved data cannot be recovered. Use a password manager and keep a Backup.</p>` : ''}
          ${msg}<button class="primary" type="submit" ${dis}>${busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
        </form>`;
    }
    el.innerHTML = `<div class="auth-card">${html}</div>`;
    const first = el.querySelector('input:not([hidden])[autofocus], input:not([hidden])');
    if (first && !busy) first.focus();
  }

  function setMode(m, msg = null) { mode = m; message = msg; render(); }

  async function unlockAndStart(user, password) {
    let opened;
    try { opened = await FS.Store.open(backend, password); } catch (e) {
      if (e.code === 'WRONG_PASSWORD') throw new Error('Wrong password: your saved workspace could not be decrypted with it.');
      throw e;
    }
    let state = opened.state;
    const legacy = FS.Store.readLegacy();
    if (legacy && opened.isNew && confirm(`This browser still has data from the offline version (${legacy.statements.length} statement(s), ${legacy.receipts.length} receipt(s)).\n\nUpload it to your account ${user.email}? It will be encrypted, and the copy in this browser is removed afterwards.`)) {
      state = legacy;
      FS.Engine.recompute(state);
      FS.Store.save(state);
      try { await FS.Store.flush(); FS.Store.removeLegacy(); } catch (e) { FS.App.toast('Upload of old data failed; it is still in this browser. Try again later.'); }
    }
    box().hidden = true;
    box().innerHTML = '';
    pendingUser = null;
    FS.App.start({ user, backend }, state);
  }

  async function onSubmit(e) {
    const form = e.target.closest('#auth-form');
    if (!form) return;
    e.preventDefault();
    if (busy) return;
    const f = Object.fromEntries(new FormData(form));
    const kind = form.dataset.form;
    if (f.email) lastEmail = f.email.trim();
    if (kind === 'signup') {
      if (!f.name.trim()) return setMode('signup', { kind: 'err', text: 'Enter your name.' });
      if (f.password.length < MIN_PW) return setMode('signup', { kind: 'err', text: `Password must be at least ${MIN_PW} characters.` });
      if (f.password !== f.password2) return setMode('signup', { kind: 'err', text: 'The passwords do not match.' });
    }
    busy = true; message = null; render();
    try {
      if (kind === 'signup') {
        const r = await backend.signUp(lastEmail, f.password, f.name.trim());
        if (r.needsConfirmation) { busy = false; return setMode('confirm'); }
        await unlockAndStart(r.user, f.password);
      } else if (kind === 'signin') {
        const user = await backend.signIn(lastEmail, f.password);
        try { await unlockAndStart(user, f.password); } catch (err) { await backend.signOut().catch(() => {}); FS.Store.lock(); throw err; }
      } else if (kind === 'unlock') {
        await unlockAndStart(pendingUser, f.password);
      }
      busy = false;
    } catch (err) {
      busy = false;
      const text = /failed to fetch|network/i.test(err.message) ? 'Could not reach the server. Check your internet connection (and the Supabase settings in js/config.js).' : err.message;
      setMode(kind, { kind: 'err', text });
    }
  }

  async function onClick(e) {
    const b = e.target.closest('[data-auth]');
    if (!b || !box().contains(b)) return;
    const a = b.dataset.auth;
    if (a === 'to-signin') setMode('signin');
    else if (a === 'to-signup') setMode('signup');
    else if (a === 'signout') { await backend.signOut().catch(() => {}); pendingUser = null; setMode('signin'); }
  }

  /* Shows the login screen (after log out). */
  function show() { pendingUser = null; busy = false; setMode('signin', { kind: 'ok', text: 'You are logged out.' }); }

  async function init() {
    box().addEventListener('submit', onSubmit);
    box().addEventListener('click', onClick);
    backend = FS.Backend.create();
    if (!backend) return setMode('setup');
    setMode('loading');
    try {
      const user = await backend.getUser();
      if (user) { pendingUser = user; lastEmail = user.email; return setMode('unlock'); }
    } catch (e) { console.error(e); }
    setMode('signin');
  }

  FS.Auth = { show, get mode() { return mode; } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);

/* Talks to Supabase: email/password accounts and the user's encrypted
 * workspace row. Every call runs as the signed-in user, and row-level security
 * on the `workspaces` table (supabase/schema.sql) limits it to that user's row.
 * Tests replace this with an in-memory fake by defining window.FS_TEST_BACKEND. */
(function (root) {
  'use strict';
  const FS = root.FS;
  const TABLE = 'workspaces';

  function userInfo(u) {
    if (!u) return null;
    const meta = u.user_metadata || {};
    return { id: u.id, email: u.email, displayName: meta.display_name || (u.email || '').split('@')[0] };
  }

  function supabaseBackend(cfg) {
    const client = root.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'finance-statement.auth' },
    });
    const fail = (error) => { if (error) throw new Error(error.message || String(error)); };

    return {
      async getUser() {
        const { data, error } = await client.auth.getSession();
        fail(error);
        return userInfo(data.session && data.session.user);
      },
      async signUp(email, password, displayName) {
        const { data, error } = await client.auth.signUp({
          email, password,
          options: { data: { display_name: displayName }, emailRedirectTo: root.location.protocol.startsWith('http') ? root.location.href.split('#')[0] : undefined },
        });
        fail(error);
        // With "Confirm email" switched on, there is no session until the link is clicked.
        return { user: userInfo(data.user), needsConfirmation: !data.session };
      },
      async signIn(email, password) {
        const { data, error } = await client.auth.signInWithPassword({ email, password });
        fail(error);
        return userInfo(data.user);
      },
      async signOut() { const { error } = await client.auth.signOut(); fail(error); },
      async updatePassword(password) { const { error } = await client.auth.updateUser({ password }); fail(error); },
      async updateDisplayName(displayName) {
        const { data, error } = await client.auth.updateUser({ data: { display_name: displayName } });
        fail(error);
        return userInfo(data.user);
      },
      async loadWorkspace() {
        const { data, error } = await client.from(TABLE).select('salt, iv, ciphertext, updated_at').maybeSingle();
        fail(error);
        return data;
      },
      async saveWorkspace(blob) {
        const { data: s } = await client.auth.getSession();
        if (!s.session) throw new Error('You are signed out. Sign in again to save.');
        const { error } = await client.from(TABLE).upsert({ user_id: s.session.user.id, ...blob }, { onConflict: 'user_id' });
        fail(error);
      },
      async deleteWorkspace() {
        const { data: s } = await client.auth.getSession();
        if (!s.session) return;
        const { error } = await client.from(TABLE).delete().eq('user_id', s.session.user.id);
        fail(error);
      },
    };
  }

  function isConfigured(cfg) {
    return !!(cfg && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(cfg.SUPABASE_URL || '') && cfg.SUPABASE_ANON_KEY && !/YOUR-/.test(cfg.SUPABASE_ANON_KEY));
  }

  function create() {
    if (root.FS_TEST_BACKEND) return root.FS_TEST_BACKEND;
    const cfg = root.FS_CONFIG;
    if (!isConfigured(cfg)) return null;
    return supabaseBackend(cfg);
  }

  FS.Backend = { create, isConfigured, userInfo };
})(typeof window !== 'undefined' ? window : globalThis);

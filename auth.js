/* =====================================================================
 *  auth.js — Supabase client initialisation & auth helpers
 *  Shared by both login and dashboard pages.
 * ===================================================================== */

/**
 * Initialise Supabase client.
 * Depends on config.js (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY) being loaded first,
 * and the Supabase JS CDN script being available on the page.
 */
function getSupabaseClient() {
  if (window._supabaseClient) return window._supabaseClient;

  if (typeof supabase === 'undefined' || !supabase.createClient) {
    throw new Error('Supabase JS library is not loaded. Make sure the CDN script is included.');
  }

  window._supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return window._supabaseClient;
}


/**
 * Sign in with email and password.
 * @returns {{ user, session, error }}
 */
async function signIn(email, password) {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  return { user: data?.user ?? null, session: data?.session ?? null, error };
}


/**
 * Sign out the current user.
 */
async function signOut() {
  const client = getSupabaseClient();
  const { error } = await client.auth.signOut();
  return { error };
}


/**
 * Get the currently authenticated session (restored from storage if available).
 * @returns {{ session, error }}
 */
async function getSession() {
  const client = getSupabaseClient();
  const { data, error } = await client.auth.getSession();
  return { session: data?.session ?? null, error };
}


/**
 * Fetch the profile row from public.login_users for the given user id.
 * Falls back gracefully when the row doesn't exist.
 * @param {string} userId
 */
async function fetchUserProfile(userId) {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('login_users')
    .select('*')
    .eq('id', userId)
    .single();
  return { profile: data, error };
}

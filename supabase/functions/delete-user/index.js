// Supabase Edge Function: delete-user (audit MEDIUM-8)
// Deletes the caller's auth user with the service-role key (client SDKs
// cannot do this). Called best-effort by the app's "Delete my account".
//
// Deploy:  supabase functions deploy delete-user
// Secret:  SUPABASE_SERVICE_ROLE_KEY is auto-provided in Deno env.
// The function only ever deletes the CALLER's own user — verified by
// comparing the JWT sub with the requested id.
export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405 });
  }
  const authHeader = req.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'missing token' }), { status: 401 });
  }

  // Verify the caller's JWT
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  const anon = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  );
  const { data: userData, error: userErr } = await anon.auth.getUser(token);
  if (userErr || !userData?.user) {
    return new Response(JSON.stringify({ error: 'invalid token' }), { status: 401 });
  }

  const callerId = userData.user.id;
  let body = {};
  try { body = await req.json(); } catch { body = {}; }
  const targetId = body.user_id || callerId;

  // A user may only delete THEMSELVES
  if (targetId !== callerId) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );
  const { error } = await admin.auth.admin.deleteUser(callerId);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
  // users + all data rows cascade via ON DELETE CASCADE in schema.sql
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}

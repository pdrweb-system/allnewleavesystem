import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

// client สิทธิ์ service (ข้าม RLS) ใช้ได้เฉพาะใน Edge Function เท่านั้น
// อ่าน secret key แบบใหม่ก่อน (SUPABASE_SECRET_KEYS) แล้วค่อยถอยไปใช้ service_role แบบเดิม
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  let key: string | undefined;
  try {
    key = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default;
  } catch {
    key = undefined;
  }
  key ??= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('missing SUPABASE_URL or secret key');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

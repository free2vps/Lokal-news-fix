import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const supabase = () => createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, opts);
export const supabaseAdmin = () => createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, opts); // hanya di server!

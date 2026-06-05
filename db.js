const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// service_role bypassa RLS automaticamente — nunca expor ao cliente
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY,
    { auth: { persistSession: false } }
);

module.exports = supabase;

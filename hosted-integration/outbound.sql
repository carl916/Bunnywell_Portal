-- Hosted integration only: no HTTP, provider credentials or delivery side effects.
CREATE SCHEMA IF NOT EXISTS integration_controls;
REVOKE ALL ON SCHEMA integration_controls FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA integration_controls TO supabase_auth_admin;
CREATE OR REPLACE FUNCTION integration_controls.block_delivery(event jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $$ SELECT '{"error":{"http_code":403,"message":"External delivery is disabled in Bunnywell Portal Integration."}}'::jsonb $$;
REVOKE ALL ON FUNCTION integration_controls.block_delivery(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION integration_controls.block_delivery(jsonb) TO supabase_auth_admin;

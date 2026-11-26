-- ============================================================================
-- NASHER-TAX-LEDGER — Supabase PostgreSQL + Storage RLS Schema
-- Supports strict Admin vs. Client tenant isolation & multi-GB .xlsx Vault
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------------------
-- 1. CLIENT DIRECTORIES
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.client_directories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  company_name text NOT NULL,
  trade_name text NOT NULL DEFAULT '',
  tin text NOT NULL DEFAULT '',
  rdo_code text NOT NULL DEFAULT '',
  tax_classification text NOT NULL DEFAULT 'VAT'
    CHECK (tax_classification IN ('VAT', 'NON_VAT')),
  storage_quota_bytes bigint NOT NULL DEFAULT 5368709120, -- 5 GB default per client
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_directories_slug ON public.client_directories(slug);
CREATE INDEX IF NOT EXISTS idx_client_directories_tin ON public.client_directories(tin);

-- ----------------------------------------------------------------------------
-- 2. USER PROFILES (+ `profiles` compatibility view)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'client'
    CHECK (role IN ('admin', 'client')),
  client_directory_id uuid REFERENCES public.client_directories(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON public.user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_client ON public.user_profiles(client_directory_id);

-- View named `profiles` with security_invoker so user_profiles RLS is strictly enforced
CREATE OR REPLACE VIEW public.profiles
WITH (security_invoker = true) AS
SELECT id, email, full_name, role, client_directory_id, created_at, updated_at
FROM public.user_profiles;

REVOKE ALL ON public.profiles FROM anon, public;
GRANT SELECT ON public.profiles TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. LEDGER ENTRIES (SALES, PURCHASES / SLP, EXPENSES)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_directory_id uuid NOT NULL REFERENCES public.client_directories(id) ON DELETE CASCADE,
  entry_type text NOT NULL CHECK (entry_type IN ('SALES', 'PURCHASES', 'EXPENSE')),
  audit_status text NOT NULL DEFAULT 'PENDING'
    CHECK (audit_status IN ('PENDING', 'APPROVED', 'FLAGGED')),
  audit_note text NOT NULL DEFAULT '',
  split_group_id text,
  tx_date text NOT NULL DEFAULT '',
  filing_month text NOT NULL DEFAULT '',
  filing_year text NOT NULL DEFAULT '',
  branch_trade_name text NOT NULL DEFAULT '',
  payor text NOT NULL DEFAULT '',
  tin text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  address2 text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'GOODS'
    CHECK (category IN ('N/A', 'GOODS', 'SERVICES', 'RENTAL')),
  private_or_govt text NOT NULL DEFAULT 'PRIVATE'
    CHECK (private_or_govt IN ('PRIVATE', 'GOVT')),
  payee_classification text NOT NULL DEFAULT 'N/A'
    CHECK (payee_classification IN ('N/A', 'INDIVIDUAL', 'CORP')),
  supporting_docs text NOT NULL DEFAULT '',
  reference_no text NOT NULL DEFAULT '',
  particular text NOT NULL DEFAULT '',
  account_title text NOT NULL DEFAULT '',
  withholding_agent text NOT NULL DEFAULT 'YES'
    CHECK (withholding_agent IN ('YES', 'NO')),
  non_vat_exempt numeric(14, 2),
  gross_of_vat numeric(14, 2),
  net_of_vat numeric(14, 2),
  vat numeric(14, 2),
  total numeric(14, 2),
  wt_goods_1 numeric(14, 2),
  wt_services_2 numeric(14, 2),
  wt_rental_5 numeric(14, 2),
  wt_vat_5 numeric(14, 2),
  actual numeric(14, 2),
  remarks text NOT NULL DEFAULT '',
  apply_govt_vat_5 boolean NOT NULL DEFAULT false,
  manual_override boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_entries_client_type
  ON public.ledger_entries(client_directory_id, entry_type, filing_year, filing_month);
CREATE INDEX IF NOT EXISTS idx_ledger_entries_tin
  ON public.ledger_entries(client_directory_id, tin);

-- ----------------------------------------------------------------------------
-- 4. CLIENT TIN DIRECTORY (BIR RELIEF Master Counterparties)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tin_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_directory_id uuid NOT NULL REFERENCES public.client_directories(id) ON DELETE CASCADE,
  tin text NOT NULL,
  digits text NOT NULL,
  payor text NOT NULL,
  branch_trade_name text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  address2 text NOT NULL DEFAULT '',
  default_private_or_govt text NOT NULL DEFAULT 'PRIVATE'
    CHECK (default_private_or_govt IN ('PRIVATE', 'GOVT')),
  default_category text NOT NULL DEFAULT 'GOODS'
    CHECK (default_category IN ('N/A', 'GOODS', 'SERVICES', 'RENTAL')),
  default_tax_status text NOT NULL DEFAULT 'VATABLE'
    CHECK (default_tax_status IN ('VATABLE', 'NON_VAT')),
  default_payee_classification text DEFAULT 'CORP',
  default_account_title text DEFAULT '',
  default_withholding_agent text DEFAULT 'YES',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_directory_id, digits)
);

-- ----------------------------------------------------------------------------
-- 5. LARGE .XLSX FILE VAULT METADATA (Direct-to-Storage Metadata Index)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.xlsx_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_directory_id uuid NOT NULL REFERENCES public.client_directories(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  storage_path text NOT NULL UNIQUE,
  bucket_name text NOT NULL DEFAULT 'ledger-vault',
  size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  tax_year text NOT NULL DEFAULT '2026',
  tax_period text NOT NULL DEFAULT '2026-Q1',
  entry_scope text NOT NULL DEFAULT 'GENERAL'
    CHECK (entry_scope IN ('GENERAL', 'SALES', 'PURCHASES', 'EXPENSE', 'SLP')),
  sheet_name text DEFAULT '',
  preview_headers jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_email text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_xlsx_files_client_period
  ON public.xlsx_files(client_directory_id, tax_year, tax_period);

-- ----------------------------------------------------------------------------
-- 6. UPDATED_AT & AUTH USER PROFILE SYNC TRIGGERS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_client_directories_updated ON public.client_directories;
CREATE TRIGGER trg_client_directories_updated
  BEFORE UPDATE ON public.client_directories
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_user_profiles_updated ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_updated
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_ledger_entries_updated ON public.ledger_entries;
CREATE TRIGGER trg_ledger_entries_updated
  BEFORE UPDATE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_tin_directory_updated ON public.tin_directory;
CREATE TRIGGER trg_tin_directory_updated
  BEFORE UPDATE ON public.tin_directory
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_xlsx_files_updated ON public.xlsx_files;
CREATE TRIGGER trg_xlsx_files_updated
  BEFORE UPDATE ON public.xlsx_files
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Automatically populate user_profiles with least-privilege defaults only.
-- NEVER trust client-supplied raw_user_meta_data for role or client_directory_id.
-- Only an authenticated Admin may assign client_directory_id or promote roles.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  meta_name text;
BEGIN
  meta_name := COALESCE(NEW.raw_user_meta_data ->> 'full_name', '');

  INSERT INTO public.user_profiles (id, email, full_name, role, client_directory_id)
  VALUES (NEW.id, NEW.email, meta_name, 'client', NULL)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = CASE WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name ELSE public.user_profiles.full_name END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 7. SECURITY DEFINER RBAC HELPER FUNCTIONS
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_client_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT client_directory_id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT role = 'admin' FROM public.user_profiles WHERE id = auth.uid() LIMIT 1), false);
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM anon, public;
REVOKE ALL ON FUNCTION public.current_user_client_id() FROM anon, public;
REVOKE ALL ON FUNCTION public.is_admin() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_client_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;

-- Prevent non-admin users from self-approving audit_status or forging created_by
CREATE OR REPLACE FUNCTION public.enforce_ledger_audit_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF TG_OP = 'INSERT' THEN
      NEW.audit_status := 'PENDING';
      NEW.audit_note := '';
      IF auth.uid() IS NOT NULL THEN
        NEW.created_by := auth.uid();
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      NEW.audit_status := OLD.audit_status;
      NEW.audit_note := OLD.audit_note;
      NEW.created_by := OLD.created_by;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ledger_audit_integrity ON public.ledger_entries;
CREATE TRIGGER trg_ledger_audit_integrity
  BEFORE INSERT OR UPDATE ON public.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.enforce_ledger_audit_integrity();

-- ----------------------------------------------------------------------------
-- 8. ROW-LEVEL SECURITY (RLS) POLICIES FOR DATABASE TABLES
-- ----------------------------------------------------------------------------
ALTER TABLE public.client_directories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tin_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.xlsx_files ENABLE ROW LEVEL SECURITY;

-- client_directories: Admins full access; Clients can SELECT only their own directory
DROP POLICY IF EXISTS "Admins full access client_directories" ON public.client_directories;
CREATE POLICY "Admins full access client_directories"
  ON public.client_directories
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Clients read own directory" ON public.client_directories;
CREATE POLICY "Clients read own directory"
  ON public.client_directories
  FOR SELECT
  TO authenticated
  USING (id = public.current_user_client_id());

-- user_profiles: Admins full access; Users can read own profile & update full_name only (cannot elevate role or change directory)
DROP POLICY IF EXISTS "Admins full access user_profiles" ON public.user_profiles;
CREATE POLICY "Admins full access user_profiles"
  ON public.user_profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Users read own profile" ON public.user_profiles;
CREATE POLICY "Users read own profile"
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS "Users update own non-privileged profile" ON public.user_profiles;
CREATE POLICY "Users update own non-privileged profile"
  ON public.user_profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role = public.current_user_role()
    AND client_directory_id IS NOT DISTINCT FROM public.current_user_client_id()
  );

-- ledger_entries: Admins full access; Clients SELECT/INSERT/UPDATE/DELETE strictly within their client_directory_id
DROP POLICY IF EXISTS "Admins full access ledger_entries" ON public.ledger_entries;
CREATE POLICY "Admins full access ledger_entries"
  ON public.ledger_entries
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Clients select own ledger_entries" ON public.ledger_entries;
CREATE POLICY "Clients select own ledger_entries"
  ON public.ledger_entries
  FOR SELECT
  TO authenticated
  USING (client_directory_id = public.current_user_client_id());

DROP POLICY IF EXISTS "Clients insert own ledger_entries" ON public.ledger_entries;
CREATE POLICY "Clients insert own ledger_entries"
  ON public.ledger_entries
  FOR INSERT
  TO authenticated
  WITH CHECK (client_directory_id = public.current_user_client_id());

DROP POLICY IF EXISTS "Clients update own ledger_entries" ON public.ledger_entries;
CREATE POLICY "Clients update own ledger_entries"
  ON public.ledger_entries
  FOR UPDATE
  TO authenticated
  USING (client_directory_id = public.current_user_client_id())
  WITH CHECK (client_directory_id = public.current_user_client_id());

DROP POLICY IF EXISTS "Clients delete own ledger_entries" ON public.ledger_entries;
CREATE POLICY "Clients delete own ledger_entries"
  ON public.ledger_entries
  FOR DELETE
  TO authenticated
  USING (client_directory_id = public.current_user_client_id());

-- tin_directory: Admins full access; Clients isolated to own client_directory_id
DROP POLICY IF EXISTS "Admins full access tin_directory" ON public.tin_directory;
CREATE POLICY "Admins full access tin_directory"
  ON public.tin_directory
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Clients manage own tin_directory" ON public.tin_directory;
CREATE POLICY "Clients manage own tin_directory"
  ON public.tin_directory
  FOR ALL
  TO authenticated
  USING (client_directory_id = public.current_user_client_id())
  WITH CHECK (client_directory_id = public.current_user_client_id());

-- xlsx_files: Admins full access; Clients SELECT/INSERT/UPDATE own client_directory_id
DROP POLICY IF EXISTS "Admins full access xlsx_files" ON public.xlsx_files;
CREATE POLICY "Admins full access xlsx_files"
  ON public.xlsx_files
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Clients select own xlsx_files" ON public.xlsx_files;
CREATE POLICY "Clients select own xlsx_files"
  ON public.xlsx_files
  FOR SELECT
  TO authenticated
  USING (client_directory_id = public.current_user_client_id());

DROP POLICY IF EXISTS "Clients insert own xlsx_files" ON public.xlsx_files;
CREATE POLICY "Clients insert own xlsx_files"
  ON public.xlsx_files
  FOR INSERT
  TO authenticated
  WITH CHECK (client_directory_id = public.current_user_client_id());

DROP POLICY IF EXISTS "Clients update own xlsx_files" ON public.xlsx_files;
CREATE POLICY "Clients update own xlsx_files"
  ON public.xlsx_files
  FOR UPDATE
  TO authenticated
  USING (client_directory_id = public.current_user_client_id())
  WITH CHECK (client_directory_id = public.current_user_client_id());

-- ----------------------------------------------------------------------------
-- 9. SUPABASE STORAGE BUCKET (`ledger-vault`) & STORAGE OBJECT RLS POLICIES
-- Direct browser-to-storage multi-GB .xlsx uploads bypassing Vercel 4.5MB cap.
-- Path convention: {client_directory_id}/{tax_year}/{period}/{filename}.xlsx
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ledger-vault',
  'ledger-vault',
  false,
  5368709120, -- 5 GB max per object
  ARRAY[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 5368709120;

-- Admins: unrestricted access across all folders in ledger-vault
DROP POLICY IF EXISTS "Admins full access ledger-vault" ON storage.objects;
CREATE POLICY "Admins full access ledger-vault"
  ON storage.objects
  FOR ALL
  TO authenticated
  USING (bucket_id = 'ledger-vault' AND public.is_admin())
  WITH CHECK (bucket_id = 'ledger-vault' AND public.is_admin());

-- Clients: SELECT, INSERT, UPDATE strictly inside /{client_directory_id}/... (block path traversal)
DROP POLICY IF EXISTS "Clients select own vault objects" ON storage.objects;
CREATE POLICY "Clients select own vault objects"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ledger-vault'
    AND public.current_user_client_id() IS NOT NULL
    AND name !~ '\.\.'
    AND (storage.foldername(name))[1] = public.current_user_client_id()::text
  );

DROP POLICY IF EXISTS "Clients insert own vault objects" ON storage.objects;
CREATE POLICY "Clients insert own vault objects"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ledger-vault'
    AND public.current_user_client_id() IS NOT NULL
    AND name !~ '\.\.'
    AND (storage.foldername(name))[1] = public.current_user_client_id()::text
  );

DROP POLICY IF EXISTS "Clients update own vault objects" ON storage.objects;
CREATE POLICY "Clients update own vault objects"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ledger-vault'
    AND public.current_user_client_id() IS NOT NULL
    AND name !~ '\.\.'
    AND (storage.foldername(name))[1] = public.current_user_client_id()::text
  )
  WITH CHECK (
    bucket_id = 'ledger-vault'
    AND public.current_user_client_id() IS NOT NULL
    AND name !~ '\.\.'
    AND (storage.foldername(name))[1] = public.current_user_client_id()::text
  );

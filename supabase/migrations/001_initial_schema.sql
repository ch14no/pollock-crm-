-- ============================================================
-- Pollock Core CRM - Initial Schema
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- MASTER TABLES
-- ============================================================

-- Users (auto-created from auth.users via trigger)
CREATE TABLE public.users (
  id         UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       VARCHAR(100) NOT NULL,
  email      VARCHAR(255) NOT NULL UNIQUE,
  role       VARCHAR(20)  NOT NULL DEFAULT 'user' CHECK (role IN ('super_admin', 'manager', 'user')),
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Divisions (business units)
CREATE TABLE public.divisions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(100) NOT NULL,
  color_code VARCHAR(7),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User-Division mapping (supports concurrent roles)
CREATE TABLE public.user_divisions (
  user_id     UUID    NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  division_id UUID    NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  is_primary  BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (user_id, division_id)
);

-- Companies (global master - shared across all divisions)
CREATE TABLE public.companies (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             VARCHAR(255) NOT NULL,
  corporate_number CHAR(13)     UNIQUE,
  website          VARCHAR(255),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TRANSACTION TABLES
-- ============================================================

-- Contacts (customer contacts / leads)
CREATE TABLE public.contacts (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  division_id       UUID        NOT NULL REFERENCES public.divisions(id),
  assigned_user_id  UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  name              VARCHAR(100) NOT NULL,
  email             VARCHAR(255),
  phone             VARCHAR(20),
  position          VARCHAR(100),
  tags              TEXT[]       DEFAULT '{}',
  custom_attributes JSONB        NOT NULL DEFAULT '{}'::jsonb,
  notes             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Pipeline stages (per division)
CREATE TABLE public.pipeline_stages (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID        NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  is_won      BOOLEAN     NOT NULL DEFAULT FALSE,
  is_lost     BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deals (opportunities)
CREATE TABLE public.deals (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id       UUID        REFERENCES public.contacts(id) ON DELETE SET NULL,
  division_id      UUID        NOT NULL REFERENCES public.divisions(id),
  assigned_user_id UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  title            VARCHAR(255) NOT NULL,
  amount           INTEGER      NOT NULL DEFAULT 0,
  stage_id         VARCHAR(100) NOT NULL,
  close_date       DATE,
  description      TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Activities (call, email, meeting, task, tossup logs)
CREATE TABLE public.activities (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type   VARCHAR(20) NOT NULL CHECK (target_type IN ('contact', 'deal', 'company')),
  target_id     UUID        NOT NULL,
  user_id       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  activity_type VARCHAR(20) NOT NULL CHECK (activity_type IN ('call', 'email', 'meeting', 'task', 'tossup', 'note')),
  title         VARCHAR(255),
  memo          TEXT,
  due_date      TIMESTAMPTZ,
  status        VARCHAR(20) NOT NULL DEFAULT 'done' CHECK (status IN ('todo', 'doing', 'done')),
  action_date   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tossups (cross-division referrals)
CREATE TABLE public.tossups (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id     UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  from_division_id UUID        NOT NULL REFERENCES public.divisions(id),
  to_division_id   UUID        NOT NULL REFERENCES public.divisions(id),
  company_id       UUID        REFERENCES public.companies(id) ON DELETE SET NULL,
  contact_id       UUID        REFERENCES public.contacts(id) ON DELETE SET NULL,
  message          TEXT        NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'in_progress', 'closed')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-create user profile on auth.users insert
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, name, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.email
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER deals_updated_at BEFORE UPDATE ON public.deals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER tossups_updated_at BEFORE UPDATE ON public.tossups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
CREATE TRIGGER companies_updated_at BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_contacts_division ON public.contacts(division_id);
CREATE INDEX idx_contacts_company ON public.contacts(company_id);
CREATE INDEX idx_contacts_assigned ON public.contacts(assigned_user_id);
CREATE INDEX idx_deals_division ON public.deals(division_id);
CREATE INDEX idx_deals_stage ON public.deals(stage_id);
CREATE INDEX idx_deals_updated ON public.deals(updated_at);
CREATE INDEX idx_activities_target ON public.activities(target_type, target_id);
CREATE INDEX idx_activities_user ON public.activities(user_id);
CREATE INDEX idx_tossups_from_div ON public.tossups(from_division_id);
CREATE INDEX idx_tossups_to_div ON public.tossups(to_division_id);
CREATE INDEX idx_user_divisions_user ON public.user_divisions(user_id);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE public.users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.divisions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_divisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deals          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activities     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tossups        ENABLE ROW LEVEL SECURITY;

-- Users: read own profile, super_admin reads all
CREATE POLICY "users_select" ON public.users FOR SELECT USING (
  id = auth.uid()
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
CREATE POLICY "users_update_own" ON public.users FOR UPDATE USING (id = auth.uid());

-- Divisions: all authenticated users can read
CREATE POLICY "divisions_select" ON public.divisions FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "divisions_manage" ON public.divisions FOR ALL USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

-- User-divisions: own entries + super_admin
CREATE POLICY "user_divisions_select" ON public.user_divisions FOR SELECT USING (
  user_id = auth.uid()
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);

-- Companies: all authenticated users can read (global master)
CREATE POLICY "companies_select" ON public.companies FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "companies_insert" ON public.companies FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "companies_update" ON public.companies FOR UPDATE USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);

-- Contacts: own division only
CREATE POLICY "contacts_select" ON public.contacts FOR SELECT USING (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
CREATE POLICY "contacts_insert" ON public.contacts FOR INSERT WITH CHECK (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
);
CREATE POLICY "contacts_update" ON public.contacts FOR UPDATE USING (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
);
CREATE POLICY "contacts_delete" ON public.contacts FOR DELETE USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);

-- Pipeline stages: all can read, managers can manage
CREATE POLICY "stages_select" ON public.pipeline_stages FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "stages_manage" ON public.pipeline_stages FOR ALL USING (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
  AND (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);

-- Deals: own division
CREATE POLICY "deals_select" ON public.deals FOR SELECT USING (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
CREATE POLICY "deals_insert" ON public.deals FOR INSERT WITH CHECK (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
);
CREATE POLICY "deals_update" ON public.deals FOR UPDATE USING (
  division_id IN (
    SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid()
  )
);

-- Activities: own division's targets
CREATE POLICY "activities_select" ON public.activities FOR SELECT USING (
  user_id = auth.uid()
  OR (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);
CREATE POLICY "activities_insert" ON public.activities FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "activities_update" ON public.activities FOR UPDATE USING (user_id = auth.uid());

-- Tossups: from or to own division
CREATE POLICY "tossups_select" ON public.tossups FOR SELECT USING (
  from_division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR to_division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
);
CREATE POLICY "tossups_insert" ON public.tossups FOR INSERT WITH CHECK (
  from_division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
);
CREATE POLICY "tossups_update" ON public.tossups FOR UPDATE USING (
  to_division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
  OR (SELECT role FROM public.users WHERE id = auth.uid()) IN ('super_admin', 'manager')
);

-- ============================================================
-- SEED DATA (demo)
-- ============================================================
INSERT INTO public.divisions (id, name, color_code) VALUES
  ('00000000-0000-0000-0000-000000000001', 'ITソリューション', '#f97316'),
  ('00000000-0000-0000-0000-000000000002', '人材',             '#3b82f6'),
  ('00000000-0000-0000-0000-000000000003', '財務',             '#22c55e'),
  ('00000000-0000-0000-0000-000000000004', 'Bowers',           '#a855f7'),
  ('00000000-0000-0000-0000-000000000005', 'メディケア',       '#ec4899');

INSERT INTO public.pipeline_stages (division_id, name, sort_order, is_won, is_lost) VALUES
  ('00000000-0000-0000-0000-000000000001', 'リード',     0, false, false),
  ('00000000-0000-0000-0000-000000000001', '初回面談',   1, false, false),
  ('00000000-0000-0000-0000-000000000001', '提案中',     2, false, false),
  ('00000000-0000-0000-0000-000000000001', 'クロージング', 3, false, false),
  ('00000000-0000-0000-0000-000000000001', '受注',       4, true,  false),
  ('00000000-0000-0000-0000-000000000001', '失注',       5, false, true),
  ('00000000-0000-0000-0000-000000000002', 'リード',     0, false, false),
  ('00000000-0000-0000-0000-000000000002', '書類選考',   1, false, false),
  ('00000000-0000-0000-0000-000000000002', '面接調整',   2, false, false),
  ('00000000-0000-0000-0000-000000000002', '内定',       3, true,  false),
  ('00000000-0000-0000-0000-000000000002', '不採用',     4, false, true);

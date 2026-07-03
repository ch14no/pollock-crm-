-- ============================================================
-- Pipeline tabs (optional, per division)
-- ============================================================
-- NOTE: This migration is NOT auto-applied. A human must review this
-- file and run it manually via the Supabase SQL Editor against the
-- production project (this is the convention for this session).
--
-- Design intent: `pipeline_stages.tab_id` is NULLABLE. Every existing
-- division's existing stages keep `tab_id = NULL` and are completely
-- unaffected by this change. "0 tabs" (the current state for all 5
-- existing divisions) is exactly today's behavior, with zero migration
-- risk — tabs are strictly additive/opt-in per division.
-- ============================================================

CREATE TABLE public.pipeline_tabs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  division_id UUID        NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (division_id, name),
  UNIQUE (id, division_id)
);

CREATE INDEX idx_pipeline_tabs_division ON public.pipeline_tabs(division_id);

ALTER TABLE public.pipeline_tabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_tabs_select" ON public.pipeline_tabs FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "pipeline_tabs_manage" ON public.pipeline_tabs FOR ALL USING (
  (SELECT role FROM public.users WHERE id = auth.uid()) = 'super_admin'
  OR (
    division_id IN (SELECT division_id FROM public.user_divisions WHERE user_id = auth.uid())
    AND (SELECT role FROM public.users WHERE id = auth.uid()) = 'manager'
  )
);

ALTER TABLE public.pipeline_stages
  ADD COLUMN tab_id UUID REFERENCES public.pipeline_tabs(id) ON DELETE RESTRICT;

ALTER TABLE public.pipeline_stages
  ADD CONSTRAINT pipeline_stages_tab_division_fk
  FOREIGN KEY (tab_id, division_id) REFERENCES public.pipeline_tabs(id, division_id);

CREATE INDEX idx_pipeline_stages_tab ON public.pipeline_stages(tab_id);

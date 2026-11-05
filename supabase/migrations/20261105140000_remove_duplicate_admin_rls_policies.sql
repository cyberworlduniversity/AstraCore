-- Remove legacy duplicate admin policies.
-- The canonical admin_*_control policies already cover these operations and
-- call public.astracore_is_admin(), so these narrower duplicates add no access.
-- Removing them also clears the auth_rls_initplan warnings from direct auth.jwt()
-- expressions and avoids repeated permissive-policy evaluation.

drop policy if exists training_runs_admin_insert on public.astracore_lm_training_runs;
drop policy if exists training_runs_admin_select on public.astracore_lm_training_runs;
drop policy if exists training_runs_admin_update on public.astracore_lm_training_runs;

drop policy if exists model_versions_admin_delete on public.astracore_model_versions;
drop policy if exists model_versions_admin_insert on public.astracore_model_versions;
drop policy if exists model_versions_admin_read on public.astracore_model_versions;
drop policy if exists model_versions_admin_update on public.astracore_model_versions;

drop policy if exists astracore_models_admin on public.astracore_model_registry;

-- Setup automático desativado. Cadastre Platform ATLAS e dono existente pela API.
DO $$ BEGIN RAISE EXCEPTION 'AUTOMATIC_PLATFORM_SETUP_DISABLED'; END $$;

-- Fix de drift em produção: schema possui Lead.cpf, mas a coluna pode não existir no banco.
ALTER TABLE "Lead"
ADD COLUMN IF NOT EXISTS "cpf" TEXT;

#!/usr/bin/env bash
# Ensaio de phase5/phase6 num Postgres DESCARTAVEL local (nunca contra banco real).
#   ADMIN_URL=postgresql://postgres@127.0.0.1:55433/postgres bash prisma/phase-sql/tests/rehearse.sh
# Cria `phase_template` (schema atual via `prisma migrate deploy`) e um banco `phase_case` por cenario.
# Recusa qualquer host que nao seja local.
set -uo pipefail
ADMIN_URL="${ADMIN_URL:?defina ADMIN_URL (postgres local descartavel)}"
case "$ADMIN_URL" in
  *@127.0.0.1:*|*@localhost:*|*@\[::1\]:*) ;;
  *) echo "Recusado: ADMIN_URL precisa ser local" >&2; exit 2 ;;
esac
HERE="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$(cd "$HERE/../.." && pwd)"
base="${ADMIN_URL%/*}"
adm() { psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 "$@"; }
url() { echo "$base/$1"; }
fails=0
ok()   { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; fails=$((fails + 1)); }

if ! adm -t -A -c "select 1 from pg_database where datname='phase_template'" | grep -q 1; then
  adm -c "create database phase_template"
  (cd "$BACKEND" && DATABASE_URL="$(url phase_template)" bunx prisma migrate deploy >/dev/null) || { echo "migrate deploy falhou"; exit 2; }
fi

fresh() { # fresh [seed args...]
  adm -c "drop database if exists phase_case" -c "create database phase_case template phase_template"
  psql "$(url phase_case)" -q -v ON_ERROR_STOP=1 "$@" -f "$HERE/tests/seed-fixture.sql" >/dev/null
}
sql()  { psql "$(url phase_case)" -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }
file() { psql "$(url phase_case)" -q -v ON_ERROR_STOP=1 "${@:2}" -f "$HERE/$1" 2>&1; }
legacy_count() { sql "select count(*) from pg_tables where tablename like '%\_legacy'"; }

expect_abort() { # name file pattern [vars...]
  local name="$1" f="$2" pat="$3"; shift 3
  local out; out="$(file "$f" "$@")"; local rc=$?
  if [ $rc -ne 0 ] && grep -q -- "$pat" <<<"$out"; then ok "$name"; else fail "$name (rc=$rc)"; echo "$out" | tail -5; fi
}

echo "== Fase 5: caminho feliz"
fresh
out="$(file phase5-repoint-and-rename.sql)"; [ "$(legacy_count)" = 0 ] && ok "ensaio termina em ROLLBACK" || fail "ensaio nao reverteu"
file phase5-repoint-and-rename.sql -v finish=COMMIT >/dev/null || fail "apply"
[ "$(legacy_count)" = 16 ] && ok "16 tabelas renomeadas" || fail "renomeacao"
[ "$(sql "select confrelid::regclass::text||':'||convalidated from pg_constraint where conname='Transaction_paymentLinkId_fkey'")" = '"Offer":true' ] && ok "FK para Offer validada" || fail "FK"
[ "$(sql 'select count(*) from "Transaction" where "paymentLinkId" is not null')" = 2 ] && ok "dados de Transaction intactos" || fail "Transaction"
expect_abort "reaplicar aborta" phase5-repoint-and-rename.sql "ausente(s)"
file phase5-rollback.sql -v finish=COMMIT >/dev/null || fail "rollback"
[ "$(legacy_count)" = 0 ] && [ "$(sql "select confrelid::regclass from pg_constraint where conname='Transaction_paymentLinkId_fkey'")" = '"PaymentLink"' ] && ok "rollback restaura nomes e FK" || fail "rollback estado"
file phase5-repoint-and-rename.sql -v finish=COMMIT >/dev/null && ok "reaplica apos rollback" || fail "reapply"

echo "== Fase 5: pre-checagens abortam"
fresh; sql "delete from \"Offer\" where id='pl-2'"
expect_abort "linha antiga sem Offer" phase5-repoint-and-rename.sql "sem Offer de mesmo id"
[ "$(legacy_count)" = 0 ] && ok "  nada mudou" || fail "  mudou"
fresh -v frozen=0
expect_abort "produto legado ativo" phase5-repoint-and-rename.sql "ainda ativo"
file phase5-repoint-and-rename.sql -v allow_active=1 >/dev/null && ok "allow_active=1 libera" || fail "allow_active"
fresh; sql "update \"Transaction\" set \"offerId\"=null where id='t-1'"
expect_abort "offerId divergente de paymentLinkId" phase5-repoint-and-rename.sql "offerId diferente"
fresh; sql "delete from \"ExternalRef\" where id='er-1'"
expect_abort "ExternalRef da DOM ausente" phase5-repoint-and-rename.sql "sem ExternalRef"
fresh; sql "update \"CoproductionAgreement\" set product='links-pagamento'"
expect_abort "coproducao em chave antiga" phase5-repoint-and-rename.sql "chave antiga"
fresh; sql "insert into \"PaymentLinkOffer\"(id,\"paymentLinkId\",type,title,price,\"updatedAt\") values ('f1','pl-1','BUMP','x',1,now())"
expect_abort "funil sem destino" phase5-repoint-and-rename.sql "funil/arquivos"
fresh; sql "create function f_old() returns int language plpgsql as \$\$ begin return (select count(*) from \"PaymentLink\"); end \$\$"
expect_abort "funcao cita tabela antiga" phase5-repoint-and-rename.sql "funcao"
fresh; sql "update \"Offer\" set id='pl-1' where id='sl-1'" 2>/dev/null; sql "insert into \"SubscriptionLink\"(id,\"userId\",code,name,amount,\"frequencyType\",\"isActive\",\"updatedAt\") values ('pl-1','u1','DUP','dup',1,'ANUAL',false,now())" 2>/dev/null
expect_abort "id repetido entre produtos" phase5-repoint-and-rename.sql "repetido"

echo "== Fase 6"
fresh; file phase5-repoint-and-rename.sql -v finish=COMMIT >/dev/null
expect_abort "sem confirm" phase6-drop.sql "Recusado"
expect_abort "confirm de outro banco" phase6-drop.sql "Recusado" -v confirm=DROP-LEGACY:producao
expect_abort "linhas sem accept_loss" phase6-drop.sql "nao foi aceita" -v confirm=DROP-LEGACY:phase_case
file phase6-drop.sql -v confirm=DROP-LEGACY:phase_case -v accept_loss=all >/dev/null; [ "$(legacy_count)" = 16 ] && ok "ensaio reverte" || fail "ensaio fase 6"
file phase6-drop.sql -v confirm=DROP-LEGACY:phase_case -v accept_loss=pixplanlinkcode_legacy,SubscriptionLinkOrder_legacy -v finish=COMMIT >/dev/null || fail "apply fase 6"
[ "$(legacy_count)" = 0 ] && [ "$(sql "select count(*) from information_schema.columns where table_name='Transaction' and column_name='paymentLinkId'")" = 0 ] \
  && [ "$(sql "select count(*) from pg_type where typname='PlanType'")" = 0 ] \
  && [ "$(sql 'select count(*) from "Offer"')" = 6 ] && [ "$(sql 'select count(*) from "Transaction" where "offerId" is not null')" = 4 ] \
  && ok "tabelas, coluna e enum removidos; Offer e vendas intactas" || fail "estado final"
fresh; file phase5-repoint-and-rename.sql -v finish=COMMIT >/dev/null
sql "update \"Transaction\" set \"offerId\"='pl-2' where id='t-1'"
expect_abort "Fase 6 recusa paymentLinkId sem offerId igual" phase6-drop.sql "perderia o vinculo" -v confirm=DROP-LEGACY:phase_case -v accept_loss=all
fresh; file phase5-repoint-and-rename.sql -v finish=COMMIT >/dev/null
sql 'alter table "Offer" add column legacy_ref text'; sql "create table live_child (id text primary key, p text references \"PaymentLink_legacy\"(id))"
expect_abort "Fase 6 recusa FK de tabela viva para legada" phase6-drop.sql "FK(s) de tabela viva" -v confirm=DROP-LEGACY:phase_case -v accept_loss=all

adm -c "drop database if exists phase_case"
echo; [ $fails -eq 0 ] && echo "TODOS OS CENARIOS OK" || { echo "$fails FALHA(S)"; exit 1; }

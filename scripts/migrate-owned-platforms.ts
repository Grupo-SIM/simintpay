import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { PLATFORM_TAXA_DEFAULTS, PLATAFORMA_TAXA_KEYS, type PlataformaTaxaKey } from '../src/modules/platform-taxas/platform-taxas.keys';
import { encryptPlatformSecret, hashPlatformToken } from '../src/modules/platform-integrations/platform-secrets';
import { PLATFORM_PUBLIC_VALUE_KEYS } from '../src/modules/platform-integrations/platform-integration-keys';

const MIGRATION = '20261013000000_explicit_owned_platforms';
const defaultOwner = '01a122a5-4743-7562-8f01-c84182eaafd1';
const canonical = (tag: string) => {
  const normalized = tag.trim().toUpperCase().replaceAll('_', '-');
  return normalized === 'EBOOKSIM' ? 'EBOOK' : normalized;
};
const prefixFor = (tag: string) => tag === 'EBOOK' ? 'EBOOKSIM' : tag.replaceAll('-', '_');
const numeric = (value: string | undefined) => value?.trim() ? Number(value.replace(',', '.')) : NaN;
const intrinsic = ['REVALIDA', 'RENOVADA', 'BOSQUE', 'PAGATG', 'EBOOK', 'FRENDZ', 'ATLAS', 'COMUNIDADE', 'CONTROLE-MOTORISTA', 'RETURN-BET', 'CONTROLE-PATRIMONIAL', 'AREAFLIX', 'ZERO-GRAU', 'BETAI'];
const names: Record<string, string> = { EBOOK: 'EbookSim', 'ZERO-GRAU': 'Zero Grau', 'CONTROLE-MOTORISTA': 'Controle Motorista', 'CONTROLE-PATRIMONIAL': 'Controle Patrimonial' };
const aliases: Record<string, [string, string]> = {
  BACK_EBOOK_URL: ['EBOOK', 'BACKEND_URL'], EBOOK_APIDOM_XTOKENS: ['EBOOK', 'API_DOM_XTOKEN'],
  API_PAGATG_URL: ['PAGATG', 'BACKEND_URL'], ATLAS_HOSTING_URL: ['ATLAS', 'BACKEND_URL'],
  CONTROLE_PATRIMONIAL_URL: ['CONTROLE-PATRIMONIAL', 'BACKEND_URL'], CONTROLE_MOTORISTA_URL: ['CONTROLE-MOTORISTA', 'BACKEND_URL'],
  BETAI_URL: ['BETAI', 'BACKEND_URL'], BETAI_ENTRY_LINK_ID: ['BETAI', 'ENTRY_LINK_ID'],
  AREAFLIX_BACK_URL: ['AREAFLIX', 'BACKEND_URL'],
};

type Fee = { tag: string; key: PlataformaTaxaKey; value: number };
type UserRow = { id: string; name: string; email: string; isActive: boolean; isPurged: boolean; tenantModuleId: string | null; domToken: string | null };

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis:8000 });
  await client.connect();
  try {
    if(process.argv.includes('--rollback')) {
      const snapshot=JSON.parse(await readFile('.tmp/platform-migration/rollback.json','utf8'));
      const current=(await client.query(`SELECT (SELECT count(*) FROM "Transaction")::text AS transactions, (SELECT COALESCE(sum(amount),0)::text FROM "Transaction") AS gross, (SELECT COALESCE(sum("netAmount"),0)::text FROM "Transaction") AS net, (SELECT COALESCE(sum(balance),0)::text FROM "Wallet") AS wallets, (SELECT COALESCE(sum(balance),0)::text FROM "ExternalPlatformWallet") AS external_wallets`)).rows[0];
      if(JSON.stringify(current)!==JSON.stringify(snapshot.financialBefore))throw new Error('Rollback bloqueado: houve atividade financeira após migração');
      await client.query('BEGIN');
      try {
        const tags=(await client.query('SELECT tag FROM "Platform"')).rows.map(r=>r.tag).sort();
        if(JSON.stringify(tags)!==JSON.stringify([...snapshot.platforms].sort()))throw new Error('Rollback bloqueado: cadastro de plataformas mudou');
        await client.query('DROP TABLE "PlatformIntegration"; DROP TABLE "Platform";');
        for(const row of snapshot.technical)await client.query('UPDATE "User" SET "isActive"=$2 WHERE id=$1',[row.id,row.isActive]);
        await client.query('DELETE FROM "PlatformTaxaOverride" WHERE tag=ANY($1::text[])',[['GLOBAL',...snapshot.platforms,'EBOOKSIM',...snapshot.platforms.map((tag:string)=>tag.replaceAll('-','_'))]]);
        for(const row of snapshot.overrides)await client.query('INSERT INTO "PlatformTaxaOverride"(id,tag,key,value,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tag,key) DO UPDATE SET value=EXCLUDED.value',[row.id ?? randomUUID(),row.tag,row.key,row.value,row.createdAt ?? new Date(),row.updatedAt ?? new Date()]);
        await client.query('DELETE FROM "TenantModule" WHERE id=ANY($1::text[]) AND NOT EXISTS(SELECT 1 FROM "User" WHERE "tenantModuleId"="TenantModule".id)',[snapshot.createdTenantIds ?? []]);
        await client.query('DELETE FROM "_prisma_migrations" WHERE migration_name=$1',[MIGRATION]);
        await client.query('COMMIT');
        console.log(JSON.stringify({rolledBack:true,migration:MIGRATION}));
      }catch(error){await client.query('ROLLBACK');throw error;}
      return;
    }
    const existingTable = (await client.query(`SELECT to_regclass('"Platform"') IS NOT NULL AS exists`)).rows[0].exists;
    const alreadyApplied = (await client.query(`SELECT migration_name FROM "_prisma_migrations" WHERE migration_name=$1 AND finished_at IS NOT NULL`, [MIGRATION])).rowCount;
    if (alreadyApplied) { console.log(JSON.stringify({ alreadyApplied: true, migration: MIGRATION })); return; }
    if (existingTable) throw new Error('Platform já existe sem registro da migração; revisar antes de aplicar');
    const users: UserRow[] = (await client.query('SELECT id,name,email,"isActive","isPurged","tenantModuleId","domToken" FROM "User"')).rows;
    const modules = (await client.query('SELECT id,name,slug FROM "TenantModule"')).rows;
    const overrides: Fee[] = (await client.query('SELECT * FROM "PlatformTaxaOverride"')).rows;
    const returnBetPolicy = (await client.query('SELECT * FROM "ReturnBetWithdrawalPolicy" WHERE id=\'default\'')).rows[0];
    const communities = (await client.query('SELECT slug,name FROM "Community"')).rows;
    const links = (await client.query('SELECT * FROM "PaymentLink"')).rows;
    const subscriptionLinks = (await client.query('SELECT id,"platformTag",plataformas,"userId" FROM "SubscriptionLink"')).rows;
    const pixPlans = (await client.query('SELECT id,description,"tenantTag","userId" FROM "PixCreditPlan"')).rows;
    const externalOwners = (await client.query('SELECT platform,"userId" FROM "ExternalPlatformUser" WHERE NOT "isDeleted" AND NOT "isPurged"')).rows;
    const financialBefore = (await client.query(`SELECT (SELECT count(*) FROM "Transaction")::text AS transactions, (SELECT COALESCE(sum(amount),0)::text FROM "Transaction") AS gross, (SELECT COALESCE(sum("netAmount"),0)::text FROM "Transaction") AS net, (SELECT COALESCE(sum(balance),0)::text FROM "Wallet") AS wallets, (SELECT COALESCE(sum(balance),0)::text FROM "ExternalPlatformWallet") AS external_wallets`)).rows[0];
    const globalFees: Record<string,number> = {};
    const old = (tag: string, key: PlataformaTaxaKey, fallback = PLATFORM_TAXA_DEFAULTS[key]): number => {
      const row = overrides.find(r => canonical(r.tag) === tag && r.key === key);
      if (row) return Number(row.value);
      const env = numeric(process.env[`${prefixFor(tag)}_${key}`]);
      if (Number.isFinite(env)) return env;
      const global = tag !== 'GLOBAL' ? overrides.find(r => r.tag === 'GLOBAL' && r.key === key) : null;
      return global ? Number(global.value) : fallback;
    };
    for (const key of PLATAFORMA_TAXA_KEYS) globalFees[key] = old('GLOBAL', key.startsWith('LINK_COST_') ? 'TAXA_LINK_PERCENT' : key);
    const tags = new Set(intrinsic);
    const addTag = (tag: string | null | undefined) => {
      if (!tag) return;
      const normalized = canonical(tag);
      if (!['GLOBAL','SIMINTPAY'].includes(normalized) && !normalized.startsWith('CLIENT:')) tags.add(normalized);
    };
    modules.forEach(m => addTag(m.slug)); overrides.forEach(r=>addTag(r.tag)); communities.forEach(c=>addTag(c.slug));
    links.forEach(l=>l.plataformas.forEach(addTag)); subscriptionLinks.forEach(l=>{addTag(l.platformTag);l.plataformas.forEach(addTag)});
    pixPlans.forEach(p=>{addTag(p.tenantTag);const match=p.description?.match(/\[CPF:[^|\]]*\|([^\]]+)\]/);addTag(match?.[1]);});
    const eligible = (u: UserRow | undefined) => u?.isActive && !u.isPurged && u.name !== 'Platform User' && !u.email.endsWith('@auto.simpay.com') && !/teste/i.test(u.name);
    if (!eligible(users.find(u=>u.id===defaultOwner))) throw new Error('Dono de pendências não encontrado/ativo');
    const blockers: string[] = [];
    const planned = [...tags].sort().map(tag => {
      const module = modules.find(m => canonical(m.slug) === tag);
      const candidateId = process.env[`${prefixFor(tag)}_USER_ID`] || process.env[`${prefixFor(tag)}_ID`];
      let owner = users.find(u => u.id === candidateId && eligible(u));
      if (!owner && module) {
        const candidates = users.filter(u => u.tenantModuleId === module.id && eligible(u));
        if (candidates.length === 1) owner = candidates[0];
      }
      if (!owner) {
        const ownerIds = [...new Set(externalOwners.filter(e=>canonical(e.platform)===tag && e.userId).map(e=>e.userId))];
        if (ownerIds.length === 1) owner = users.find(u=>u.id===ownerIds[0] && eligible(u));
      }
      const ownerUserId = owner?.id ?? defaultOwner;
      const costs: Record<string, number> = {};
      const rates: Record<string, number> = {};
      for (const key of PLATAFORMA_TAXA_KEYS) {
        if (key.startsWith('MDR_LINK_')) continue;
        if (key.startsWith('LINK_COST_')) {
          const n=Number(key.match(/\d+/)?.[0]);
          const value=tag==='AREAFLIX' && n>1 ? old(tag, `MDR_LINK_${n}X` as PlataformaTaxaKey) : old(tag,'TAXA_LINK_PERCENT');
          if(Math.abs(value-globalFees[key])>1e-10) costs[key]=value;
          continue;
        }
        let value = old(tag, key, key === 'LIQUIDEZ' && intrinsic.includes(tag) && !['AREAFLIX','ZERO-GRAU','BETAI'].includes(tag) ? 0.91 : PLATFORM_TAXA_DEFAULTS[key]);
        if(tag==='RETURN-BET' && returnBetPolicy && ['SAQUE_MIN','TAXA_SAQUE_FIXA'].includes(key)) value=Number(key==='SAQUE_MIN'?returnBetPolicy.minimumGrossAmount:returnBetPolicy.fixedWithdrawalFee);
        if (['AREAFLIX','PAGATG'].includes(tag) && key==='MDR_CC_1X' && !overrides.find(r=>canonical(r.tag)===tag && r.key===key)) value=0.0399;
        if (tag==='AREAFLIX' && key==='SAQUE_MIN' && Number.isFinite(numeric(process.env.AREAFLIX_WITHDRAW_MIN))) value=numeric(process.env.AREAFLIX_WITHDRAW_MIN);
        if (tag==='AREAFLIX' && key==='TAXA_SAQUE_FIXA' && Number.isFinite(numeric(process.env.AREAFLIX_WITHDRAW_FEE))) value=numeric(process.env.AREAFLIX_WITHDRAW_FEE);
        if (Math.abs(value-globalFees[key])>1e-10) costs[key]=value;
      }
      const taggedLinks=links.filter(l=>canonical(l.plataformas[0] || '')===tag);
      for(let n=1;n<=12;n++) {
        const key=`MDR_LINK_${n}X` as PlataformaTaxaKey;
        const platformExplicit=overrides.some(r=>canonical(r.tag)===tag && r.key===key) || Number.isFinite(numeric(process.env[`${prefixFor(tag)}_${key}`]));
        const globalExplicit=overrides.some(r=>r.tag==='GLOBAL' && r.key===key);
        const effective=taggedLinks.filter(l=>!l.isStandalone || n>1).map(l=>!platformExplicit && globalExplicit ? Number(l[`platformFee${n}x`] ?? 0)/100 : old(tag,key));
        const unique=[...new Set(effective)];
        if(unique.length>1) blockers.push(`${tag}: juros ${n}x divergentes em links ativos/legados`);
        rates[String(n)]=unique[0] ?? old(tag,key);
      }
      const config: Record<string,string> = {};
      const prefix=prefixFor(tag);
      for (const [key,value] of Object.entries(process.env)) {
        if (!value?.trim()) continue;
        const alias=aliases[key];
        if(alias?.[0]===tag) config[alias[1]]=value.trim();
        if(key.startsWith(prefix+'_')) {
          const suffix=key.slice(prefix.length+1);
          const mapped: Record<string,string>={DOM_TOKEN:'DOM_TOKEN',APIDOM_XTOKEN:'API_DOM_XTOKEN',INTERNAL_TOKEN:'INTERNAL_TOKEN',URL_APP:'URL_APP',API_TOKEN:'API_TOKEN',API_URL:'API_URL',FRENDZ_TOKEN:'FRENDZ_TOKEN',WEBHOOK_URL:'WEBHOOK_URL',WEBHOOK_SECRET:'WEBHOOK_SECRET',WEBHOOK_TOKEN:'WEBHOOK_SECRET',POSTBACK_URL:'WEBHOOK_URL',OFFER_HASH:'OFFER_HASH',DOM_WEBHOOK_RELAXED:'WEBHOOK_RELAXED',EMAIL_LOGO_URL:'EMAIL_LOGO_URL',ENTRY_LINK_ID:'ENTRY_LINK_ID'};
          if(mapped[suffix])config[mapped[suffix]]=value.trim();
        }
      }
      // Capture historical shared credentials explicitly per platform; runtime has no cross-platform fallback.
      const defaults: Record<string,string|undefined>={DOM_TOKEN:process.env.DOM_TOKEN || process.env.API_DOM_MASTER_KEY, INTERNAL_TOKEN:process.env.API_MACHINE_INTERNAL_TOKEN || process.env.INTERNAL_SERVICE_TOKEN, URL_APP:process.env.URL_APP, DOM_BACKEND_URL:process.env.DOM_BACKEND_URL, DOM_WEBHOOK_SECRET:process.env.DOM_WEBHOOK_SECRET};
      for(const [key,value] of Object.entries(defaults))if(!config[key] && value?.trim())config[key]=value.trim();
      if (tag==='RENOVADA') {
        config.MACHINE_SERIALS='PB1S24C373609,PB1S24C373623,PB1S24C373616,PB1S24C373596,4AF61W62R,4AF61V34L,4AF61VY6G';
        config.MACHINE_DOCUMENTS='44522660000108';
      }
      // Read legacy literal defaults locally; never put credentials in this script or report.
      if(['BOSQUE','RENOVADA'].includes(tag) && !config.API_DOM_XTOKEN) {
        const source=execFileSync('git',['show',`HEAD:src/application/use-cases/admin/sync-full-${tag.toLowerCase()}.use-case.ts`],{encoding:'utf8'});
        const legacy=source.match(/(?:BOSQUE_APIDOM_XTOKEN|RENOVADA_API_DOM_TOKEN) = [^\n]*?\|\| '([^']+)'/);
        if(legacy)config.API_DOM_XTOKEN=legacy[1];
      }
      config.ENABLE_DOM_SYNC=process.env[`ENABLE_${prefix}_DOM_SYNC`] ?? 'false';
      config.DISABLE_SYNC=process.env[`DISABLE_${prefix}_SYNC`] ?? 'false';
      if(tag==='FRENDZ' && config.API_TOKEN && !config.FRENDZ_TOKEN)config.FRENDZ_TOKEN=config.API_TOKEN;
      if(owner?.domToken && !config.INBOUND_TOKEN) config.INBOUND_TOKEN=owner.domToken;
      return {tag,name:module?.name || names[tag] || tag,ownerUserId,ownerSource:owner?'existing':'assigned',tenantModuleId:module?.id ?? null,acquirer:process.env[`${prefix}_ACQUIRER`]==='FRENDZ'?'FRENDZ':'DOM',costs,rates,config};
    });
    // Only attach technical inbound tokens with a unique, direct credential match.
    for (const technical of users.filter(u=>u.email.endsWith('@auto.simpay.com') && u.domToken)) {
      const matches=planned.filter(p=>['API_DOM_XTOKEN','DOM_TOKEN'].some(key=>p.config[key]===technical.domToken));
      if(matches.length===1 && !matches[0].config.INBOUND_TOKEN)matches[0].config.INBOUND_TOKEN=technical.domToken!;
    }
    const tokenOwners = new Map<string,string>();
    for(const p of planned)if(p.config.INBOUND_TOKEN){const hash=hashPlatformToken(p.config.INBOUND_TOKEN);if(tokenOwners.has(hash))blockers.push(`Token de entrada compartilhado entre ${p.tag} e ${tokenOwners.get(hash)}`);tokenOwners.set(hash,p.tag);}
    const technical=users.filter(u=>u.name==='Platform User' || u.email.endsWith('@auto.simpay.com'));
    const report={migration:MIGRATION,platforms:planned.map(({config,costs,...p})=>({...p,costOverrides:costs,integrationKeys:Object.keys(config)})),technicalAccounts:technical.map(u=>({id:u.id,action:'deactivate'})),financialBefore,blockers};
    await mkdir('.tmp/platform-migration',{recursive:true,mode:0o700});
    await writeFile('.tmp/platform-migration/inventory.json',JSON.stringify(report,null,2),{mode:0o600});
    console.log(JSON.stringify({platforms:planned.length,technicalAccounts:technical.length,blockers,report:resolve('.tmp/platform-migration/inventory.json')}));
    if (!process.argv.includes('--apply')) return;
    if(blockers.length)throw new Error('Migração bloqueada por ambiguidades do inventário');
    const createdTenantIds: string[]=[];
    const snapshot={createdTenantIds,overrides,technical:technical.map(u=>({id:u.id,isActive:u.isActive})),financialBefore,platforms:planned.map(p=>p.tag)};
    await writeFile('.tmp/platform-migration/rollback.json',JSON.stringify(snapshot,null,2),{mode:0o600});
    const sql=await readFile(`prisma/migrations/${MIGRATION}/migration.sql`,'utf8');
    await client.query('BEGIN');
    try {
      await client.query(`LOCK TABLE "Transaction", "Wallet", "ExternalPlatformWallet" IN SHARE MODE`);
      await client.query(sql);
      for(const p of planned){
        let tenantId=p.tenantModuleId;
        if(!tenantId){tenantId=randomUUID();createdTenantIds.push(tenantId);await client.query('INSERT INTO "TenantModule" (id,name,slug,"isActive","createdAt","updatedAt") VALUES ($1,$2,$3,true,now(),now())',[tenantId,p.name,p.tag.toLowerCase()]);}
        const id=randomUUID();
        await client.query('INSERT INTO "Platform" (id,tag,name,"ownerUserId","tenantModuleId",acquirer,"customerInterestRates","createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now())',[id,p.tag,p.name,p.ownerUserId,tenantId,p.acquirer,JSON.stringify(p.rates)]);
        for(const [key,value] of Object.entries(p.config)){
          const secret=!PLATFORM_PUBLIC_VALUE_KEYS.has(key);
          await client.query('INSERT INTO "PlatformIntegration" (id,"platformId",key,"encryptedValue",url,"tokenHash","createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,now(),now())',[randomUUID(),id,key,secret?encryptPlatformSecret(value):null,secret?null:value,key==='INBOUND_TOKEN'?hashPlatformToken(value):null]);
        }
        // Keep one sparse override policy per platform. Preserve unrelated client overrides.
        await client.query('DELETE FROM "PlatformTaxaOverride" WHERE tag=ANY($1::text[])',[[p.tag,p.tag==='EBOOK'?'EBOOKSIM':p.tag.replaceAll('-','_')]]);
        for(const [key,value] of Object.entries(p.costs))await client.query('INSERT INTO "PlatformTaxaOverride" (id,tag,key,value,"createdAt","updatedAt") VALUES($1,$2,$3,$4,now(),now())',[randomUUID(),p.tag,key,value]);
      }
      for(const key of PLATAFORMA_TAXA_KEYS)if(Math.abs(globalFees[key]-PLATFORM_TAXA_DEFAULTS[key])>1e-10 || overrides.some(r=>r.tag==='GLOBAL'&&r.key===key))await client.query('INSERT INTO "PlatformTaxaOverride" (id,tag,key,value,"createdAt","updatedAt") VALUES($1,\'GLOBAL\',$2,$3,now(),now()) ON CONFLICT(tag,key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=now()',[randomUUID(),key,globalFees[key]]);
      if(technical.length)await client.query('UPDATE "User" SET "isActive"=false,"updatedAt"=now() WHERE id=ANY($1::text[])',[technical.map(u=>u.id)]);
      const financialAfter=(await client.query(`SELECT (SELECT count(*) FROM "Transaction")::text AS transactions, (SELECT COALESCE(sum(amount),0)::text FROM "Transaction") AS gross, (SELECT COALESCE(sum("netAmount"),0)::text FROM "Transaction") AS net, (SELECT COALESCE(sum(balance),0)::text FROM "Wallet") AS wallets, (SELECT COALESCE(sum(balance),0)::text FROM "ExternalPlatformWallet") AS external_wallets`)).rows[0];
      if(JSON.stringify(financialBefore)!==JSON.stringify(financialAfter))throw new Error('Dados financeiros mudaram; migração revertida');
      await client.query('INSERT INTO "_prisma_migrations" (id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES($1,$2,now(),$3,now(),1)',[randomUUID(),createHash('sha256').update(sql).digest('hex'),MIGRATION]);
      await writeFile('.tmp/platform-migration/rollback.json',JSON.stringify(snapshot,null,2),{mode:0o600});
      await client.query('COMMIT');
      await writeFile('.tmp/platform-migration/result.json',JSON.stringify({applied:true,platforms:planned.length,financialBefore,financialAfter},null,2),{mode:0o600});
      console.log(JSON.stringify({applied:true,platforms:planned.length,technicalDeactivated:technical.length,financialPreserved:true}));
    }catch(error){await client.query('ROLLBACK');throw error;}
  }finally{await client.end();}
}
main().catch(error=>{console.error(error instanceof Error ? error.message : 'Falha na migração');process.exitCode=1});

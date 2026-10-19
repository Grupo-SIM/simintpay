import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { calculateFinancials, resolvePolicy, validatePolicy } from "../financial-policy";

test("legacy SQL migrates defaults and overrides while preserving revisions and avoiding double processing costs", async () => {
 const db = new PGlite();
 try {
 await db.exec(`
 CREATE TABLE "PlatformTaxaOverride" ("tag" text, "key" text, "value" numeric);
 CREATE TABLE "Platform" ("tag" text, "acquirer" text);
 CREATE TABLE "FinancialPolicyRevision" ("id" text PRIMARY KEY,"tag" text,"version" int,"document" jsonb,"actorId" text);
 INSERT INTO "Platform" VALUES ('SHOP','DOM'),('CUSTOM','DOM'),('OTHER','FRENDZ');
 INSERT INTO "PlatformTaxaOverride" VALUES ('GLOBAL','LINK_COST_1X',0.12),('CUSTOM','LINK_COST_2X',0.2),('CUSTOM','TAXA_LINK_FIXA',0),('CUSTOM','MDR_LINK_2X',0.05);
 INSERT INTO "FinancialPolicyRevision" VALUES ('old','SHOP',1,'{"schemaVersion":1,"lanes":{},"owner":{"DOM/CREDIT_CARD/ONLINE/2":{"fixedCents":100,"ratePpm":0,"passInterestPpm":500000}},"legacyAudit":{"keep":true}}','old');
 `);
 const sql = await Bun.file(import.meta.dir + "/../../../../prisma/migrations/20261019140000_migrate_legacy_administrative_rates/migration.sql").text();
 await db.exec(sql);
 const rows = (await db.query<any>('SELECT * FROM "FinancialPolicyRevision" ORDER BY "version" DESC')).rows;
 const global = rows.find(r=>r.tag==='GLOBAL').document;
 const custom = rows.find(r=>r.tag==='CUSTOM').document;
 const shop = rows.find(r=>r.tag==='SHOP').document;
 validatePolicy(global); validatePolicy(custom);
 expect(Object.keys(global.lanes)).toHaveLength(29);
 expect(rows.filter(r=>r.tag==='SHOP')).toHaveLength(1);
 expect(shop.legacyAudit).toEqual({keep:true});
 expect(rows.some(r=>r.tag==='OTHER')).toBe(false);
 const p=resolvePolicy(global,shop,'1:1');
 const one=calculateFinancials(p,'DOM/CREDIT_CARD/ONLINE/1',10000);
 expect(one.contractedCostCents).toBe(1600);
 expect(one.buyerTotalCents).toBe(10000);
 const c=resolvePolicy(global,custom,'1:1');
 expect(custom.lanes['DOM/CREDIT_CARD/ONLINE/2'].sim.fixedCents).toBe(0);
 expect(calculateFinancials(c,'DOM/CREDIT_CARD/ONLINE/2',10000).contractedCostCents).toBe(3051);
 const pos=calculateFinancials(p,'DOM/CREDIT_CARD/POS/1',10000);
 expect(pos.contractedCostCents).toBe(900);
 const boleto=calculateFinancials(p,'DOM/BOLETO/ONLINE/1',10000);
 expect(boleto.contractedCostCents).toBe(900);
 // Existing explicit lanes win over migrated fields; migration leaves history intact.
 await db.exec(`UPDATE "FinancialPolicyRevision" SET "document" = jsonb_set("document", '{lanes,DOM/CREDIT_CARD/ONLINE/1,sim,ratePpm}', '130000') WHERE "tag"='GLOBAL'`);
 await db.exec(sql);
 expect((await db.query('SELECT * FROM "FinancialPolicyRevision"')).rows).toHaveLength(rows.length);
 const after = (await db.query<any>(`SELECT "document" FROM "FinancialPolicyRevision" WHERE "tag"='GLOBAL'`)).rows[0].document;
 expect(after.lanes['DOM/CREDIT_CARD/ONLINE/1'].sim.ratePpm).toBe(130000);
 } finally { await db.close(); }
},180000);

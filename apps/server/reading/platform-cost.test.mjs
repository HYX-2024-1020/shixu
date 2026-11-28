import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync,rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ReadingLedger } from "./ledger.mjs";
import { DatabaseSync } from "node:sqlite";
import { ensureDatabaseSchema } from "../database-schema.mjs";
import { LEDGER_CORE_SCHEMA } from "../database-schemas.mjs";
const price={id:"fixture",model:"synthetic",currency:"CNY",source:"synthetic",verifiedAt:1,inputMicrosPerMillion:1000000,cachedMicrosPerMillion:0,outputMicrosPerMillion:1000000};
test("billing schema upgrade fences an old running writer and refuses binary downgrade",t=>{
 const dir=mkdtempSync(join(tmpdir(),"platform-cost-old-writer-")),path=join(dir,"ledger.sqlite"),old=new DatabaseSync(path);
 const opts={compatibleObjects:["CREATE INDEX reading_calls_account_task ON reading_calls(account,task)"]};
 ensureDatabaseSchema(old,"ledger-core",LEDGER_CORE_SCHEMA.slice(0,-1),opts);
 const current=new ReadingLedger(path);
 t.after(()=>{old.close();current.close();rmSync(dir,{recursive:true,force:true});});
 assert.throws(()=>old.prepare("INSERT INTO reading_wallets VALUES('old',1,0)").run(),/INCOMPATIBLE_SCHEMA_WRITER/);
 assert.throws(()=>ensureDatabaseSchema(old,"ledger-core",LEDGER_CORE_SCHEMA.slice(0,-1),opts),/DATABASE_SCHEMA_MISMATCH/);
});
function fixture(t) {
 const dir=mkdtempSync(join(tmpdir(),"platform-cost-")),path=join(dir,"ledger.sqlite");
 let ledger=new ReadingLedger(path);ledger.freezePrice(price);ledger.grantInitial("a");ledger.grantInitial("b");
 t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
 return {get ledger(){return ledger;},reopen(){ledger.close();ledger=new ReadingLedger(path);return ledger;},
 call(id="call",account="a",state="unknown") {ledger.reserve({callId:id,account,task:"task-"+id,block:"b-"+id,generation:1,priceId:"fixture",maxPromptTokens:100,maxOutputTokens:100});if(state!=="reserved")ledger.sent(id);if(state==="unknown")ledger.unknown(id);}};
}
test("platform coverage releases only reviewed user risk, preserves raw unknown and site exposure across restart",t=>{
 const f=fixture(t);f.call();f.call("other","b");const l=f.ledger;
 const before=l.wallet("a"),other=l.wallet("b"),budget=l.budget(),original=l.call("call"),review=l.platform.preview("a");
 const covered=l.platform.cover("a",review.fingerprint,"cover-operation","admin");
 assert.equal(covered.releasedMicro,200);assert.equal(l.wallet("a").available,before.available+200);assert.equal(l.wallet("a").spent,0);assert.equal(l.wallet("a").unknownRisk,0);
 assert.deepEqual(l.call("call"),original);assert.deepEqual(l.wallet("b"),other);assert.deepEqual(l.budget(),budget);assert.equal(l.taskHasUnresolvedCost("a","task-call"),false);
 assert.equal(l.lastCostAudit("a","task-call").operation,"platform:cover-operation");assert.equal(l.recoveryOperation("a"),"platform:cover-operation");
 assert.deepEqual(l.platform.cover("a",review.fingerprint,"cover-operation","admin"),covered);
 assert.throws(()=>l.platform.cover("a",review.fingerprint,"cover-operation","other-admin"),/IDEMPOTENCY_CONFLICT/);
 assert.equal(l.audit().valid,true);assert.equal(f.reopen().wallet("a").unknownRisk,0);assert.equal(f.ledger.audit().valid,true);
});
test("stale, cross-account and in-flight reviews cannot release unknown or active reservations",t=>{
 const f=fixture(t);f.call();const l=f.ledger,review=l.platform.preview("a");
 assert.throws(()=>l.platform.cover("b",review.fingerprint,"cross-account","admin"),/STALE_PLATFORM_COST_REVIEW/);
 f.call("next");assert.throws(()=>l.platform.cover("a",review.fingerprint,"stale-review","admin"),/STALE_PLATFORM_COST_REVIEW/);
 f.call("sent","a","sent");const current=l.platform.preview("a");assert.equal(current.draining,true);
 assert.throws(()=>l.platform.cover("a",current.fingerprint,"still-sent","admin"),/TASK_STILL_DRAINING/);assert.equal(l.platform.covered("call"),undefined);
});
test("late trusted usage belongs to the platform and never charges user quota or erases actual supplier cost",t=>{
 const f=fixture(t);f.call();const l=f.ledger,r=l.platform.preview("a");l.platform.cover("a",r.fingerprint,"cover-late-fee","admin");
 const wallet=l.wallet("a");l.settle("call",{prompt_tokens:10,completion_tokens:4});
 assert.equal(l.call("call").state,"settled");assert.equal(l.call("call").actual,14);assert.deepEqual(l.wallet("a"),wallet);assert.equal(l.usageSummary("a").daySpentMicro,0);assert.equal(l.budget().daySpentMicro,14);
 l.settle("call",{prompt_tokens:10,completion_tokens:4});assert.equal(l.audit().valid,true);assert.equal(l.wallet("a").spent,0);
 assert.equal(l.db.prepare("SELECT kind FROM reading_events WHERE operation='settle:call'").get().kind,"platform-settle");
});
test("coverage is append-only, atomic and authority anchored against partial decision rollback",t=>{
 const f=fixture(t);f.call();const l=f.ledger,r=l.platform.preview("a"),prepare=l.db.prepare.bind(l.db);
 l.db.prepare=sql=>sql.startsWith("INSERT INTO reading_platform_cost_calls")?{run(){throw Error("fixture-disk-failure");}}:prepare(sql);
 assert.throws(()=>l.platform.cover("a",r.fingerprint,"disk-failure","admin"),/fixture-disk-failure/);l.db.prepare=prepare;assert.equal(l.wallet("a").unknownRisk,200);assert.equal(l.db.prepare("SELECT count(*) n FROM reading_platform_cost_operations").get().n,0);
 l.platform.cover("a",r.fingerprint,"disk-failure","admin");
 assert.throws(()=>l.db.exec("DELETE FROM reading_platform_cost_calls"),/APPEND_ONLY/);
 assert.throws(()=>l.db.exec("UPDATE reading_platform_cost_operations SET actor='other'"),/APPEND_ONLY/);
 l.db.exec("DROP TRIGGER reading_platform_cost_calls_no_delete; DELETE FROM reading_platform_cost_calls");
 assert.throws(()=>l.wallet("a"),/PLATFORM_COST_RECONCILIATION/);
});

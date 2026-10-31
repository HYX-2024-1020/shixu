import assert from "node:assert/strict";
import {
  readFileSync,
  mkdirSync,
  copyFileSync,
  statSync,
  accessSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";
import { createMultiUserService } from "../server/sync-multi-user.mjs";
import { ReadingLedger } from "../server/reading/ledger.mjs";
const require = createRequire(import.meta.url);
const { AccountWorkspace } = require("../desktop/accounts.cjs");
const { DesktopStore } = require("../desktop/storage.cjs");
const { SERVICE_ORIGIN } = require("../miniprogram/lib/accounts.js");
const pagePath = fileURLToPath(
  new URL("../miniprogram/pages/index/index.js", import.meta.url),
);
const tick = () => new Promise((done) => setTimeout(done, 10));

export async function runClientLoop({
  directory,
  reader,
  original,
  originalQuota,
  sourceByMini = false,
  verifyLifecycle = false,
  failLocalWrite = false,
  expectedReadPause,
  expireBeforeStart = false,
  startByMini = false,
  deleteBeforeStart = false,
  reviseAfterPublication = false,
  rollbackRootAfterStop = false,
  auditAfterReadLimit = false,
  auditUnknownTime = false,
  auditCheckpoint = false,
  costAudit,
  itemChat,
  semanticMerge,
}) {
  let originalNow = Date.now();
  const ledger = new ReadingLedger(join(directory, "ledger.sqlite"));
  ledger.freezePrice({
    id: "synthetic",
    model: "synthetic",
    currency: "CNY",
    source: "synthetic fixture, no provider request",
    verifiedAt: 1,
    inputMicrosPerMillion: 1000000,
    cachedMicrosPerMillion: 100000,
    outputMicrosPerMillion: 1000000,
  });
  let release, enter;
  const entered = new Promise((done) => {
    enter = done;
  });
  const held = new Promise((done) => {
    release = done;
  });
  let calls = 0,
    parserRuns = 0,
    tailSeen = false;
  const auditText=[];
  const costEvidence=new Map();
  const reading = {
    ...(auditCheckpoint ? {
      maintenanceAuthorize:({actor,operation})=>actor==="synthetic-maintainer" && operation==="reconcile-root-checkpoint",
      maintenanceVerifyCheckpoint:({account,evidenceHash,review})=>({account,evidenceHash,rootTaskId:review.rootTaskId,
        generation:review.generation,watermark:review.watermark,snapshotHash:review.snapshotHash,reason:review.reason,
        reference:"synthetic-final-checkpoint-review",final:true,disposition:"resume-next-checkpoint"}),
    } : {}),
    ...(costAudit ? {
      maintenanceAuthorize:({actor,operation})=>actor==="synthetic-maintainer" && operation==="reconcile-call-cost",
      maintenanceVerifyCost:({call,evidenceHash})=>{
        const proof=costEvidence.get(evidenceHash);
        return proof && proof.callId===call.id && proof.fingerprint===call.fingerprint ? proof : null;
      },
    } : {}),
    ...(auditAfterReadLimit ? {activeLimitMs:80,maintenanceAuthorize:({actor,operation})=>actor==="synthetic-maintainer" && operation==="extend-root-time"} : {}),
    ...(auditUnknownTime
      ? {
          maintenanceAuthorize: ({ actor, operation }) =>
            actor === "synthetic-maintainer" &&
            operation === "reconcile-root-time",
          maintenanceVerifyTime: ({ account, evidenceHash, review }) => ({
            account,
            evidenceHash,
            rootTaskId: review.rootTaskId,
            generation: review.generation,
            watermark: review.watermark,
            snapshotHash: review.snapshotHash,
            stepIds: review.steps.map((s) => s.id),
            additionalActiveMs: 321,
            final: true,
            reference: "synthetic-reader-confirmed-terminated-upper-bound",
          }),
        }
      : {}),
    ...(originalQuota === undefined
      ? {}
      : { originals: { quota: originalQuota, now: () => originalNow } }),
    ledger,
    enabled: true,
    reader: Object.assign(async (...args) => {
      parserRuns++;
      return reader(...args);
    }, {pdfWindows:reader.pdfWindows === true,archiveWindows:reader.archiveWindows === true,imageWindows:reader.imageWindows===true,pdfVisualWindows:reader.pdfVisualWindows===true}),
    priceId: "synthetic",
    modelVersion: "synthetic/1",
    provider: async (sources) => {
      calls++;
      if(costAudit && calls===2)throw Error("synthetic provider response lost");
      if (auditAfterReadLimit || auditUnknownTime || costAudit) auditText.push(...sources.map(s=>s.text));
      if (calls === 1) {
        enter();
        if (!auditAfterReadLimit && !auditUnknownTime && !costAudit) await held;
      }
      tailSeen ||= sources.some((s) => (original?.tailSourceSuffix && s.id.endsWith(original.tailSourceSuffix)) || s.text.includes("尾部唯一标记") || (s.image && original?.expectedImageTiles && s.id.endsWith("_i"+original.expectedImageTiles)));
      return {
        usage: { prompt_tokens: 10, completion_tokens: 10 },
        result: {
          summary: "合成摘要",
          warnings: [],
          items: [
            {
              kind: "note",
              title: "有来源的合成事项",
              summary: "合成事项",
              facts: [],
              nextSteps: [],
              uncertainties: [],
              due: null,
              evidence: [
                {
                  sourceId: sources[0].id,
                  quote: sources[0].text.slice(0, 10),
                },
              ],
            },
          ],
        },
      };
    },
  };
  if(reader.imageWindows===true)reading.provider.imageInput=true;
  if(itemChat)reading.provider.chat=itemChat.provider;
  if(semanticMerge)reading.provider.merge=async (...args)=>{calls++;return semanticMerge.provider(...args);};
  const service = createMultiUserService({
    directory: join(directory, "server"),
    secret: "synthetic-v4-client-secret-with-32-characters",
    reading,
    wechat: async (code) => "synthetic-" + code,
  });
  await new Promise((done) => service.server.listen(0, "127.0.0.1", done));
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const cloud = new AccountWorkspace({
    root: join(directory, "windows"),
    local: new DesktopStore(join(directory, "local")),
    serviceOrigin: base,
    seal: async (s) => Buffer.from(s),
    unseal: async (b) => b.toString(),
    confirmTemporaryLoss: async () => true,
  }); // Synthetic harness only, never a personal profile.
  let page;
  try {
    const invite = service.registry.generate(1)[0].invite;
    await cloud.init();
    await cloud.action("activate", { invite });
    const account = cloud.config.devices[cloud.config.active].userId;
    service.registry.limits(account, { requestsPerMinute: 1000 }); // Burst-heavy synthetic replay only.
    ledger.grantInitial(account); // Explicit synthetic reconciliation, never automatic on login.
    const response = await fetch(base + "/api/v3/activate/wechat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite, code: "client-a" }),
    });
    const binding = await response.json();
    assert.equal(response.status, 201);
    let definition;
    const storage = new Map();
    const wx = {
      ...(sourceByMini
        ? {
            env: { USER_DATA_PATH: join(directory, "mini") },
            getFileSystemManager: () => ({
              accessSync,
              mkdirSync: (p) => mkdirSync(p, { recursive: true }),
              copyFileSync,
              statSync,
              readFileSync: (p) => {
                const b = readFileSync(p);
                return b.buffer.slice(
                  b.byteOffset,
                  b.byteOffset + b.byteLength,
                );
              },
              writeFileSync: (p, b) => writeFileSync(p, Buffer.from(b)),
              unlinkSync,
            }),
          }
        : {}),
      getStorageSync: (k) => storage.get(k),
      setStorageSync: (k, v) => storage.set(k, structuredClone(v)),
      getAccountInfoSync: () => ({ miniProgram: { envVersion: "develop" } }),
      onNetworkStatusChange() {},
      offNetworkStatusChange() {},
      showToast() {},
      request: async (options) => {
        try {
          const res = await fetch(options.url.replace(SERVICE_ORIGIN, base), {
            method: options.method,
            headers: options.header,
            ...(options.data
              ? {
                  body:
                    options.header?.["Content-Type"] ===
                    "application/octet-stream"
                      ? options.data
                      : JSON.stringify(options.data),
                }
              : {}),
          });
          options.success({
            statusCode: res.status,
            data:
              options.responseType === "arraybuffer"
                ? await res.arrayBuffer()
                : await res.json(),
          });
        } catch (e) {
          options.fail(e);
        }
      },
    };
    vm.runInNewContext(readFileSync(pagePath, "utf8"), {
      Page: (value) => {
        definition = value;
      },
      wx,
      getApp: () => ({ globalData: {} }),
      require: createRequire(pagePath),
      setInterval,
      clearInterval,
      setTimeout,
      clearTimeout,
    });
    page = {
      ...definition,
      data: structuredClone(definition.data),
      setData(value) {
        Object.assign(this.data, value);
      },
    };
    page.onLoad();
    page._activate({ ...binding, base: SERVICE_ORIGIN });
    const body =
      original?.body ||
      Buffer.from("合成报告要求与顺序😀。\n".repeat(20000) + "尾部唯一标记");
    if (failLocalWrite)
      mkdirSync(
        cloud
          .space()
          .cache.file(
            "files/" +
              createHash("sha256").update(body).digest("hex") +
              ".next",
          ),
        { recursive: true },
      );
    if (sourceByMini) {
      mkdirSync(join(directory, "mini"), { recursive: true });
      const file = join(directory, "mini", "source.txt");
      writeFileSync(file, body);
      page._client.put("packet", {
        text: "",
        attachments: [],
        sources: [],
        result: null,
        doneIds: [],
        status: "pending",
        captureDate: "2026-10-28",
        capturedAt: "2026-10-28T00:00:00Z",
      });
      page
        ._library()
        .add(
          { path: file, name: original?.name || "合成.txt", size: body.length },
          "packet",
          page._space(),
        );
      await page.sync();
      assert.equal(page.data.error, "");
    } else
      await cloud.call(
        "savePackets",
        [
          {
            id: "packet",
            text: "",
            sources: [
              { id: "forged", name: "客户端伪造正文", text: "禁止信任" },
            ],
            attachments: [
              {
                id: "original",
                name: original?.name || "合成.txt",
                type: original?.type || "text/plain",
                bytes: body,
              },
            ],
            captureDate: "2026-10-28",
            capturedAt: "2026-10-28T00:00:00.000Z",
            updatedAt: "2026-10-28T00:00:00.000Z",
            doneIds: [],
            result: null,
            status: "pending",
          },
        ],
        cloud.config.active,
      );
    await cloud.action("sync");
    if (expireBeforeStart) originalNow += 31 * 60 * 1000;
    if (deleteBeforeStart) {
      const row = cloud.status().originalStorage.originals[0];
      await cloud.action("deleteOriginal", { ...row, stopTask: true });
    }
    let initial;
    if (startByMini) {
      await page.sync();
      await page._startJob("organize", "packet");
      assert.equal(page.data.error, "");
      initial = { job: page._jobs.at(-1).id };
    } else
      initial = await cloud.action("ai", {
        kind: "organize",
        packetId: "packet",
      });
    if(costAudit) {
      while(service.readingRoutes.snapshot().accounts)await tick();
      await cloud.action("sync");await page.sync();
      const win=cloud.readJobs().find(j=>j.id===initial.job),mini=page._jobs.find(j=>j.id===initial.job);
      assert.equal(win.reason,"UNKNOWN_COST");assert.equal(mini.reason,win.reason);
      assert.ok(!win.actions.includes("continue"));assert.equal(page.data.jobs.find(j=>j.id===initial.job).canContinue,false);
      assert.equal(calls,2);assert.equal(ledger.wallet(account).spent,20);assert.ok(ledger.wallet(account).unknownRisk>0);
      const cleaned=await cloud.request(cloud.config.active,"GET","/api/v4/storage");
      if(originalQuota===1 || deleteBeforeStart)assert.equal(cleaned.originals[0].available,false);
      await cloud.reuploadTemporary("packet");
      await assert.rejects(cloud.request(cloud.config.active,"POST","/api/v4/maintenance/reconcile-cost",{
        contractVersion:1,actor:"synthetic-maintainer",usage:{prompt_tokens:0,completion_tokens:0},notBilled:true,
      }),e=>e.code==="NOT_FOUND");
      await assert.rejects(cloud.request(cloud.config.active,"POST",`/api/v4/tasks/${initial.job}/continue`,{
        contractVersion:1,operationId:crypto.randomUUID(),expectedGeneration:win.generation,expectedRevision:win.inputRevision,
        actor:"synthetic-maintainer",usage:{prompt_tokens:0,completion_tokens:0},notBilled:true,
      }),e=>e.code==="UNKNOWN_COST");
      const review=service.readingRoutes.costMaintenanceReview(account,initial.job,"synthetic-maintainer");
      const call=review.unknownCalls[0];
      const evidenceHash=createHash("sha256").update(`synthetic billing ${costAudit}:${call.id}`).digest("hex");
      costEvidence.set(evidenceHash,{account,callId:call.id,fingerprint:call.fingerprint,priceId:call.price,evidenceHash,
        reference:"synthetic-final-statement",final:true,disposition:costAudit,usage:costAudit==="usage"?{prompt_tokens:30,completion_tokens:10}:null});
      const request={operationId:crypto.randomUUID(),expectedGeneration:review.generation,expectedWatermark:review.watermark,
        expectedLedgerSequence:review.ledgerSequence,callId:call.id,evidenceHash};
      const receipt=service.readingRoutes.reconcileCallCost(account,initial.job,request,"synthetic-maintainer");
      assert.deepEqual(service.readingRoutes.reconcileCallCost(account,initial.job,request,"synthetic-maintainer"),receipt);
      const oldCreation={id:crypto.randomUUID(),packetId:"packet",kind:"organize",contractVersion:1,
        epoch:cloud.config.devices[cloud.config.active].epoch,baseVersion:1,expectedCostOperation:null};
      cloud.writeJobs([...cloud.readJobs(),{id:oldCreation.id,state:"submitting",protocol:4,request:oldCreation}]);
      const miniCreation={...oldCreation,id:crypto.randomUUID()};
      page._saveJobs([...page._jobs,{id:miniCreation.id,state:"submitting",protocol:4,request:miniCreation}]);
      const miniCreationId=miniCreation.id;
      await cloud.pollJobs();await page._pollJobs();
      assert.equal(cloud.readJobs().find(j=>j.id===oldCreation.id).state,"error");
      assert.match(cloud.readJobs().find(j=>j.id===oldCreation.id).error,/费用核对状态已变化/);
      assert.equal(page._jobs.find(j=>j.id===miniCreationId).state,"error");
      assert.match(page._jobs.find(j=>j.id===miniCreationId).error,/费用核对状态已变化/);
      assert.equal(calls,2);
      const oldIntent={action:"continue",contractVersion:1,operationId:crypto.randomUUID(),expectedGeneration:win.generation,
        expectedRevision:win.inputRevision,expectedMaintenanceOperation:win.maintenanceOperation};
      cloud.writeJobs(cloud.readJobs().map(j=>j.id===initial.job?{...j,pendingAction:oldIntent}:j));
      page._saveJobs(page._jobs.map(j=>j.id===initial.job?{...j,pendingAction:{...oldIntent,operationId:crypto.randomUUID()}}:j));
      await assert.rejects(cloud.pollJobs(),e=>e.code==="STALE_TASK");
      await assert.rejects(page._pollJobs(),e=>e.code==="STALE_TASK");
      assert.equal(cloud.readJobs().find(j=>j.id===initial.job).pendingAction,null);
      assert.equal(page._jobs.find(j=>j.id===initial.job).pendingAction,null);assert.equal(calls,2);
      await cloud.action("sync");await page.sync();
      const audited=cloud.readJobs().find(j=>j.id===initial.job);
      assert.equal(audited.reason,"COST_RECONCILIATION_AUDITED");
      assert.match(audited.error,/缺失结果继续整理可能再次计费/);
      assert.equal(page._jobs.find(j=>j.id===initial.job).error,audited.error);
      assert.ok(audited.actions.includes("continue"));assert.equal(page.data.jobs.find(j=>j.id===initial.job).canContinue,true);
      assert.equal(calls,2);assert.equal(ledger.wallet(account).unknownRisk,0);
      await page.taskAction({currentTarget:{dataset:{id:initial.job,action:"continue"}}});
      while(service.readingRoutes.snapshot().accounts)await tick();
      await page.sync();await cloud.action("sync");
      const finished=cloud.readJobs().find(j=>j.id===initial.job),winPacket=(await cloud.packets())[0],miniPacket=page._record("packet").data;
      assert.equal(finished.state,"done");assert.equal(finished.rootCalls,calls);assert.ok(finished.rootActiveMs>=review.activeMs);
      assert.equal(ledger.wallet(account).spent,(calls-1)*20+(costAudit==="usage"?40:0));
      assert.equal(auditText.join(""),original.expectedText);assert.ok(tailSeen);
      assert.deepEqual(JSON.parse(JSON.stringify(winPacket.result)),JSON.parse(JSON.stringify(miniPacket.result)));
      assert.deepEqual(winPacket.readingCoverage,JSON.parse(JSON.stringify(miniPacket.readingCoverage)));
      if(original.verify)await original.verify({win:winPacket,mini:miniPacket,page,cloud,service});
      const storage=await cloud.request(cloud.config.active,"GET","/api/v4/storage");
      if(originalQuota===1 || deleteBeforeStart){assert.equal(storage.usedBytes,0);assert.equal(storage.originals[0].available,false);}
      if(deleteBeforeStart)assert.equal(storage.originals[0].state,"deleted");
      await page._startJob("organize","packet");assert.equal(page.data.error,"");
      const fresh=page._jobs.at(-1);
      assert.equal(fresh.request.expectedCostOperation,receipt.operation);
      while(service.readingRoutes.snapshot().accounts)await tick();
      await page.sync();await cloud.action("sync");
      const freshDone=cloud.readJobs().find(j=>j.id===fresh.id);
      assert.equal(freshDone.state,"done");assert.equal(freshDone.reusedBlocks,6);assert.equal(calls,7);
      const winFresh=await cloud.action("ai",{kind:"organize",packetId:"packet"});
      assert.equal(cloud.readJobs().find(j=>j.id===winFresh.job).request.expectedCostOperation,receipt.operation);
      while(service.readingRoutes.snapshot().accounts)await tick();
      await cloud.action("sync");await page.sync();
      const winFreshDone=cloud.readJobs().find(j=>j.id===winFresh.job);
      assert.equal(winFreshDone.state,"done");assert.equal(winFreshDone.reusedBlocks,6);assert.equal(calls,7);
      return {synthetic:true,realProviderCalls:0,auditedUnknownCost:true,disposition:costAudit,
        oldCreationReplayDeniedBoth:true,freshCreationNonceBoundBoth:true,freshCreationReusedBlocks:freshDone.reusedBlocks,windowsFreshCreationReusedBlocks:winFreshDone.reusedBlocks,
        simulatedProviderCalls:calls,spentMicros:ledger.wallet(account).spent,rootCalls:finished.rootCalls,
        spentBeforeAudit:review.spentMicros,spentAfterAudit:receipt.spent_after,unknownRiskBefore:review.unknownRiskMicros,unknownRiskAfter:ledger.wallet(account).unknownRisk,
        beforeActiveMs:review.activeMs,afterActiveMs:finished.rootActiveMs,oldPendingReplayDeniedBoth:true,
        noModelBeforeFreshContinue:true,forgedUserUsageDenied:true,paidPrefixPreserved:true,
        wholeExpectedTextOrderTailChecked:true,resultsAndCoverageEqual:true,originalNotRevived:originalQuota===1||deleteBeforeStart,
        miniTransport:"actual Page with Node wx adapter, not native WeChat",desktopTransport:"AccountWorkspace signed HTTP"};
    }
    if (expectedReadPause) {
      while (service.readingRoutes.snapshot().accounts) await tick();
      await cloud.action("sync");
      await page.sync();
      const win = cloud.readJobs().find((j) => j.id === initial.job);
      const mini = page._jobs.find((j) => j.id === initial.job);
      const view = page.data.jobs.find((j) => j.id === initial.job);
      assert.equal(win.reason, expectedReadPause);
      assert.equal(mini.reason, expectedReadPause);
      assert.equal(win.error, mini.error);
      assert.match(
        win.error,
        expectedReadPause === "EXECUTION_LIMIT"
          ? /活跃时间已用尽/
          : /活跃时间待核对/,
      );
      assert.ok(!win.actions.includes("continue"));
      assert.equal(view.canContinue, false);
      assert.ok(win.actions.includes("purge"));
      assert.equal(win.rootCalls, 0);
      assert.equal(calls, 0);
      assert.equal((await cloud.packets())[0].result, null);
      if (auditAfterReadLimit || auditUnknownTime) {
        assert.equal(expectedReadPause,auditUnknownTime ? "ACTIVE_TIME_RECONCILIATION" : "EXECUTION_LIMIT");
        await assert.rejects(cloud.request(cloud.config.active,"POST",`/api/v4/tasks/${initial.job}/continue`,{
          contractVersion:1,operationId:crypto.randomUUID(),expectedGeneration:win.generation,expectedRevision:win.inputRevision,
          actor:"synthetic-maintainer",newLimitMs:3600000,
        }),auditUnknownTime ? /活跃时间待核对/ : /累计活跃时间已用尽/);
        const review=service.readingRoutes[auditUnknownTime ? "timeMaintenanceReview" : "maintenanceReview"](account,initial.job,"synthetic-maintainer");
        const request={operationId:crypto.randomUUID(),expectedGeneration:review.generation,expectedWatermark:review.watermark,
          ...(auditUnknownTime ? {expectedLedgerSequence:review.ledgerSequence} : {newLimitMs:3600000}),evidenceHash:createHash("sha256").update("synthetic active time review").digest("hex")};
        const receipt=service.readingRoutes[auditUnknownTime ? "reconcileRootTime" : "extendExecutionLimit"](account,initial.job,request,"synthetic-maintainer");
        assert.deepEqual(service.readingRoutes[auditUnknownTime ? "reconcileRootTime" : "extendExecutionLimit"](account,initial.job,request,"synthetic-maintainer"),receipt);
        // Crash-persisted intents from before this audit must not become a
        // newly authorized model run merely because sync replays them later.
        const oldIntent={action:"continue",contractVersion:1,operationId:crypto.randomUUID(),
          expectedGeneration:win.generation,expectedRevision:win.inputRevision};
        cloud.writeJobs(cloud.readJobs().map(j=>j.id===initial.job?{...j,pendingAction:oldIntent}:j));
        page._saveJobs(page._jobs.map(j=>j.id===initial.job?{...j,pendingAction:{...oldIntent,operationId:crypto.randomUUID(),expectedMaintenanceOperation:null}}:j));
        await assert.rejects(cloud.pollJobs(),e=>e.code==="STALE_TASK");
        await assert.rejects(page._pollJobs(),e=>e.code==="STALE_TASK");
        assert.equal(cloud.readJobs().find(j=>j.id===initial.job).pendingAction,null);
        assert.equal(page._jobs.find(j=>j.id===initial.job).pendingAction,null);
        assert.equal(calls,0);
        await cloud.action("sync"); await page.sync();
        const reviewed=cloud.readJobs().find(j=>j.id===initial.job);
        assert.equal(reviewed.reason,auditUnknownTime ? "ACTIVE_TIME_AUDITED" : "EXECUTION_LIMIT_AUDITED");assert.match(reviewed.error,auditUnknownTime ? /活跃时间已核对并保守补计/ : /维护核对已延长/);
        assert.ok(reviewed.actions.includes("continue"));assert.equal(page.data.jobs.find(j=>j.id===initial.job).canContinue,true);
        assert.equal(calls,0);
        await page.taskAction({currentTarget:{dataset:{id:initial.job,action:"continue"}}});
        while(service.readingRoutes.snapshot().accounts)await tick();
        await page.sync();await cloud.action("sync");
        const finished=cloud.readJobs().find(j=>j.id===initial.job);
        assert.equal(finished.state,"done");assert.ok(finished.rootActiveMs >= review.activeMs);
        const winPacket=(await cloud.packets())[0],miniPacket=page._record("packet").data;
        assert.deepEqual(JSON.parse(JSON.stringify(winPacket.result)),JSON.parse(JSON.stringify(miniPacket.result)));
        assert.ok(tailSeen);assert.equal(ledger.wallet(account).spent,calls*20);
        if (typeof original?.expectedText === "string") assert.equal(auditText.join(""),original.expectedText);
        if(original?.expectedPdfPages)assert.equal(winPacket.readingCoverage[0].pagination.totalPages,original.expectedPdfPages);
        if(originalQuota===1){
          const storage=await cloud.request(cloud.config.active,"GET","/api/v4/storage");
          assert.equal(storage.usedBytes,0);assert.equal(storage.originals[0].available,false);
          assert.equal(storage.originals[0].mode,"temporary");
        }
        return {synthetic:true,realProviderCalls:0,auditedKnownTime:!auditUnknownTime,auditedUnknownTime:auditUnknownTime,forgedUserAuditDenied:true,
          explicitUserContinue:true,rootCountersRetained:true,resultsEqual:true,tailSeen,simulatedProviderCalls:calls,spentMicros:calls*20,
          oldPendingReplayDeniedBoth:true,noModelBeforeFreshContinue:true,
          completeExpectedTextChecked:typeof original?.expectedText === "string",
          temporaryOriginalNotRevived:originalQuota===1,
          beforeActiveMs:review.activeMs,afterActiveMs:finished.rootActiveMs,pdfPages:original?.expectedPdfPages,
          miniTransport:"actual Page lifecycle with Node wx adapter, not native WeChat",desktopTransport:"AccountWorkspace signed HTTP"};
      }
      return {
        synthetic: true,
        realProviderCalls: 0,
        expectedReadPause,
        sameReasonAndActions: true,
        noModelOrPublication: true,
      };
    }
    let entryTimer;
    try {
      await Promise.race([
        entered,
        new Promise((_, reject) => {
          entryTimer = setTimeout(async () => {
            const latest = await cloud.request(
              cloud.config.active,
              "GET",
              "/api/v4/tasks",
            );
            reject(
              Error(
                "Synthetic provider not entered: " + JSON.stringify(latest),
              ),
            );
          }, 8000);
        }),
      ]);
    } finally {
      clearTimeout(entryTimer);
    }
    await page.sync();
    assert.equal(page.data.error, "");
    const task = page._jobs.find((j) => j.id === initial.job);
    assert.ok(task?.actions.includes("stop"));
    await page.taskAction({
      currentTarget: { dataset: { id: task.id, action: "stop" } },
    });
    assert.equal(page._jobs.find((j) => j.id === task.id).state, "cancelled");
    if (originalQuota === 1) {
      const storage = await cloud.request(
        cloud.config.active,
        "GET",
        "/api/v4/storage",
      );
      assert.equal(storage.usedBytes, 0);
      assert.equal(storage.originals[0].available, false);
      assert.equal(storage.originals[0].mode, "temporary");
    }
    if (deleteBeforeStart) {
      const storage = await cloud.request(
        cloud.config.active,
        "GET",
        "/api/v4/storage",
      );
      assert.equal(storage.originals[0].state, "deleted");
      assert.equal(storage.originals[0].available, false);
      assert.equal(storage.originals[0].readingAvailable, false);
      assert.equal(storage.usedBytes, 0);
    }
    release();
    while (service.readingRoutes.snapshot().accounts) await tick();
    await cloud.action("sync");
    assert.equal(
      cloud.readJobs().find((j) => j.id === task.id).state,
      "cancelled",
    );
    assert.equal((await cloud.packets())[0].result, null);
    await page.sync();
    if(auditCheckpoint) {
      // Fixture-only independent settled calls reproduce a full no-progress
      // interval without making 23 redundant provider invocations.
      for(let n=1;n<24;n++){
        const callId="checkpoint-fixture-"+n;
        ledger.reserve({callId,account,task:task.id,block:callId,generation:1,priceId:"synthetic",maxPromptTokens:10,maxOutputTokens:10});
        ledger.sent(callId);ledger.settle(callId,{prompt_tokens:10,completion_tokens:10});
      }
      calls=24;
      const db=new DatabaseSync(join(directory,"server","users",account,"workspace.sqlite"));
      try{
        db.prepare("UPDATE reading_tasks SET calls=24,reason='CHECKPOINT_NO_PROGRESS' WHERE id=?").run(task.id);
        db.prepare("UPDATE reading_roots SET reason='CHECKPOINT_NO_PROGRESS' WHERE id=?").run(task.id);
        db.prepare("INSERT INTO reading_root_checkpoints VALUES(?,24,0,480,0,0,'CHECKPOINT_NO_PROGRESS')").run(task.id);
      } finally { db.close(); }
      await cloud.action("sync");await page.sync();
      const blocked=cloud.readJobs().find(j=>j.id===task.id);
      assert.equal(blocked.reason,"CHECKPOINT_NO_PROGRESS");assert.equal(page.data.jobs.find(j=>j.id===task.id).canContinue,false);
      await assert.rejects(cloud.request(cloud.config.active,"POST",`/api/v4/tasks/${task.id}/continue`,{
        contractVersion:1,operationId:crypto.randomUUID(),expectedGeneration:blocked.generation,expectedRevision:blocked.inputRevision,
        actor:"synthetic-maintainer",evidenceHash:"0".repeat(64),
      }),/累计24次调用未取得新增有效块/);
      const review=service.readingRoutes.checkpointMaintenanceReview(account,task.id,"synthetic-maintainer");
      const request={operationId:crypto.randomUUID(),expectedGeneration:review.generation,expectedWatermark:review.watermark,
        expectedLedgerSequence:review.ledgerSequence,evidenceHash:createHash("sha256").update("synthetic checkpoint review").digest("hex")};
      service.readingRoutes.reconcileRootCheckpoint(account,task.id,request,"synthetic-maintainer");
      const oldIntent={action:"continue",contractVersion:1,operationId:crypto.randomUUID(),expectedGeneration:blocked.generation,
        expectedRevision:blocked.inputRevision,expectedMaintenanceOperation:blocked.maintenanceOperation};
      cloud.writeJobs(cloud.readJobs().map(j=>j.id===task.id?{...j,pendingAction:oldIntent}:j));
      page._saveJobs(page._jobs.map(j=>j.id===task.id?{...j,pendingAction:{...oldIntent,operationId:crypto.randomUUID()}}:j));
      await assert.rejects(cloud.pollJobs(),e=>e.code==="STALE_TASK");await assert.rejects(page._pollJobs(),e=>e.code==="STALE_TASK");
      assert.equal(calls,24);
      await cloud.action("sync");await page.sync();
      const reviewed=cloud.readJobs().find(j=>j.id===task.id);
      assert.equal(reviewed.reason,"CHECKPOINT_AUDITED");assert.equal(page._jobs.find(j=>j.id===task.id).error,reviewed.error);
      assert.ok(reviewed.actions.includes("continue"));assert.equal(page.data.jobs.find(j=>j.id===task.id).canContinue,true);
      assert.equal(reviewed.rootCalls,24);assert.equal(reviewed.nextCheckpointCalls,48);assert.equal(calls,24);
    }
    if (rollbackRootAfterStop) {
      const before = cloud.readJobs().find(j=>j.id===task.id);
      assert.ok(before.rootActiveMs > 0);
      const db = new DatabaseSync(join(directory,"server","users",account,"workspace.sqlite"));
      try { db.prepare("UPDATE reading_tasks SET active_ms=0 WHERE id=?").run(task.id); }
      finally { db.close(); }
      await cloud.action("sync"); await page.sync();
      const win = cloud.readJobs().find(j=>j.id===task.id);
      const mini = page._jobs.find(j=>j.id===task.id);
      assert.equal(win.reason,"SAFETY_RECONCILIATION"); assert.equal(mini.reason,win.reason);
      assert.match(win.error,/资料进度与安全记录不一致/); assert.equal(mini.error,win.error);
      assert.ok(win.rootActiveMs >= before.rootActiveMs); assert.equal(win.rootActiveMs,mini.rootActiveMs);
      assert.ok(!win.actions.includes("continue")); assert.equal(page.data.jobs.find(j=>j.id===task.id).canContinue,false);
      await assert.rejects(cloud.action("taskAction",{id:task.id,action:"continue"}),/任务状态已变化/);
      await assert.rejects(cloud.request(cloud.config.active,"POST",`/api/v4/tasks/${task.id}/continue`,{
        contractVersion:1,operationId:crypto.randomUUID(),expectedGeneration:win.generation,expectedRevision:win.inputRevision,
      }),/资料进度与安全记录不一致/);
      assert.equal(calls,1); assert.equal(ledger.wallet(account).spent,20);
      assert.equal((await cloud.packets())[0].result,null);
      return {synthetic:true,realProviderCalls:0,simulatedProviderCalls:calls,spentMicros:20,
        rootActiveMs:win.rootActiveMs,sameReasonAndActions:true,continueDenied:true,
        desktopTransport:"AccountWorkspace signed HTTP",miniTransport:"Page lifecycle with Node wx adapter, not native WeChat"};
    }
    if (originalQuota === 1 && !sourceByMini)
      await cloud.action("taskAction", { id: task.id, action: "continue" });
    else
      await page.taskAction({
        currentTarget: { dataset: { id: task.id, action: "continue" } },
      });
    while (service.readingRoutes.snapshot().accounts) await tick();
    await page.sync();
    await cloud.action("sync");
    const win = (await cloud.packets())[0],
      mini = page._record("packet").data;
    assert.deepEqual(
      JSON.parse(JSON.stringify(win.result)),
      JSON.parse(JSON.stringify(mini.result)),
    );
    assert.equal(cloud.readJobs().find((j) => j.id === task.id).state, "done",JSON.stringify(cloud.readJobs().find(j=>j.id===task.id)));
    if (failLocalWrite)
      assert.match(cloud.status().localSaveNotice, /保存失败/);
    const winTask = cloud.readJobs().find((j) => j.id === task.id);
    const miniTask = page.data.jobs.find((j) => j.id === task.id);
    assert.equal(winTask.rootTaskId, task.id);
    assert.equal(winTask.rootCalls, calls);
    assert.equal(miniTask.rootCalls, winTask.rootCalls);
    assert.equal(miniTask.rootActiveSeconds, winTask.rootActiveSeconds);
    assert.ok(tailSeen);
    assert.ok(calls > 2);
    assert.equal(JSON.stringify(win.sources), "[]");
    assert.deepEqual(
      JSON.parse(JSON.stringify(win.readingCoverage)),
      JSON.parse(JSON.stringify(mini.readingCoverage)),
    );
    if (original?.verify)
      await original.verify({ win, mini, page, cloud, service });
    if(itemChat)await itemChat.verify({win,mini,page,cloud,service,ledger,account,parserRuns:()=>parserRuns});
    if(semanticMerge)await semanticMerge.verify({win,mini,page,cloud,service,ledger,account});
    if (original?.expectedPdfPages) {
      const c=win.readingCoverage[0];
      assert.equal(c.pagination.nextPage,null);
      assert.equal(c.pagination.totalPages,original.expectedPdfPages);
      assert.ok(!c.uncovered.some(r=>r.code==="PDF_WINDOW_PENDING"));
      const job=page.data.jobs.find(j=>j.id===task.id);
      assert.match(job.pdfProgressLabel,new RegExp(`已检查 ${original.expectedPdfPages} / ${original.expectedPdfPages} 页`));
    }
    let revisionEvidence;
    if (reviseAfterPublication) {
      const previousCalls = calls, previousSpent = ledger.wallet(account).spent;
      const previousJob = cloud.readJobs().find(j => j.id === task.id);
      page._client.put("packet", { text: "补充新的材料要求" });
      await page.sync();
      assert.equal(page.data.error, "");
      await page._startJob("organize", "packet");
      assert.equal(page.data.error, "");
      const revisionId = page._jobs.at(-1).id;
      while (service.readingRoutes.snapshot().accounts) await tick();
      await page.sync();
      await cloud.action("sync");
      const revised = cloud.readJobs().find(j => j.id === revisionId);
      const miniRevised = page._jobs.find(j => j.id === revisionId);
      assert.equal(revised.state, "done");
      assert.equal(calls, previousCalls + 1);
      assert.equal(revised.calls, 1);
      assert.equal(revised.reusedBlocks, previousJob.completedBlocks);
      assert.equal(miniRevised.reusedBlocks, revised.reusedBlocks);
      assert.equal(revised.rootCalls, previousJob.rootCalls + 1);
      assert.equal(ledger.wallet(account).spent, previousSpent + 20);
      assert.match(page.data.jobs.find(j => j.id === revisionId).reuseLabel, /已核验当前材料/);
      const revisedWin = (await cloud.packets())[0];
      assert.deepEqual(revisedWin.result, JSON.parse(JSON.stringify(page._record("packet").data.result)));
      assert.deepEqual(revisedWin.readingCoverage.filter(c => c.attachmentId !== "input"), win.readingCoverage);
      revisionEvidence = { reusedBlocks: revised.reusedBlocks, newCalls: revised.calls,
        rootCalls: revised.rootCalls, newSpentMicros: ledger.wallet(account).spent - previousSpent,
        currentOriginalRevalidated: true, dualClientResultAndLabelAgree: true };
    }
    if (deleteBeforeStart) {
      const storage = await cloud.request(
        cloud.config.active,
        "GET",
        "/api/v4/storage",
      );
      assert.equal(storage.originals[0].state, "deleted");
      assert.equal(storage.originals[0].readingAvailable, false);
      assert.equal(storage.usedBytes, 0);
    }
    if (verifyLifecycle) {
      await page.sync();
      const f = page.data.originalStorage.originals[0];
      assert.equal(f.mode, originalQuota === 1 ? "temporary" : "retained");
      if (f.mode === "retained") {
        await page.originalAction({
          currentTarget: {
            dataset: { id: f.id, packet: f.packetId, action: "renew" },
          },
        });
        assert.equal(page.data.error, "");
        await cloud.action("sync");
        assert.equal(
          cloud.status().originalStorage.originals[0].version,
          f.version + 1,
        );
        await page.originalAction({
          currentTarget: {
            dataset: { id: f.id, packet: f.packetId, action: "download" },
          },
        });
        assert.equal(page.data.error, "");
      }
      const row = cloud.status().originalStorage.originals[0];
      await cloud.action("deleteOriginal", { ...row, stopTask: true });
      await page.sync();
      assert.equal(page.data.error, "");
      assert.equal(page.data.originalStorage.originals[0].state, "deleted");
      assert.equal(cloud.status().originalStorage.usedBytes, 0);
      assert.deepEqual((await cloud.packets())[0].result, win.result);
      const afterDelete = (await cloud.packets())[0];
      await cloud.call(
        "savePackets",
        [{ ...afterDelete, error: "synthetic edit after original deletion" }],
        cloud.config.active,
      );
      await cloud.action("sync");
      await page.sync();
      assert.equal(
        page._record("packet").data.error,
        "synthetic edit after original deletion",
      );
      assert.equal(page.data.originalStorage.originals[0].state, "deleted");
    }
    const old = await cloud
      .request(cloud.config.active, "POST", "/api/v3/jobs", {
        kind: "organize",
      })
      .then(
        () => null,
        (e) => e.code,
      );
    assert.equal(old, "CLIENT_UPGRADE_REQUIRED");
    return {
      synthetic: true,
      realProviderCalls: 0,
      simulatedProviderCalls: calls-(auditCheckpoint?23:0),
      ...(auditCheckpoint?{fixtureSeededSentCalls:23,rootCalls:calls,auditedCheckpoint:true,oldPendingReplayDeniedBoth:true,noModelBeforeFreshContinue:true}:{}),
      bytes: body.length,
      parserRuns,
      tailSeen,
      desktopTransport:
        "AccountWorkspace with signed HTTP and isolated profile",
      miniTransport:
        "actual Page lifecycle with Node wx adapter, not WeChat UI",
      stopFromOtherDevice: true,
      continueFromOtherDevice: true,
      lateResponseDiscarded: true,
      resultsEqual: true,
      v3AIBlocked: true,
      spentMicros: ledger.wallet(account).spent,
      originalMode: originalQuota === 1 ? "temporary" : "retained",
      sourceByMini,
      expireBeforeStart,
      startByMini,
      deleteBeforeStart,
      lifecycleVerified: verifyLifecycle,
      ...(original?.expectedPdfPages ? {pdfPages:original.expectedPdfPages,pdfWindowsVerified:true} : {}),
      ...(revisionEvidence ? { revisionEvidence } : {}),
    };
  } finally {
    release();
    page?.onUnload?.();
    await new Promise((done) => service.server.close(done));
    await service.drained();
    ledger.close();
  }
}

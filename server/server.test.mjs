import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildGroups } from "../shared/relations.mjs";
const port = 19878,
  origin = `http://127.0.0.1:${port}`,
  data = resolve(".private/server-tests/" + Date.now());
mkdirSync(data, { recursive: true });
const preload = resolve(data, "mock-provider.mjs");
writeFileSync(
  preload,
  `globalThis.fetch=async(url,init)=>{
  if(url==='https://api.deepseek.com/models')return Response.json({data:[{id:'deepseek-flash'},{id:'deepseek-v4-pro'}]});
  if(url==='https://api.deepseek.com/user/balance')return Response.json({balance_infos:[{currency:'CNY',total_balance:'98.12'}]});
  if(url==='https://api.deepseek.com/chat/completions'){
    const body=JSON.parse(init.body),input=JSON.parse(body.messages[1].content);
    if(input.newItems){const a=input.newItems[0],b=input.openItems[0];return Response.json({model:body.model,usage:{prompt_tokens:1000,completion_tokens:100,prompt_cache_hit_tokens:200,prompt_cache_miss_tokens:800},choices:[{finish_reason:'stop',message:{content:JSON.stringify({links:[{from:a.ref,target:b.ref,relation:'related',title:'两份课程报告',confidence:0.99,newEvidence:a.evidence[0],oldEvidence:b.evidence[0]}]})}}]});}
    const s=input.sources.find(s=>s.id==='input');
    return Response.json({model:body.model,usage:{prompt_tokens:1000,completion_tokens:100,prompt_cache_hit_tokens:200,prompt_cache_miss_tokens:800},choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'已整理',items:[{kind:'task',title:'交报告',summary:'提交报告',facts:[],nextSteps:[],uncertainties:[],due:null,evidence:[{sourceId:s.id,quote:s.text}]}],warnings:[]})}}]});
  }
  throw Error('Unexpected test network request');
};`,
);
let child;
async function start() {
  child = spawn(
    process.execPath,
    ["--import", pathToFileURL(preload).href, "server/index.mjs"],
    {
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        APP_ORIGIN: origin,
        APP_PASSWORD: "fixture-personal-passphrase",
        DEEPSEEK_API_KEY: "",
        DATA_DIR: data,
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Test server did not start");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    child.once("exit", resolve);
    child.kill();
  });
}
test("personal API requires auth and origin; preserves files and queue across restart", async () => {
  await start();
  try {
    assert.equal((await fetch(origin + "/api/packets")).status, 401);
    assert.equal((await fetch(origin + "/api/models")).status, 401);
    assert.equal((await fetch(origin + "/api/balance")).status, 401);
    assert.equal(
      (
        await fetch(origin + "/api/login", {
          method: "POST",
          headers: {
            Origin: "https://untrusted.example",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ password: "fixture-personal-passphrase" }),
        })
      ).status,
      403,
    );
    const login = await fetch(origin + "/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "fixture-personal-passphrase" }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie").split(";")[0];
    assert.match(login.headers.get("set-cookie"), /HttpOnly/);
    assert.match(login.headers.get("set-cookie"), /SameSite=Strict/);
    const packet = {
      id: "fixture-packet",
      text: "明天交报告",
      sources: [
        { id: "input", name: "随手输入", text: "明天交报告" },
        { id: "fixture-file", name: "teacher.txt", text: "报告不少于2000字" },
      ],
      attachments: [{ id: "fixture-file", name: "teacher.txt" }],
      capturedAt: new Date().toISOString(),
      captureDate: "2026-10-22",
    };
    const form = new FormData();
    form.append("packet", JSON.stringify(packet));
    form.append(
      "file:fixture-file",
      new Blob(["报告不少于2000字"]),
      "teacher.txt",
    );
    const created = await fetch(origin + "/api/packets", {
      method: "POST",
      headers: { Origin: origin, Cookie: cookie },
      body: form,
    });
    assert.equal(created.status, 202);
    assert.equal((await created.json()).packet.status, "pending");
    assert.equal(
      (await fetch(origin + "/api/attachments/fixture-file")).status,
      401,
    );
    const attachment = await fetch(origin + "/api/attachments/fixture-file", {
      headers: { Cookie: cookie },
    });
    assert.equal(await attachment.text(), "报告不少于2000字");
    assert.equal(
      attachment.headers.get("content-type"),
      "application/octet-stream",
    );
    assert.equal((await fetch(origin + "/.env")).status, 404);
    await stop();
    await start();
    const stored = await (
      await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(stored.packets.length, 1);
    assert.deepEqual(stored.usage, []);
    assert.equal(stored.packets[0].sources[1].text, "报告不少于2000字");
    assert.equal(stored.packets[0].status, "pending");
    assert.ok(!JSON.stringify(stored).includes("fixture-personal-passphrase"));
    const settings = await fetch(origin + "/api/settings", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        apiKey: "fixture-api-key-not-real",
        model: "deepseek-v4-pro",
      }),
    });
    assert.equal(settings.status, 200);
    assert.equal(
      (
        await (
          await fetch(origin + "/api/models", { headers: { Cookie: cookie } })
        ).json()
      ).data.length,
      2,
    );
    assert.equal(
      (
        await (
          await fetch(origin + "/api/balance", { headers: { Cookie: cookie } })
        ).json()
      ).balance_infos[0].total_balance,
      "98.12",
    );
    let reported;
    for (let i = 0; i < 40; i++) {
      reported = await (
        await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
      ).json();
      if (reported.packets[0].status === "ready") break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(reported.packets[0].status, "ready");
    assert.equal(reported.usage.length, 1);
    assert.equal(reported.usage[0].requestedModel, "deepseek-v4-pro");
    assert.equal(reported.usage[0].cost.min, 0.00498);
    assert.ok(!JSON.stringify(reported).includes("fixture-api-key-not-real"));
    await stop();
    await start();
    const persisted = await (
      await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(persisted.usage[0].cost.min, 0.00498);
    const second = {
      ...packet,
      id: "fixture-second",
      text: "第二份报告也要完成",
      sources: [{ id: "input", name: "输入", text: "第二份报告也要完成" }],
      attachments: [],
    };
    const nextForm = new FormData();
    nextForm.append("packet", JSON.stringify(second));
    assert.equal(
      (
        await fetch(origin + "/api/packets", {
          method: "POST",
          headers: { Origin: origin, Cookie: cookie },
          body: nextForm,
        })
      ).status,
      202,
    );
    let grouped;
    for (let i = 0; i < 40; i++) {
      grouped = await (
        await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
      ).json();
      if (buildGroups(grouped.packets).length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(buildGroups(grouped.packets)[0].units.length, 2);
    assert.equal(grouped.usage.length, 3);
    const split = await fetch(origin + "/api/associations/split", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refs: buildGroups(grouped.packets)[0].refs }),
    });
    assert.equal(split.status, 200);
    assert.equal(
      buildGroups(
        (
          await (
            await fetch(origin + "/api/packets", {
              headers: { Cookie: cookie },
            })
          ).json()
        ).packets,
      ).length,
      0,
    );
    assert.equal(
      (
        await fetch(origin + "/api/packets/fixture-second/relate", {
          method: "POST",
          headers: {
            Origin: origin,
            Cookie: cookie,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
      200,
    );
    for (let i = 0; i < 40; i++) {
      grouped = await (
        await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
      ).json();
      if (buildGroups(grouped.packets).length) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.equal(buildGroups(grouped.packets).length, 1);
    await stop();
    await start();
    assert.equal(
      buildGroups(
        (
          await (
            await fetch(origin + "/api/packets", {
              headers: { Cookie: cookie },
            })
          ).json()
        ).packets,
      ).length,
      1,
    );
    const removed = await fetch(origin + "/api/packets/fixture-packet", {
      method: "DELETE",
      headers: { Origin: origin, Cookie: cookie },
    });
    assert.equal(removed.status, 200);
    const tombstone = (await removed.json()).packet;
    assert.ok(tombstone.deletedAt);
    assert.equal(tombstone.text, "");
    assert.deepEqual(tombstone.attachments, []);
    assert.equal(
      (
        await (
          await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
        ).json()
      ).usage.length,
      4,
    );
    const afterDelete = await (
      await fetch(origin + "/api/packets", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(buildGroups(afterDelete.packets).length, 0);
    assert.deepEqual(
      afterDelete.packets.find((p) => p.id === "fixture-second").association
        .links,
      [],
    );
    assert.equal(
      (
        await fetch(origin + "/api/attachments/fixture-file", {
          headers: { Cookie: cookie },
        })
      ).status,
      404,
    );
  } finally {
    await stop();
  }
});

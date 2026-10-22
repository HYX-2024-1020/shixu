import { validateResult } from "../../shared/bucket-engine.mjs";
import { localDate } from "../organize";
import type { Packet } from "./types";
export const SAMPLE_TEXT =
  "老师说下周三 23:59 前交课程调研报告，具体要求看附件。\n另外，突然想到：做一个校园旧书地图。\n想每天睡前读十分钟书。";
export const SAMPLE_FILE =
  "课程调研报告要求\n提交一份 PDF 报告和访谈记录，报告不少于 2000 字。\n文件名格式：学号_姓名_调研报告。\n请通过课程平台提交。";
export function samplePacket(): Packet {
  const at = new Date().toISOString(),
    date = localDate(),
    sources = [
      { id: "input", name: "随手输入", text: SAMPLE_TEXT },
      { id: "sample-file", name: "课程要求.txt", text: SAMPLE_FILE },
    ];
  return {
    id: "bucket-demo-example",
    text: SAMPLE_TEXT,
    sources,
    attachments: [
      {
        id: "sample-file",
        name: "课程要求.txt",
        size: new Blob([SAMPLE_FILE]).size,
        type: "text/plain",
        blob: new Blob([SAMPLE_FILE], { type: "text/plain" }),
      },
    ],
    capturedAt: at,
    captureDate: date,
    status: "ready",
    error: "",
    doneIds: [],
    updatedAt: at,
    result: validateResult(
      {
        summary: "一份课程作业、一个旧书地图的点子，还有一个睡前阅读的小习惯。",
        warnings: ["这是虚构的示例结果，用来展示整理方式，未调用模型。"],
        items: [
          {
            kind: "task",
            title: "提交课程调研报告",
            summary: "把老师的通知和附件要求合成了一件待办。",
            facts: [
              "提交 PDF 报告和访谈记录",
              "报告不少于 2000 字",
              "按“学号_姓名_调研报告”命名，上传课程平台",
            ],
            nextSteps: ["可以先列出调研主题与访谈问题。"],
            uncertainties: [],
            due: {
              anchor: "下周三 23:59 前",
              sourceId: "input",
              date: "",
              time: "23:59",
            },
            evidence: [
              { sourceId: "input", quote: "下周三 23:59 前交课程调研报告" },
              {
                sourceId: "sample-file",
                quote: "提交一份 PDF 报告和访谈记录，报告不少于 2000 字。",
              },
              {
                sourceId: "sample-file",
                quote: "文件名格式：学号_姓名_调研报告。",
              },
            ],
          },
          {
            kind: "idea",
            title: "做一个校园旧书地图",
            summary: "把校园里愿意流转的旧书，放到一张容易找到的地图上。",
            facts: [],
            nextSteps: [
              "先找 3 位同学聊聊：找书或转让旧书时，最麻烦的是什么？",
              "先用一张共享表格验证需求，不急着开发完整应用。",
            ],
            uncertainties: [],
            due: null,
            evidence: [{ sourceId: "input", quote: "做一个校园旧书地图" }],
          },
          {
            kind: "habit",
            title: "睡前读十分钟书",
            summary: "把阅读放进睡前这段固定的时间里。",
            facts: ["每天睡前读十分钟"],
            nextSteps: ["可以先把书放在枕边，睡前翻开一页作为开始。"],
            uncertainties: [],
            due: null,
            evidence: [{ sourceId: "input", quote: "想每天睡前读十分钟书" }],
          },
        ],
      },
      sources,
      date,
    ),
  };
}

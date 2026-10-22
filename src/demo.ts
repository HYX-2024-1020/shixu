import { type Entry } from "./types";
import { localDate, addDays } from "./organize";
export function demoEntries(): Entry[] {
  const today = localDate();
  const createdAt = new Date().toISOString();
  const base = {
    content: "",
    priority: "normal" as const,
    due: "",
    time: "",
    dateHint: "",
    confirmedDate: true,
    tags: [],
    project: "",
    status: "active" as const,
    createdAt,
    updatedAt: createdAt,
    checkins: [],
  };
  return [
    {
      ...base,
      id: crypto.randomUUID(),
      title: "完成线性代数第三章习题",
      kind: "task",
      content: "完成第三章的 1—8 题，把不理解的地方整理出来，下次课问老师。",
      due: today,
      time: "20:00",
      priority: "high",
      tags: ["课程学习"],
    },
    {
      ...base,
      id: crypto.randomUUID(),
      title: "和小组一起讨论产品原型",
      kind: "task",
      content: "带上两版草图，一起确认最重要的用户流程。",
      due: today,
      time: "16:00",
      project: "校园创新计划",
      tags: ["小组协作"],
    },
    {
      ...base,
      id: crypto.randomUUID(),
      title: "图书馆的新书分享会",
      kind: "notice",
      content: "这是一条演示通知：图书馆三楼分享会，感兴趣的话可以去听听。",
      due: addDays(today, 1),
      time: "19:00",
      tags: ["校园生活"],
    },
    {
      ...base,
      id: crypto.randomUUID(),
      title: "做一个校园旧书交换角",
      kind: "idea",
      content:
        "突然想到：用一张地图把校园里的旧书连接起来，让每本书遇到下一个读者。",
      tags: ["产品想法"],
    },
    {
      ...base,
      id: crypto.randomUUID(),
      title: "每天读 20 分钟",
      kind: "habit",
      content: "不用读很多，给自己留一小段安静的时间。",
      checkins: [addDays(today, -1), addDays(today, -2), addDays(today, -3)],
    },
    {
      ...base,
      id: crypto.randomUUID(),
      title: "出门走走，活动 15 分钟",
      kind: "habit",
      content: "从书桌边站起来，看看今天的天空。",
    },
    {
      ...base,
      id: crypto.randomUUID(),
      title: "校园创新计划",
      kind: "project",
      content: "从观察校园生活的小问题开始，完成访谈、原型和第一次试用。",
      due: addDays(today, 7),
      tags: ["进行中"],
    },
    {
      ...base,
      id: crypto.randomUUID(),
      title: "周五前提交英语演讲提纲",
      kind: "task",
      content: "演示收集内容：周五前提交英语演讲提纲，主题是一次小小的改变。",
      due: addDays(today, 2),
      status: "inbox",
      confirmedDate: false,
      dateHint: "演示日期，请确认",
      tags: ["课程学习"],
    },
  ];
}

const { itemsFor, worldView, statePatch } = require("./world");
const { deadlineSections, mergeCardOrder } = require("./generated/desktop");

// Preserve chronology between dates; use the shared cross-client rank within a date.
function ddlLists(rows, day, clock, days) {
  const lists = deadlineSections(rows, day, clock, days);
  for (const [section, list] of Object.entries(lists)) {
    list.forEach((row) => {
      row.dragGroup = `${section}:${row.date || "unsure"}`;
    });
    list.sort(
      (a, b) =>
        (a.date || "9999").localeCompare(b.date || "9999") ||
        (a.meta.order ?? Infinity) - (b.meta.order ?? Infinity) ||
        (a.time || "99:99").localeCompare(b.time || "99:99") ||
        a.id.localeCompare(b.id),
    );
  }
  return lists;
}
function fingerprint(records) {
  return JSON.stringify(
    records.map((r) => [
      r.id,
      r.version,
      r.deletedAt,
      r.conflict,
      r.data?.updatedAt,
      r.data?.itemIds,
      r.data?.itemState,
      r.data?.doneIds,
      r.data?.result,
    ]),
  );
}
function moveInGroup(order, id, target, groups) {
  if (
    id === target ||
    !order.includes(id) ||
    !order.includes(target) ||
    groups.get(id) !== groups.get(target)
  )
    return order;
  // Replace group slots only, including when groups are interleaved in the list.
  const siblings = order.filter((key) => groups.get(key) === groups.get(id));
  const next = siblings.slice();
  next.splice(next.indexOf(id), 1);
  next.splice(siblings.indexOf(target), 0, id);
  return mergeCardOrder(order, siblings, next);
}
function nearestSlot(rects, x, y, scrollDelta) {
  let target,
    distance = Infinity;
  for (const rect of rects) {
    const top = rect.top - scrollDelta;
    if (x < rect.left || x > rect.right || y < top || y > top + rect.height)
      continue;
    const d =
      (rect.left + rect.width / 2 - x) ** 2 + (top + rect.height / 2 - y) ** 2;
    if (d < distance) {
      distance = d;
      target = rect.slot;
    }
  }
  return target;
}
function createTouchOrder(wx) {
  return {
    _blockDragTap() {
      return !!this._drag || Date.now() < (this._dragTapUntil || 0);
    },
    onCardActionStart() {
      if (this._drag) return;
      this._dragTouch = null;
      this._dragTapUntil = 0;
      this._stopDragSettle();
    },
    _stopDragSettle() {
      clearTimeout(this._dragSettleTimer);
      this.setData({ dragSettling: false, dragGhost: null });
    },
    onWorkspaceScroll(event) {
      const top = event.detail.scrollTop;
      if (
        !this._drag &&
        this._dragTouch &&
        Math.abs(top - this._dragTouch.scrollTop) > 6
      )
        this._dragTouch = null;
      this._scrollTop = top;
      this._scrollHeight = event.detail.scrollHeight;
    },
    dragTouchStart(event) {
      if (event.touches.length !== 1) {
        this.cancelDrag();
        return;
      }
      if (
        !["world", "ddl"].includes(this.data.tab) ||
        this.data.selected ||
        this._completionLock ||
        this._drag ||
        event.touches.length !== 1
      )
        return;
      this._stopDragSettle();
      this._dragTapUntil = 0;
      const touch = event.touches[0];
      this._dragTouch = {
        id: event.currentTarget.dataset.id,
        x: touch.clientX,
        y: touch.clientY,
        identifier: touch.identifier,
        scrollTop: this._scrollTop || 0,
      };
    },
    dragTouchMove(event) {
      const touch = event.touches[0],
        s = this._drag;
      if (event.touches.length !== 1 || !touch) {
        this.cancelDrag();
        return;
      }
      if (!s) {
        const candidate = this._dragTouch;
        if (
          candidate &&
          Math.hypot(touch.clientX - candidate.x, touch.clientY - candidate.y) >
            7
        )
          this._dragTouch = null;
        return;
      }
      if (touch.identifier !== s.identifier) {
        this.cancelDrag();
        return;
      }
      s.x = touch.clientX;
      s.y = touch.clientY;
      s.cancelDrop = s.y > s.bounds.bottom - 64 && s.x > s.bounds.right - 120;
      this.setData({
        dragNotice: s.cancelDrop
          ? "松手取消移动"
          : s.tab === "ddl"
            ? "同一日期内移动 · 截止时间不变"
            : "松手保存顺序",
      });
      this._updateDrag();
    },
    startDrag(event) {
      const candidate = this._dragTouch;
      if (
        !candidate ||
        candidate.id !== event.currentTarget.dataset.id ||
        this._drag ||
        (this.data.scope === "trash" && this.data.tab === "world")
      )
        return;
      // Measure real native slots, including both grid columns, once per gesture.
      const query = wx.createSelectorQuery().in(this);
      query.select(".workspace-scroll").boundingClientRect();
      query
        .selectAll(
          this.data.tab === "world"
            ? ".world .drag-card"
            : ".ddl-workspace .drag-card",
        )
        .fields({ rect: true, size: true, dataset: true });
      query.select(".page").boundingClientRect();
      query.exec((results) => {
        if (this._dragTouch !== candidate || this._drag) return;
        const bounds = results?.[0],
          rects = results?.[1] || [];
        this._scrollHeight = results?.[2]?.height || this._scrollHeight || 0;
        const records = this._client.records();
        const all =
          this.data.tab === "world"
            ? worldView(records, {
                scope: this.data.scope,
                sort: this.data.sort,
                limit: Number.MAX_SAFE_INTEGER,
              }).items
            : itemsFor(records)
                .filter((r) => !r.deleted)
                .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
        const visible =
          this.data.tab === "world"
            ? this.data.items
            : [
                ...(this.data.ddlShowOverdue ? this.data.ddlOverdue : []),
                ...this.data.ddlSections.flatMap((section) => section.rows),
                ...(this.data.ddlShowUnsure ? this.data.ddlUnsure : []),
                ...(this.data.ddlShowDone ? this.data.ddlDone : []),
              ];
        const rows = new Map(visible.map((row) => [row.id, row]));
        const slots = rects.filter((rect) => rows.has(rect.dataset.id));
        const row = rows.get(candidate.id);
        if (
          !bounds ||
          !row ||
          row.conflict ||
          !slots.some((rect) => rect.dataset.id === row.id)
        )
          return;
        const origin = slots.find((rect) => rect.dataset.id === row.id);
        const order = slots.map((rect) => rect.dataset.id);
        const groups = new Map(
          visible.map((r) => [
            r.id,
            this.data.tab === "ddl"
              ? r.dragGroup
              : `${this.data.grouped ? r.group : ""}:${!!r.pinned}`,
          ]),
        );
        const s = (this._drag = {
          ...candidate,
          origin,
          validDrop: true,
          offsetX: candidate.x - origin.left,
          offsetY: candidate.y - origin.top,
          x: candidate.x,
          y: candidate.y,
          bounds,
          all,
          rows,
          groups,
          fingerprint: fingerprint(records),
          original: order.slice(),
          order,
          rects: slots.map((rect, slot) => ({ ...rect, slot })),
          tab: this.data.tab,
          baseline: this._scrollTop || 0,
          initialLists: {
            items: this.data.items,
            sections: this.data.sections,
            ddlOverdue: this.data.ddlOverdue,
            ddlSections: this.data.ddlSections,
            ddlUnsure: this.data.ddlUnsure,
            ddlDone: this.data.ddlDone,
          },
        });
        this._dragTapUntil = Date.now() + 700;
        this.setData({
          dragScrollTop: this._scrollTop || 0,
          dragId: row.id,
          dragNotice:
            this.data.tab === "ddl"
              ? "同一日期内移动 · 截止时间不变"
              : "移动到同组卡片 · 松手保存",
        });
        if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
        this._updateDrag();
        s.timer = setInterval(() => this._dragTick(), 40);
      });
    },
    _updateDrag() {
      const s = this._drag;
      if (!s) return;
      const delta = (this._scrollTop || 0) - s.baseline;
      const slot = nearestSlot(s.rects, s.x, s.y, delta);
      const target = slot === undefined ? null : s.order[slot];
      s.validDrop =
        !!target &&
        s.groups.get(target) === s.groups.get(s.id) &&
        s.x >= s.bounds.left &&
        s.x <= s.bounds.right &&
        s.y >= s.bounds.top &&
        s.y <= s.bounds.bottom &&
        !s.cancelDrop;
      const next = s.validDrop
        ? moveInGroup(s.order, s.id, target, s.groups)
        : s.order;
      this.setData({
        dragNotice: s.validDrop ? "松手放在这里" : "此处不能放置，松手回原位",
        dragGhost: {
          title: s.rows.get(s.id).title,
          summary: s.rows.get(s.id).summary,
          width: s.origin.width,
          height: s.origin.height,
          left: s.x - s.offsetX,
          top: s.y - s.offsetY,
        },
      });
      if (next !== s.order) {
        const before = s.order;
        s.order = next;
        this._previewDrag(before);
      }
    },
    _previewDrag(before) {
      const s = this._drag,
        positions = new Map(s.order.map((id, i) => [id, i]));
      const old = new Map((before || s.order).map((id, i) => [id, i]));
      const sort = (rows) =>
        rows
          .map((row) => {
            const from = s.rects[old.get(row.id)],
              to = s.rects[positions.get(row.id)];
            return {
              ...row,
              dragStyle:
                before && from && to
                  ? `transform:translate(${from.left - to.left}px,${from.top - to.top}px);transition:none;`
                  : "",
            };
          })
          .sort(
            (a, b) =>
              (positions.get(a.id) ?? 1e9) - (positions.get(b.id) ?? 1e9),
          );
      this.setData(
        s.tab === "world"
          ? {
              items: sort(s.initialLists.items),
              sections: s.initialLists.sections.map((section) => ({
                ...section,
                items: sort(section.items),
              })),
            }
          : {
              ddlOverdue: sort(s.initialLists.ddlOverdue),
              ddlUnsure: sort(s.initialLists.ddlUnsure),
              ddlDone: sort(s.initialLists.ddlDone),
              ddlSections: s.initialLists.ddlSections.map((section) => ({
                ...section,
                rows: sort(section.rows),
              })),
            },
        before
          ? () => {
              clearTimeout(s.reflowTimer);
              s.reflowTimer = setTimeout(() => {
                if (this._drag === s) this._previewDrag();
              }, 24);
            }
          : undefined,
      );
    },
    _dragTick() {
      const s = this._drag;
      if (!s) return;
      const edge = 64,
        bottom = s.bounds.bottom - 52;
      const speed =
        s.y < s.bounds.top + edge
          ? -Math.min(16, (s.bounds.top + edge - s.y) / 4)
          : s.y > bottom - edge
            ? Math.min(16, (s.y - bottom + edge) / 4)
            : 0;
      if (!speed) return;
      const current = this._scrollTop || 0;
      const top = Math.max(
        0,
        Math.min(
          Math.max(0, (this._scrollHeight || 0) - s.bounds.height),
          current + speed,
        ),
      );
      if (top !== current) {
        this._scrollTop = top;
        this.setData({ dragScrollTop: top });
        this._updateDrag();
      }
    },
    _clearDrag(keepGhost = false) {
      const s = this._drag;
      if (s) {
        clearInterval(s.timer);
        clearTimeout(s.reflowTimer);
      }
      this._drag = null;
      this._dragTouch = null;
      if (s) this._dragTapUntil = Date.now() + 500;
      this.setData({
        dragId: "",
        ...(keepGhost ? {} : { dragGhost: null, dragSettling: false }),
      });
      return s;
    },
    cancelDrag(event) {
      const animate = !!event && !!this._drag;
      if (!animate) this._stopDragSettle();
      const s = this._clearDrag(animate);
      if (s) {
        this.setData(s.initialLists);
        this._refresh();
        if (animate) this._settleDrag(s, true);
      }
    },
    _settleDrag(s, restore) {
      const index = (restore ? s.original : s.order).indexOf(s.id);
      const target = s.rects[index] || s.origin;
      this.setData({
        dragSettling: true,
        dragGhost: {
          title: s.rows.get(s.id).title,
          summary: s.rows.get(s.id).summary,
          left: target.left,
          top: target.top - ((this._scrollTop || 0) - s.baseline),
          width: target.width,
          height: target.height,
        },
      });
      this._dragSettleTimer = setTimeout(() => this._stopDragSettle(), 260);
    },
    finishDrag(event) {
      if (event?.touches?.length) {
        this.cancelDrag();
        return;
      }
      if (this._drag && event?.changedTouches?.[0]) {
        const touch = event.changedTouches[0];
        this._drag.x = touch.clientX;
        this._drag.y = touch.clientY;
        this._updateDrag();
      }
      const s = this._clearDrag(true);
      if (!s) return;
      if (!s.validDrop || s.cancelDrop) {
        this.setData(s.initialLists);
        this._refresh();
        this._settleDrag(s, true);
        return;
      }
      let restore = false;
      try {
        if (
          fingerprint(this._client.records()) !== s.fingerprint ||
          this.data.tab !== s.tab
        )
          throw Error("事项在移动期间已更新，请重新拖动");
        const changed = s.order.some((id, index) => id !== s.original[index]);
        if (changed) {
          const group = s.groups.get(s.id);
          const visible = s.original.filter((id) => s.groups.get(id) === group);
          const reordered = s.order.filter((id) => s.groups.get(id) === group);
          const ids = mergeCardOrder(
            s.all.map((r) => r.id),
            visible,
            reordered,
          );
          this._persistCardOrder(s.all, ids);
          if (s.tab === "world") {
            wx.setStorageSync("shixu:mini:filters:v1", { sort: "custom" });
            this.setData({ sort: "custom", sortIndex: 4 });
          }
          this.setData({
            notice:
              "顺序已保存" +
              (s.tab === "ddl" ? "，截止时间未改变" : "，已切换为手动排序"),
          });
          this.syncQuietly();
        }
      } catch (error) {
        restore = true;
        this._error(error);
      }
      this._refresh();
      this._settleDrag(s, restore);
    },
    _persistCardOrder(rows, ids) {
      const byId = new Map(rows.map((row) => [row.id, row])),
        patches = new Map();
      for (const [order, id] of ids.entries()) {
        const row = byId.get(id),
          packet = this._record(row.packetId);
        if (!packet || packet.conflict || packet.deletedAt || row.deleted)
          throw Error("请先处理同步冲突或恢复事项");
        const previous = patches.get(row.packetId) || {};
        const patch = statePatch(
          {
            ...packet.data,
            ...previous,
            itemState: { ...packet.data.itemState, ...previous.itemState },
          },
          row,
          { order },
        );
        patches.set(row.packetId, {
          ...patch,
          itemState: { ...previous.itemState, ...patch.itemState },
        });
      }
      // One durable local write; synchronization still uses the existing per-packet protocol.
      this._client.putMany([...patches].map(([id, patch]) => ({ id, patch })));
    },
  };
}
module.exports = { createTouchOrder, ddlLists, moveInGroup, nearestSlot };

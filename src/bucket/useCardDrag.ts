import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { settle } from "./motion";

type Options = {
  ids: string[];
  enabled: boolean;
  groups?: Map<string, string>;
  onPreview: (ids: string[] | null) => void;
  onCommit: (ids: string[]) => Promise<void>;
  onError: (message: string) => void;
};
type Session = {
  card: HTMLElement;
  id: string;
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  left: number;
  top: number;
  active: boolean;
  order: string[];
  original: string[];
  clone: HTMLElement | null;
  timer: ReturnType<typeof setTimeout>;
  frame: number;
  changed: boolean;
};
export function useCardDrag(
  root: RefObject<HTMLElement | null>,
  options: Options,
) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<Session | null>(null),
    busy = useRef(false),
    suppressClick = useRef(false);
  const [announcement, setAnnouncement] = useState("");
  function cleanup(s: Session) {
    clearTimeout(s.timer);
    cancelAnimationFrame(s.frame);
    s.clone?.remove();
    s.card.removeAttribute("data-dragging");
    document.body.classList.remove("is-card-dragging");
    if (s.card.hasPointerCapture(s.pointer))
      s.card.releasePointerCapture(s.pointer);
    if (session.current === s) session.current = null;
  }
  function cancel() {
    const s = session.current;
    if (!s) return;
    cleanup(s);
    latest.current.onPreview(null);
    setAnnouncement("已取消移动");
  }
  async function finish(s: Session) {
    busy.current = true;
    clearTimeout(s.timer);
    cancelAnimationFrame(s.frame);
    suppressClick.current = true;
    setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    if (s.card.hasPointerCapture(s.pointer))
      s.card.releasePointerCapture(s.pointer);
    const target = s.card.getBoundingClientRect();
    try {
      if (s.clone)
        await s.clone.animate(
          [
            {
              translate: `${s.x - s.startX}px ${s.y - s.startY}px`,
              transform: "scale(1.025) rotate(.6deg)",
            },
            {
              translate: `${target.left - s.left}px ${target.top - s.top}px`,
              transform: "scale(1) rotate(0deg)",
            },
          ],
          { duration: 190, easing: settle, fill: "forwards" },
        ).finished;
      cleanup(s);
      if (s.changed) await latest.current.onCommit(s.order);
      setAnnouncement(
        s.changed
          ? `已移动到第 ${s.order.indexOf(s.id) + 1} 个位置`
          : "位置未变",
      );
    } catch (error) {
      latest.current.onError((error as Error).message);
    } finally {
      cleanup(s);
      latest.current.onPreview(null);
      busy.current = false;
    }
  }
  function tick(s: Session) {
    if (session.current !== s || !s.active) return;
    const edge = 72;
    const speed =
      s.y < edge
        ? -Math.min(15, (edge - s.y) * 0.24)
        : s.y > innerHeight - edge
          ? Math.min(15, (s.y - innerHeight + edge) * 0.24)
          : 0;
    if (speed) window.scrollBy(0, speed);
    if (s.clone)
      s.clone.style.translate = `${s.x - s.startX}px ${s.y - s.startY}px`;
    const cards = [
      ...(root.current?.querySelectorAll<HTMLElement>(
        ".result-card[data-motion-id]",
      ) || []),
    ].filter((el) => el.checkVisibility());
    let nearest: HTMLElement | undefined,
      distance = Infinity;
    for (const card of cards) {
      const rect = card.getBoundingClientRect(),
        matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
      const left = rect.left - matrix.m41,
        top = rect.top - matrix.m42;
      if (
        s.x < left - 36 ||
        s.x > left + rect.width + 36 ||
        s.y < top - 36 ||
        s.y > top + rect.height + 36
      )
        continue;
      const d =
        (left + rect.width / 2 - s.x) ** 2 + (top + rect.height / 2 - s.y) ** 2;
      if (d < distance) {
        distance = d;
        nearest = card;
      }
    }
    const id = nearest?.dataset.motionId;
    if (
      id &&
      id !== s.id &&
      (!latest.current.groups ||
        latest.current.groups.get(id) === latest.current.groups.get(s.id))
    ) {
      const from = s.order.indexOf(s.id),
        to = s.order.indexOf(id);
      if (from >= 0 && to >= 0) {
        const order = [...s.order];
        order.splice(from, 1);
        order.splice(to, 0, s.id);
        s.order = order;
        s.changed = order.some((id, i) => s.original[i] !== id);
        latest.current.onPreview(order);
      }
    }
    s.frame = requestAnimationFrame(() => tick(s));
  }
  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      !latest.current.enabled ||
      busy.current ||
      session.current ||
      event.button !== 0 ||
      !event.isPrimary
    )
      return;
    if (
      (event.target as Element).closest(
        "button,a,summary,input,textarea,select,dialog",
      )
    )
      return;
    const card = event.currentTarget,
      id = card.dataset.motionId!;
    const rect = card.getBoundingClientRect();
    const s: Session = {
      card,
      id,
      pointer: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      left: rect.left,
      top: rect.top,
      active: false,
      order: [...latest.current.ids],
      original: [...latest.current.ids],
      clone: null,
      timer: setTimeout(() => {}, 0),
      frame: 0,
      changed: false,
    };
    clearTimeout(s.timer);
    s.timer = setTimeout(() => {
      if (session.current !== s || !card.isConnected) return;
      const bounds = card.getBoundingClientRect();
      s.left = bounds.left;
      s.top = bounds.top;
      s.active = true;
      window.getSelection()?.removeAllRanges();
      card.setPointerCapture(s.pointer);
      const clone = card.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll("dialog,details[open]")
        .forEach((el) => el.remove());
      clone.removeAttribute("data-motion-id");
      clone.removeAttribute("data-dialog-origin");
      clone.classList.add("card-drag-preview");
      clone.setAttribute("aria-hidden", "true");
      clone.inert = true;
      Object.assign(clone.style, {
        left: bounds.left + "px",
        top: bounds.top + "px",
        width: bounds.width + "px",
        height: bounds.height + "px",
        boxSizing: "border-box",
      });
      document.body.append(clone);
      s.clone = clone;
      card.setAttribute("data-dragging", "true");
      document.body.classList.add("is-card-dragging");
      clone.animate(
        [
          { transform: "scale(1) rotate(0deg)" },
          { transform: "scale(1.025) rotate(.6deg)" },
        ],
        { duration: 160, easing: settle },
      );
      setAnnouncement("已拿起卡片，移动后松手放下，Escape 取消");
      tick(s);
    }, 280);
    session.current = s;
  }
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const s = session.current;
      if (!s || event.pointerId !== s.pointer) return;
      s.x = event.clientX;
      s.y = event.clientY;
      if (!s.active && Math.hypot(s.x - s.startX, s.y - s.startY) > 7) {
        cleanup(s);
        return;
      }
      if (s.active) event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      const s = session.current;
      if (!s || event.pointerId !== s.pointer || busy.current) return;
      if (!s.active) {
        cleanup(s);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void finish(s);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && session.current && !busy.current) {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    };
    const click = (event: MouseEvent) => {
      if (suppressClick.current) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const lost = () => {
      if (!busy.current) cancel();
    };
    document.addEventListener("pointermove", move, { passive: false });
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", lost);
    document.addEventListener("keydown", key, true);
    document.addEventListener("click", click, true);
    window.addEventListener("blur", lost);
    window.addEventListener("resize", lost);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", lost);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("click", click, true);
      window.removeEventListener("blur", lost);
      window.removeEventListener("resize", lost);
      cancel();
    };
  }, []);
  useEffect(() => {
    if (!options.enabled && !busy.current) cancel();
  }, [options.enabled]);
  const boardIds = [...options.ids].sort().join("|");
  useEffect(() => {
    const s = session.current;
    if (s && !busy.current && [...s.original].sort().join("|") !== boardIds)
      cancel();
  }, [boardIds]);
  return { onPointerDown, announcement };
}

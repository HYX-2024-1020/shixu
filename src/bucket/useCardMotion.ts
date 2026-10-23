import { useLayoutEffect, useRef } from "react";
import { settle, spring } from "./motion";
export function useCardMotion() {
  const root = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, { left: number; top: number }>());
  const moving = useRef(new Map<string, Animation>());
  useLayoutEffect(() => {
    const next = new Map<string, { left: number; top: number }>();
    const cards =
      root.current?.querySelectorAll<HTMLElement>("[data-motion-id]") || [];
    const reads = Array.from(cards)
      .filter((card) => card.checkVisibility())
      .map((card) => {
        const rect = card.getBoundingClientRect();
        const matrix = new DOMMatrixReadOnly(getComputedStyle(card).transform);
        return {
          card,
          id: card.dataset.motionId!,
          x: matrix.m41,
          y: matrix.m42,
          left: rect.left + scrollX - matrix.m41,
          top: rect.top + scrollY - matrix.m42,
        };
      });
    for (const { card, id, x, y, left, top } of reads) {
      next.set(id, { left, top });
      if (card.dataset.departing) continue;
      const prior = positions.current.get(id);
      if (prior && Math.abs(prior.left - left) + Math.abs(prior.top - top) < 1)
        continue;
      moving.current.get(id)?.cancel();
      if (prior) {
        const dx = prior.left - left + x,
          dy = prior.top - top + y;
        if (Math.abs(dx) + Math.abs(dy) > 1)
          moving.current.set(
            id,
            card.animate(
              [
                { transform: `translate(${dx}px,${dy}px)` },
                { transform: "translate(0,0)" },
              ],
              { duration: 380, easing: spring },
            ),
          );
      } else
        moving.current.set(
          id,
          card.animate(
            [
              { opacity: 0, transform: "translateY(12px) scale(.985)" },
              { opacity: 1, transform: "translateY(0) scale(1)" },
            ],
            { duration: 270, easing: settle },
          ),
        );
    }
    for (const [id, animation] of moving.current)
      if (!next.has(id)) {
        animation.cancel();
        moving.current.delete(id);
      }
    positions.current = next;
  });
  return root;
}

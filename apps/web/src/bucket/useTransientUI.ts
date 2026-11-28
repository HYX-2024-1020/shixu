import { useEffect, useRef } from "react";
import { setMenuOpen } from "./motion";
export function useTransientUI(drag: boolean, resetDrag: () => void) {
  const reset = useRef(resetDrag);
  reset.current = resetDrag;
  useEffect(() => {
    const menus = () =>
      Array.from(
        document.querySelectorAll<HTMLDetailsElement>(
          ".card-menu[open],.detail-action-menu[open],.source-options[open],.result-filter-menu[open]",
        ),
      );
    const outside = (e: PointerEvent) =>
      menus().forEach((menu) => {
        if (!menu.contains(e.target as Node)) setMenuOpen(menu, false);
      });
    const chosen = (e: MouseEvent) => {
      if (!(e.target instanceof Element)) return;
      const target = e.target as Element;
      const summary = target.closest("summary");
      const owner = summary?.parentElement;
      if (
        owner instanceof HTMLDetailsElement &&
        owner.matches(
          ".card-menu,.detail-action-menu,.source-options,.result-filter-menu",
        )
      ) {
        e.preventDefault();
        setMenuOpen(
          owner,
          owner.dataset.motionState === "closing" || !owner.open,
        );
      } else if (target.closest("button,a")) {
        const menu = target.closest<HTMLDetailsElement>(
          ".card-menu,.detail-action-menu,.source-options,.result-filter-menu",
        );
        if (menu) setMenuOpen(menu, false);
      }
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      reset.current();
      const open = menus();
      if (open.length) {
        e.preventDefault();
        e.stopPropagation();
        open.forEach((menu) => setMenuOpen(menu, false));
      }
    };
    document.addEventListener("pointerdown", outside, true);
    const blur = () => menus().forEach((menu) => setMenuOpen(menu, false));
    window.addEventListener("blur", blur);
    document.addEventListener("click", chosen);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", blur);
      document.removeEventListener("click", chosen);
      document.removeEventListener("keydown", key, true);
    };
  }, []);
  useEffect(() => {
    if (!drag) return;
    let last = Date.now();
    const over = () => {
      last = Date.now();
    };
    const end = () => reset.current();
    const leave = (e: DragEvent) => {
      if (
        !(e.relatedTarget instanceof Node) ||
        !document.documentElement.contains(e.relatedTarget)
      )
        end();
    };
    const timer = window.setInterval(() => {
      if (Date.now() - last > 1600) end();
    }, 400);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    window.addEventListener("blur", end);
    window.addEventListener("pointerdown", end);
    return () => {
      clearInterval(timer);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
      window.removeEventListener("blur", end);
      window.removeEventListener("pointerdown", end);
    };
  }, [drag]);
}

/**
 * Whether a 3D stage is worth drawing: the tab is showing and some of the
 * stage is on screen. A render loop checks `active` each frame and draws
 * nothing while it's false, so a scene scrolled out of view (or behind
 * another tab) stops using the GPU and the battery. Browsers already stop
 * requestAnimationFrame in a hidden tab; the scroll part is what this adds.
 */
export interface StageActivity {
  readonly active: boolean;
  dispose(): void;
}

export function watchStageActive(el: Element, onChange?: (active: boolean) => void): StageActivity {
  let onScreen = true;
  let shown = typeof document === "undefined" || !document.hidden;
  let was = onScreen && shown;
  const update = () => {
    const now = onScreen && shown;
    if (now !== was) {
      was = now;
      onChange?.(now);
    }
  };
  const io =
    typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((entries) => {
          const e = entries[entries.length - 1];
          if (!e) return;
          onScreen = e.isIntersecting;
          update();
        })
      : null;
  io?.observe(el);
  const onVis = () => {
    shown = !document.hidden;
    update();
  };
  document.addEventListener("visibilitychange", onVis);
  return {
    get active() {
      return onScreen && shown;
    },
    dispose() {
      io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}

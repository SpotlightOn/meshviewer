import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retireFrames } from "../../src/renderer/utils.js";

function makeFrames() {
  const container = document.createElement("div");
  const oldFrame = document.createElement("div");
  oldFrame.className = "large-frame enter-fade";
  oldFrame.append(document.createElement("img"));
  const newFrame = document.createElement("div");
  newFrame.className = "large-frame enter-fade";
  newFrame.append(document.createElement("img"));
  container.append(oldFrame, newFrame);
  document.body.append(container);
  return { container, oldFrame, newFrame };
}

describe("retireFrames", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the freshly added frame and retires the previous one", () => {
    const { container, oldFrame, newFrame } = makeFrames();
    retireFrames(container, { direction: 1, slide: false, durationMs: 350, keep: newFrame });
    expect(newFrame.classList.contains("enter-fade")).toBe(true);
    expect(newFrame.classList.contains("leave-fade")).toBe(false);
    expect(oldFrame.classList.contains("enter-fade")).toBe(false);
    expect(oldFrame.classList.contains("leave-fade")).toBe(true);
    expect(container.children).toHaveLength(2);
  });

  it("retires every frame when no frame is kept", () => {
    const { container, oldFrame, newFrame } = makeFrames();
    retireFrames(container, { direction: 1, slide: false, durationMs: 350 });
    expect(oldFrame.classList.contains("leave-fade")).toBe(true);
    expect(newFrame.classList.contains("leave-fade")).toBe(true);
  });

  it("writes the navigation direction onto the outgoing frame", () => {
    const { container, oldFrame } = makeFrames();
    retireFrames(container, { direction: -1, slide: true, durationMs: 350 });
    expect(oldFrame.classList.contains("leave-slide")).toBe(true);
    expect(oldFrame.style.getPropertyValue("--slide-dir")).toBe("-1");
  });

  it("removes a frame once its animation ended", () => {
    const { container, oldFrame, newFrame } = makeFrames();
    retireFrames(container, { direction: 1, slide: false, durationMs: 5000, keep: newFrame });
    oldFrame.dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(container.contains(oldFrame)).toBe(false);
    expect(container.contains(newFrame)).toBe(true);
  });

  it("ignores animation events bubbling up from child elements", () => {
    const { container, oldFrame } = makeFrames();
    retireFrames(container, { direction: 1, slide: false, durationMs: 5000 });
    oldFrame.querySelector("img").dispatchEvent(new Event("animationend", { bubbles: true }));
    expect(container.contains(oldFrame)).toBe(true);
  });

  it("removes frames after the configured duration when no event fires", () => {
    vi.useFakeTimers();
    const { container, oldFrame, newFrame } = makeFrames();
    retireFrames(container, { direction: 1, slide: false, durationMs: 500, keep: newFrame });
    vi.advanceTimersByTime(701);
    expect(container.contains(oldFrame)).toBe(false);
    expect(container.contains(newFrame)).toBe(true);
  });
});

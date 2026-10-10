import { describe, expect, it } from "vitest";
import { glbDistanceForPercent, glbPercentForDistance } from "../../../src/renderer/3d/utils.js";

describe("GLB zoom helpers", () => {
  it("maps distance and percent inversely", () => {
    expect(glbDistanceForPercent(100, 100)).toBe(100);
    expect(glbDistanceForPercent(100, 200)).toBe(50);
    expect(glbDistanceForPercent(100, 10)).toBe(1000);
    expect(glbDistanceForPercent(100, 800)).toBe(12.5);
    expect(glbPercentForDistance(100, 50)).toBe(200);
    expect(glbPercentForDistance(100, 12.5)).toBe(800);
    expect(glbPercentForDistance(100, 1000)).toBe(10);
  });
});

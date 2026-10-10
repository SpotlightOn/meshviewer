import { describe, expect, it } from "vitest";
import {
  EQUIRECT_FOV_MAX,
  EQUIRECT_FOV_MIN,
  fovForPercent,
  isPixmap,
  percentForFov,
} from "../../../src/renderer/equirectangular/utils.js";

describe("isPixmap", () => {
  it("accepts raster image formats", () => {
    for (const name of [
      "photo.png",
      "photo.jpg",
      "photo.jpeg",
      "photo.gif",
      "photo.webp",
      "photo.avif",
      "photo.bmp",
    ]) {
      expect(isPixmap(name)).toBe(true);
    }
  });

  it("rejects vector, icon, 3D and unknown formats", () => {
    expect(isPixmap("photo.svg")).toBe(false);
    expect(isPixmap("photo.ico")).toBe(false);
    expect(isPixmap("model.glb")).toBe(false);
    expect(isPixmap("README.md")).toBe(false);
    expect(isPixmap("noextension")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isPixmap("FOTO.JPG")).toBe(true);
    expect(isPixmap("Photo.WebP")).toBe(true);
    expect(isPixmap("PHOTO.SVG")).toBe(false);
  });
});

describe("equirectangular field of view", () => {
  it("maps zoom percentages to fields of view", () => {
    expect(fovForPercent(10)).toBe(EQUIRECT_FOV_MAX);
    expect(fovForPercent(800)).toBe(EQUIRECT_FOV_MIN);
    expect(fovForPercent(100)).toBeCloseTo(
      EQUIRECT_FOV_MAX - (90 * (EQUIRECT_FOV_MAX - EQUIRECT_FOV_MIN)) / 790,
      6,
    );
    expect(fovForPercent(5)).toBe(EQUIRECT_FOV_MAX);
    expect(fovForPercent(9000)).toBe(EQUIRECT_FOV_MIN);
  });

  it("maps fields of view back to zoom percentages", () => {
    expect(percentForFov(EQUIRECT_FOV_MAX)).toBe(10);
    expect(percentForFov(EQUIRECT_FOV_MIN)).toBe(800);
    expect(percentForFov(100)).toBe(10);
    expect(percentForFov(1)).toBe(800);
  });

  it("round-trips between zoom percentages and fields of view", () => {
    expect(percentForFov(fovForPercent(100))).toBe(100);
    expect(percentForFov(fovForPercent(250))).toBe(250);
    expect(percentForFov(fovForPercent(37))).toBe(37);
  });
});

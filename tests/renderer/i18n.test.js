import i18next from "i18next";
import { beforeEach, describe, expect, it } from "vitest";
import { t } from "../../src/renderer/i18n.js";

describe("i18n t()", () => {
  beforeEach(async () => {
    await i18next.init({
      lng: "en",
      fallbackLng: "en",
      resources: {
        en: {
          translation: {
            contextMenu: { editWith: "Edit with {{app}}" },
          },
        },
      },
    });
  });

  it("passes interpolation options through to i18next", () => {
    expect(t("contextMenu.editWith", { app: "GIMP" })).toBe("Edit with GIMP");
  });

  it("translates keys without options", () => {
    expect(t("contextMenu.editWith")).toBe("Edit with {{app}}");
  });
});

import { describe, expect, it } from "vitest";
import {
  isCountyDublinLocation,
  normalizeDublinLocality,
} from "../../lib/domain/normalize";

describe("County Dublin location rules", () => {
  it.each([
    ["Dublin City Centre", "Dublin City"],
    ["Dublin 2", "Dublin City"],
    ["Swords, Fingal", "Fingal"],
    ["Tallaght, South Dublin", "South Dublin"],
    ["Sandyford, Dún Laoghaire-Rathdown", "Dún Laoghaire–Rathdown"],
  ])("accepts %s as %s", (value, expected) => {
    expect(isCountyDublinLocation(value)).toBe(true);
    expect(normalizeDublinLocality(value)).toBe(expected);
  });

  it.each(["Cork", "Galway", "Ireland", "Remote - Ireland", "Dublin, California"])(
    "rejects %s when it does not support County Dublin",
    (value) => {
      expect(isCountyDublinLocation(value)).toBe(false);
      expect(normalizeDublinLocality(value)).toBeNull();
    },
  );

  it("does not treat a generic Dublin mention inside another country as County Dublin", () => {
    expect(isCountyDublinLocation("Dublin, Ohio, United States")).toBe(false);
  });
});

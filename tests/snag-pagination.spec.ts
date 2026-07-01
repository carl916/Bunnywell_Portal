import { expect, test } from "@playwright/test";
import { snagResultsSummary } from "../src/lib/snag-pagination";

test.describe("snag results summary", () => {
  test("shows no-results wording without filters", () => {
    expect(snagResultsSummary({ filtered: 0, filtersActive: false, pageStart: 0, pageEnd: 0, totalPages: 1 })).toBe("No snags found");
  });

  test("shows no-results wording with filters", () => {
    expect(snagResultsSummary({ filtered: 0, filtersActive: true, pageStart: 0, pageEnd: 0, totalPages: 1 })).toBe("No matching snags");
  });

  test("shows one-result wording on one page", () => {
    expect(snagResultsSummary({ filtered: 1, filtersActive: false, pageStart: 1, pageEnd: 1, totalPages: 1 })).toBe("1 snag shown");
  });

  test("shows multiple-result wording on one page", () => {
    expect(snagResultsSummary({ filtered: 12, filtersActive: false, pageStart: 1, pageEnd: 12, totalPages: 1 })).toBe("12 snags shown");
  });

  test("shows paged wording", () => {
    expect(snagResultsSummary({ filtered: 126, filtersActive: false, pageStart: 51, pageEnd: 100, totalPages: 3 })).toBe("Showing 51-100 of 126 snags");
  });

  test("shows filtered paged wording", () => {
    expect(snagResultsSummary({ filtered: 126, filtersActive: true, pageStart: 1, pageEnd: 50, totalPages: 3 })).toBe("Showing 1-50 of 126 matching snags");
  });

  test("shows filtered one-page wording", () => {
    expect(snagResultsSummary({ filtered: 1, filtersActive: true, pageStart: 1, pageEnd: 1, totalPages: 1 })).toBe("1 matching snag shown");
  });
});

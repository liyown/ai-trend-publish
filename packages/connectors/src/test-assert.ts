import { expect } from "vite-plus/test";

export function equal(actual: unknown, expected: unknown): void {
  expect(actual).toBe(expected);
}

export function deepStrictEqual(actual: unknown, expected: unknown): void {
  expect(actual).toEqual(expected);
}

export async function rejects(
  block: (() => Promise<unknown>) | Promise<unknown>,
  error?: unknown,
): Promise<void> {
  try {
    await (typeof block === "function" ? block() : block);
  } catch (caught) {
    assertExpectedError(caught, error);
    return;
  }
  throw new Error("Expected promise to reject");
}

export function throws(block: () => unknown, error?: unknown): void {
  try {
    block();
  } catch (caught) {
    assertExpectedError(caught, error);
    return;
  }
  throw new Error("Expected function to throw");
}

function assertExpectedError(caught: unknown, expected: unknown): void {
  if (expected === undefined) return;
  if (expected instanceof RegExp) {
    const message =
      caught instanceof Error
        ? caught.message
        : typeof caught === "string"
          ? caught
          : JSON.stringify(caught);
    expect(message).toMatch(expected);
    return;
  }
  if (typeof expected === "function") {
    const prototype = (expected as { prototype?: unknown }).prototype;
    if (prototype instanceof Error) {
      expect(caught).toBeInstanceOf(expected as new (...args: never[]) => Error);
      return;
    }
    expect((expected as (value: unknown) => unknown)(caught)).toBe(true);
    return;
  }
  expect(caught).toEqual(expected);
}

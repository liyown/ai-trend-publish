import { expect } from "vite-plus/test";

export function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Expected condition to be truthy");
}

export function assertExists<T>(
  actual: T | null | undefined,
  message?: string,
): asserts actual is T {
  if (actual === null || actual === undefined) {
    throw new Error(message ?? "Expected value to exist");
  }
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  expect(actual, message).toEqual(expected);
}

export function assertStringIncludes(actual: string, expected: string, message?: string): void {
  if (!actual.includes(expected)) {
    throw new Error(message ?? `Expected string to include ${JSON.stringify(expected)}`);
  }
}

export function assertThrows(
  fn: () => unknown,
  ErrorClass?: new (...args: never[]) => Error,
  msgIncludes?: string,
): Error {
  try {
    fn();
  } catch (error) {
    if (ErrorClass) {
      assert(error instanceof ErrorClass, `Expected ${ErrorClass.name}`);
    }
    if (msgIncludes) {
      assertStringIncludes(String((error as Error).message), msgIncludes);
    }
    return error as Error;
  }
  throw new Error("Expected function to throw");
}

export async function assertRejects(
  fn: () => Promise<unknown>,
  ErrorClass?: new (...args: never[]) => Error,
  msgIncludes?: string,
): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    if (ErrorClass) {
      assert(error instanceof ErrorClass, `Expected ${ErrorClass.name}`);
    }
    if (msgIncludes) {
      assertStringIncludes(String((error as Error).message), msgIncludes);
    }
    return error as Error;
  }
  throw new Error("Expected promise to reject");
}

export function strictEqual<T>(actual: T, expected: T, message?: string): void {
  expect(actual, message).toBe(expected);
}

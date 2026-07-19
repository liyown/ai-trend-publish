import { deepStrictEqual, ok, strictEqual } from "node:assert/strict";

export function assert(condition: unknown, message?: string): asserts condition {
  ok(condition, message);
}

export function assertExists<T>(
  actual: T | null | undefined,
  message?: string,
): asserts actual is T {
  ok(actual !== null && actual !== undefined, message ?? "Expected value to exist");
}

export function assertEquals<T>(actual: T, expected: T, message?: string): void {
  deepStrictEqual(actual, expected, message);
}

export function assertStringIncludes(actual: string, expected: string, message?: string): void {
  ok(
    actual.includes(expected),
    message ?? `Expected string to include ${JSON.stringify(expected)}`,
  );
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
      ok(error instanceof ErrorClass, `Expected ${ErrorClass.name}`);
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
      ok(error instanceof ErrorClass, `Expected ${ErrorClass.name}`);
    }
    if (msgIncludes) {
      assertStringIncludes(String((error as Error).message), msgIncludes);
    }
    return error as Error;
  }
  throw new Error("Expected promise to reject");
}

export { strictEqual };

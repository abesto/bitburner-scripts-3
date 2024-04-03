import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";

export function errorMessage(e: unknown): string {
  if (
    typeof e === "object" &&
    e !== null &&
    "message" in e &&
    typeof e.message === "string"
  ) {
    return e.message;
  }
  return String(e);
}

export function maybeZodErrorMessage(error: unknown): string {
  return error instanceof ZodError
    ? fromZodError(error).message
    : errorMessage(error);
}

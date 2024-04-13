import { z } from "zod";

export const Request = z.object({
  marker: z.literal("rpc/Request"),
  method: z.string(),
  responseMeta: z
    .object({
      port: z.number(),
      msgId: z.string(),
    })
    .optional(),
  args: z.array(z.unknown()),
});
export type Request = z.infer<typeof Request>;

export const Response = z.discriminatedUnion("status", [
  z.object({
    marker: z.literal("rpc/Response"),
    status: z.literal("success"),
    msgId: z.string(),
    result: z.unknown(),
  }),
  z.object({
    marker: z.literal("rpc/Response"),
    status: z.literal("error"),
    msgId: z.string(),
    error: z.string(),
  }),
]);
export type Response = z.infer<typeof Response>;

export const successResponse = (msgId: string, result: unknown): Response => {
  return {
    marker: "rpc/Response",
    status: "success",
    msgId,
    result,
  };
};

export const errorResponse = (msgId: string, error: string): Response => {
  return {
    marker: "rpc/Response",
    status: "error",
    msgId,
    error,
  };
};

export class RpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcError";
  }
}

export interface Res {
  success: (result: unknown) => Promise<void>;
  error: (error: string) => Promise<void>;
}

export type Handler = (req: Request, res: Res) => void | Promise<void>;

export type APIImpl<T> = {
  [K in keyof T]: T[K] extends (...args: infer Args) => unknown
    ? Handler
    : never;
};

import { RedisService } from "./server";
import { describe, beforeEach, it, expect, vi } from "vitest";
import { MemoryRedisStorage } from "./storage";

const noopNS: NS = {
  disableLog: vi.fn(),
  getPortHandle: vi.fn(),
} as unknown as NS;

describe("RedisService", () => {
  let redisService: RedisService;

  beforeEach(() => {
    redisService = new RedisService(noopNS, new MemoryRedisStorage());
  });

  describe("xadd", () => {
    it("should add a new entry to the stream", () => {
      const key = "my-stream";
      redisService.xadd(0, key, "*", []);
      redisService.xadd(0, key, "*", []);
      expect(redisService.xlen(0, key)).toEqual(2);
    });

    it("should return the generated stream ID", () => {
      const key = "my-stream";
      expect(redisService.xadd(0, key, "*", [])).toBeTypeOf("string");
      expect(redisService.xadd(0, key, "123-0", [])).toStrictEqual("123-0");
    });

    describe("xrange", () => {
      it("should return all entries in the specified range", () => {
        const key = "my-stream";
        for (const id of ["1-0", "2-0", "2-1", "3-0", "4-0"]) {
          redisService.xadd(0, key, id, [
            ["field", "value"],
            ["id", id],
          ]);
        }
        expect(redisService.xrange(0, key, "2-", "3-")).toStrictEqual([
          [
            "2-0",
            [
              ["field", "value"],
              ["id", "2-0"],
            ],
          ],
          [
            "2-1",
            [
              ["field", "value"],
              ["id", "2-1"],
            ],
          ],
          [
            "3-0",
            [
              ["field", "value"],
              ["id", "3-0"],
            ],
          ],
        ]);

        expect(redisService.xrange(0, key, "2-1", "4-0")).toStrictEqual([
          [
            "2-1",
            [
              ["field", "value"],
              ["id", "2-1"],
            ],
          ],
          [
            "3-0",
            [
              ["field", "value"],
              ["id", "3-0"],
            ],
          ],
          [
            "4-0",
            [
              ["field", "value"],
              ["id", "4-0"],
            ],
          ],
        ]);

        expect(redisService.xrange(0, key, "-", "+")).toStrictEqual([
          [
            "1-0",
            [
              ["field", "value"],
              ["id", "1-0"],
            ],
          ],
          [
            "2-0",
            [
              ["field", "value"],
              ["id", "2-0"],
            ],
          ],
          [
            "2-1",
            [
              ["field", "value"],
              ["id", "2-1"],
            ],
          ],
          [
            "3-0",
            [
              ["field", "value"],
              ["id", "3-0"],
            ],
          ],
          [
            "4-0",
            [
              ["field", "value"],
              ["id", "4-0"],
            ],
          ],
        ]);
      });

      it("should return a limited number of entries if count is specified", () => {
        const key = "my-stream";
        for (const id of ["1-0", "2-0", "2-1", "3-0", "4-0"]) {
          redisService.xadd(0, key, id, []);
        }
        expect(redisService.xrange(0, key, "-", "+", 2)).toStrictEqual([
          ["1-0", []],
          ["2-0", []],
        ]);
        expect(redisService.xrange(0, key, "2-", "3-", 1)).toStrictEqual([
          ["2-0", []],
        ]);
      });
    });
  });
});

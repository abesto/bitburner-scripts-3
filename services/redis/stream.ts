// Note: real Redis implements this with a custom radix tree.
// That's an optimization that could be applied here too!

import { RawStream, StreamEntry, StreamID } from "./types";

// A stream is a list of entries, sorted by StreamID
export class Stream {
  constructor(private readonly data: RawStream = []) {}

  toJSON(): RawStream {
    return this.data;
  }

  indexOfFirstLaterOrEqual(id: StreamID): number {
    if (this.data.length === 0) {
      return -1;
    }
    let low = 0;
    let high = this.data.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      const midEntry = this.data[mid];
      if (midEntry && midEntry[0] < id) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  }

  indexOfLastEarlierThan(id: StreamID): number {
    return this.data.findLastIndex(([entryId]) => entryId <= id);
  }

  add(id: StreamID, entry: StreamEntry) {
    const index = this.indexOfFirstLaterOrEqual(id);
    this.data.splice(index, 0, [id, entry]);
  }

  get(id: StreamID): StreamEntry | undefined {
    const index = this.indexOfFirstLaterOrEqual(id);
    if (index === 0) {
      return;
    }
    const prev = this.data[index - 1];
    if (!prev || prev[0] !== id) {
      return;
    }
    return prev[1];
  }

  range(start: string, end: string, count?: number): [StreamID, StreamEntry][] {
    const startIndex = start === "-" ? 0 : this.indexOfFirstLaterOrEqual(start);
    // There's maybe an off-by-one here?
    let endIndex =
      end === "+" ? this.data.length : this.indexOfFirstLaterOrEqual(end) + 1;
    if (count !== undefined) {
      endIndex = Math.min(endIndex, startIndex + count);
    }
    return this.data.slice(startIndex, endIndex);
  }

  trimMaxLength(maxLength: number) {
    this.data.splice(0, this.data.length - maxLength);
  }

  trimMinId(minId: StreamID) {
    const index = this.indexOfLastEarlierThan(minId);
    if (index !== -1) {
      this.data.splice(0, index + 1);
    }
  }

  prefix(prefix: string): [StreamID, StreamEntry][] {
    const startIndex = this.indexOfFirstLaterOrEqual(prefix);
    const ret = [];
    for (const [id, entry] of this.data.slice(startIndex)) {
      if (id.startsWith(prefix)) {
        ret.push([id, entry]);
      } else {
        break;
      }
    }
    return this.data.slice(startIndex);
  }

  get length(): number {
    return this.data.length;
  }
}

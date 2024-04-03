import { SwarmCapacity } from "./types";
import arrayShuffle from "array-shuffle";

export function calculateHostCandidates(
  scriptRam: number,
  threads: number,
  swarmCapacity: SwarmCapacity,
  hostname: string | undefined
): string[] {
  let capacity: [string, number][] = Object.entries(swarmCapacity.hosts).map(
    ([host, { used, max }]) => [host, max - used]
  );
  // Only want hosts that have enough memory for at least one thread
  capacity = capacity.filter(([, free]) => free >= scriptRam);
  // Shuffle!
  capacity = arrayShuffle(capacity);
  // Prefer those hosts that have enough memory for all threads, and prefer the ones with the least memory between those
  capacity = capacity.sort(([, freeA], [, freeB]) => {
    const aHasEnough = freeA >= scriptRam * threads;
    const bHasEnough = freeB >= scriptRam * threads;
    if (aHasEnough && !bHasEnough) {
      return -1;
    }
    if (!aHasEnough && bHasEnough) {
      return 1;
    }
    return freeA - freeB;
  });
  // Apply host affinity
  if (hostname) {
    capacity = capacity.filter(([host]) => host === hostname);
  }
  return capacity.map(([host]) => host);
}

export function allocateThreads(
  scriptRam: number,
  threads: number,
  swarmCapacity: SwarmCapacity,
  candidates: string[]
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const candidate of candidates) {
    const hostCapacity = swarmCapacity.hosts[candidate];
    if (!hostCapacity) {
      throw new Error(`candidate not in swarm: ${candidate}`);
    }
    const { used, max } = hostCapacity;
    const free = max - used;
    const availableThreads = Math.floor(free / scriptRam);
    const allocatedThreads = Math.min(threads, availableThreads);
    result[candidate] = allocatedThreads;
    threads -= allocatedThreads;
    if (threads <= 0) {
      break;
    }
  }
  return result;
}

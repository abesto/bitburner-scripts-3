import { DockerNode, SwarmCapacity } from "./types";
import arrayShuffle from "array-shuffle";

export function calculateHostCandidates(
  scriptRam: number,
  threads: number,
  swarmCapacity: SwarmCapacity,
  hostnames: string[]
): string[] {
  let capacity: [DockerNode, number][] = swarmCapacity.hosts.map(
    ([node, { used, max }]) => [node, max - used]
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
  if (hostnames.length > 0) {
    capacity = capacity.filter(([node]) => hostnames.includes(node.hostname));
  }
  return capacity.map(([node]) => node.hostname);
}

export function allocateThreads(
  scriptRam: number,
  threads: number,
  swarmCapacity: SwarmCapacity,
  candidates: string[]
): [DockerNode, number][] {
  const result: [DockerNode, number][] = [];
  const candidateNodes = swarmCapacity.hosts.filter(([node]) =>
    candidates.includes(node.hostname)
  );
  for (const [node, hostCapacity] of candidateNodes) {
    const { used, max } = hostCapacity;
    const free = max - used;
    const availableThreads = Math.floor(free / scriptRam);
    const allocatedThreads = Math.min(threads, availableThreads);
    result.push([node, allocatedThreads]);
    threads -= allocatedThreads;
    if (threads <= 0) {
      break;
    }
  }
  return result;
}

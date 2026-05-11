// ═══════════════════════════════════════════════════════════════════
// TYPE DECLARATIONS — Module Augmentations & Missing Types
// ═══════════════════════════════════════════════════════════════════

// Three.js WebGPU module
declare module 'three/webgpu' {
  export { WebGPURenderer } from 'three/src/renderers/webgpu/WebGPURenderer.js';
}

// ngraph modules
declare module 'ngraph.graph' {
  interface Graph<NodeData = any, LinkData = any> {
    addNode(id: number | string, data?: NodeData): any;
    addLink(from: number | string, to: number | string, data?: LinkData): any;
    removeNode(id: number | string): boolean;
    removeLink(link: any): boolean;
    getNode(id: number | string): any;
    getLink(from: number | string, to: number | string): any;
    getNodeCount(): number;
    forEachNode(callback: (node: any) => boolean | void): void;
    forEachLink(callback: (link: any) => void): void;
    forEachLinkedNode(nodeId: number | string, callback: (linked: any, link: any) => void): void;
    clear(): void;
  }
  function createGraph<NodeData = any, LinkData = any>(): Graph<NodeData, LinkData>;
  export default createGraph;
}

declare module 'ngraph.path' {
  interface PathResult {
    id: number | string;
    data: any;
  }
  interface PathFinder {
    find(from: number | string, to: number | string): PathResult[];
  }
  interface PathOptions {
    distance?: (from: any, to: any, link: any) => number;
    heuristic?: (from: any, to: any) => number;
    blocked?: (from: any, to: any, link: any) => boolean;
  }
  interface PathModule {
    aStar(graph: any, options?: PathOptions): PathFinder;
    nba(graph: any, options?: PathOptions): PathFinder;
  }
  const path: PathModule;
  export default path;
}

// Yuka steering behaviors
declare module 'yuka' {
  export class Vector3 {
    x: number; y: number; z: number;
    constructor(x?: number, y?: number, z?: number);
    set(x: number, y: number, z: number): this;
    length(): number;
  }
  export class Vehicle {
    position: Vector3;
    velocity: Vector3;
    maxSpeed: number;
    steering: SteeringManager;
  }
  export class SteeringManager {
    behaviors: SteeringBehavior[];
    add(behavior: SteeringBehavior): this;
    remove(behavior: SteeringBehavior): this;
  }
  export class SteeringBehavior {
    weight: number;
    active: boolean;
  }
  export class ArriveBehavior extends SteeringBehavior {
    target: Vector3;
    constructor(target?: Vector3, deceleration?: number, tolerance?: number);
  }
  export class OffsetPursuitBehavior extends SteeringBehavior {
    constructor(leader: Vehicle, offset: Vector3);
  }
  export class SeparationBehavior extends SteeringBehavior {}
  export class CohesionBehavior extends SteeringBehavior {}
  export class AlignmentBehavior extends SteeringBehavior {}
  export class PursuitBehavior extends SteeringBehavior {
    constructor(target: Vehicle);
  }
  export class EvadeBehavior extends SteeringBehavior {
    constructor(target: Vehicle);
  }
  export class EntityManager {
    add(entity: Vehicle): this;
    remove(entity: Vehicle): this;
    update(delta: number): this;
  }
}

// Howler
declare module 'howler' {
  export class Howl {
    constructor(options: any);
    play(sprite?: string): number;
    stop(id?: number): this;
    volume(vol?: number, id?: number): this | number;
    rate(rate?: number, id?: number): this | number;
    fade(from: number, to: number, duration: number, id?: number): this;
    state(): string;
    load(): this;
    unload(): void;
    once(event: string, fn: Function): this;
  }
  export const Howler: {
    volume(vol?: number): number;
    mute(muted: boolean): void;
    ctx: AudioContext;
  };
}

// fflate
declare module 'fflate' {
  export function gzipSync(data: Uint8Array, opts?: { level?: number }): Uint8Array;
  export function gunzipSync(data: Uint8Array): Uint8Array;
  export function strToU8(str: string): Uint8Array;
  export function strFromU8(data: Uint8Array): string;
}

// Dexie EntityTable
declare module 'dexie' {
  export default class Dexie {
    constructor(name: string);
    version(num: number): { stores(schema: Record<string, string>): void };
    table(name: string): any;
  }
  export type EntityTable<T, K extends keyof T> = {
    get(key: T[K]): Promise<T | undefined>;
    put(item: T): Promise<T[K]>;
    delete(key: T[K]): Promise<void>;
    toArray(): Promise<T[]>;
    orderBy(key: keyof T): { reverse(): { toArray(): Promise<T[]> } };
  };
}

// Colyseus client (future)
declare module 'colyseus.js' {
  export class Client {
    constructor(url: string);
    joinOrCreate(roomName: string, options?: any): Promise<any>;
  }
}

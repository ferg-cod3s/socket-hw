declare module '@yarnpkg/lockfile' {
  export interface LockFileObject {
    [packageName: string]: {
      version?: string;
      resolved?: string;
      integrity?: string;
      dependencies?: Record<string, string>;
    };
  }

  export interface ParseResult {
    type: 'success' | 'merge' | 'conflict';
    object: LockFileObject | null;
  }

  export function parse(
    lockFile: string,
    enableMerge?: boolean
  ): ParseResult;

  export function stringify(
    lockFileObject: LockFileObject,
    enableMerge?: boolean
  ): string;
}


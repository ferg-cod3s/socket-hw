import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

vi.mock('node:fs');

describe('Provider Selection', () => {
  let selectProvider: any;

  beforeEach(async () => {
    vi.resetModules();
    ({ selectProvider } = await import('../../src/providers/index.js'));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('selects Node provider when package.json exists', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      return String(p).endsWith('package.json');
    });

    const result = selectProvider('/test/project');
    expect(result.detection.providerId).toBe('node');
  });

  it('selects Poetry provider when pyproject.toml with [tool.poetry] exists', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('pyproject.toml')) return true;
      return false;
    });

    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('pyproject.toml')) {
        return `[tool.poetry]
name = "test-project"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28.0"
`;
      }
      return '';
    });

    const result = selectProvider('/test/project');
    expect(result.detection.providerId).toBe('python-poetry');
    expect(result.detection.name).toBe('Poetry');
  });

  it('throws error when no ecosystem detected', () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(() => selectProvider('/empty/project')).toThrow(
      /No supported ecosystem detected/
    );
  });

  it('prefers Node over Poetry when both exist', () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('package.json')) {
        return JSON.stringify({ name: 'test' });
      }
      if (path.endsWith('pyproject.toml')) {
        return '[tool.poetry]\nname = "test"';
      }
      return '';
    });

    const result = selectProvider('/test/project');
    expect(result.detection.providerId).toBe('node');
  });

  it('selects Pip provider when requirements.txt exists without pyproject.toml', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      return path.endsWith('requirements.txt');
    });

    const result = selectProvider('/test/project');
    expect(result.detection.providerId).toBe('python-pip');
    expect(result.detection.name).toBe('pip');
  });

  it('prefers Poetry over Pip when both requirements.txt and pyproject.toml exist', () => {
    vi.mocked(existsSync).mockImplementation((p: any) => {
      const path = String(p);
      return path.endsWith('requirements.txt') || path.endsWith('pyproject.toml');
    });

    vi.mocked(readFileSync).mockImplementation((p: any) => {
      const path = String(p);
      if (path.endsWith('pyproject.toml')) {
        return `[tool.poetry]
name = "test-project"
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.9"
requests = "^2.28.0"
`;
      }
      return '';
    });

    const result = selectProvider('/test/project');
    expect(result.detection.providerId).toBe('python-poetry');
  });
});


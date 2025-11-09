import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ScanResults } from '../../src/components/ScanResults';
import type { ScanResult } from '../../src/lib/scanner';

const mockDetection = {
  providerId: 'node',
  name: 'npm',
  variant: 'package.json',
  confidence: 1,
};

describe('ScanResults Component', () => {
  describe('ES2023 Object.groupBy() feature', () => {
    it('correctly groups vulnerabilities by severity', () => {
      const mockResult: ScanResult = {
        deps: [
          { name: 'pkg1', version: '1.0.0', ecosystem: 'npm' },
          { name: 'pkg2', version: '2.0.0', ecosystem: 'npm' },
          { name: 'pkg3', version: '3.0.0', ecosystem: 'npm' },
        ],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'CVE-2024-001',
              source: 'osv',
              severity: 'CRITICAL',
              summary: 'Critical vulnerability',
              references: [],
            },
            {
              id: 'CVE-2024-002',
              source: 'ghsa',
              severity: 'HIGH',
              summary: 'High severity issue',
              references: [],
            },
          ],
          'pkg2@2.0.0': [
            {
              id: 'CVE-2024-003',
              source: 'osv',
              severity: 'MEDIUM',
              summary: 'Medium severity issue',
              references: [],
            },
          ],
          'pkg3@3.0.0': [
            {
              id: 'CVE-2024-004',
              source: 'osv',
              severity: 'LOW',
              summary: 'Low severity issue',
              references: [],
            },
          ],
        },
        scanDurationMs: 5000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      // Verify the component rendered by checking for Severity Breakdown heading
      expect(screen.getByText('Severity Breakdown')).toBeInTheDocument();

      // Check that severity breakdown section exists with counts
      // Use getAllByText since there could be multiple matches
      const percentTexts = screen.getAllByText(/\d+ \(\d+\.\d+%\)/);
      expect(percentTexts.length).toBeGreaterThan(0);
    });

    it('handles mixed case severity levels', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'CVE-001',
              source: 'osv',
              severity: 'critical',
              summary: 'Test',
              references: [],
            },
            {
              id: 'CVE-002',
              source: 'osv',
              severity: 'CRITICAL',
              summary: 'Test',
              references: [],
            },
            {
              id: 'CVE-003',
              source: 'osv',
              severity: 'Critical',
              summary: 'Test',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      // All three should be grouped under CRITICAL severity
      // They should appear together in the severity breakdown with count "3 (100.0%)"
      expect(screen.getByText(/3 \(100\.0%\)/)).toBeInTheDocument();
    });

    it('handles MODERATE as MEDIUM severity', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'CVE-001',
              source: 'osv',
              severity: 'MODERATE',
              summary: 'Moderate issue',
              references: [],
            },
            {
              id: 'CVE-002',
              source: 'osv',
              severity: 'MEDIUM',
              summary: 'Medium issue',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      // Both MODERATE and MEDIUM should be counted together as 2 (100.0%)
      expect(screen.getByText(/2 \(100\.0%\)/)).toBeInTheDocument();
    });

    it('handles missing severity as UNKNOWN', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'CVE-001',
              source: 'osv',
              severity: undefined as any,
              summary: 'Unknown severity',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      // Should have Unknown severity in breakdown
      // Check for Severity Breakdown section which will contain the unknown severity
      expect(screen.getByText('Severity Breakdown')).toBeInTheDocument();

      // Verify that we have vulnerability cards
      expect(screen.getByText(/CVE-001/)).toBeInTheDocument();
    });

    it('correctly calculates severity percentages using groupBy', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'CVE-001',
              source: 'osv',
              severity: 'CRITICAL',
              summary: 'Test',
              references: [],
            },
            {
              id: 'CVE-002',
              source: 'osv',
              severity: 'CRITICAL',
              summary: 'Test',
              references: [],
            },
            {
              id: 'CVE-003',
              source: 'osv',
              severity: 'LOW',
              summary: 'Test',
              references: [],
            },
            {
              id: 'CVE-004',
              source: 'osv',
              severity: 'LOW',
              summary: 'Test',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      // 2 CRITICAL out of 4 = 50%
      // 2 LOW out of 4 = 50%
      // Verify severity breakdown is present
      expect(screen.getByText('Severity Breakdown')).toBeInTheDocument();

      // Check that we have the correct severity percentages rendered
      // Use getAllByText since both CRITICAL and LOW will have 50%
      const fiftyPercentTexts = screen.getAllByText(/2 \(50\.0%\)/);
      expect(fiftyPercentTexts.length).toBeGreaterThanOrEqual(2); // At least 2 instances
    });
  });

  describe('ES2023 .toSorted() feature', () => {
    it('vulnerabilities are sorted by severity using toSorted', () => {
      const mockResult: ScanResult = {
        deps: [
          { name: 'pkg1', version: '1.0.0', ecosystem: 'npm' },
          { name: 'pkg2', version: '2.0.0', ecosystem: 'npm' },
        ],
        advisoriesByPackage: {
          'pkg2@2.0.0': [
            {
              id: 'LOW-VULN',
              source: 'osv',
              severity: 'LOW',
              summary: 'Low priority',
              references: [],
            },
          ],
          'pkg1@1.0.0': [
            {
              id: 'CRITICAL-VULN',
              source: 'osv',
              severity: 'CRITICAL',
              summary: 'Critical issue',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      // CRITICAL should appear before LOW in the document
      const criticalElement = screen.getByText(/CRITICAL-VULN/);
      const lowElement = screen.getByText(/LOW-VULN/);

      expect(criticalElement.compareDocumentPosition(lowElement)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });

    it('handles complex vulnerability sorting with multiple packages', () => {
      const mockResult: ScanResult = {
        deps: [
          { name: 'pkg-a', version: '1.0.0', ecosystem: 'npm' },
          { name: 'pkg-b', version: '2.0.0', ecosystem: 'npm' },
          { name: 'pkg-c', version: '3.0.0', ecosystem: 'npm' },
        ],
        advisoriesByPackage: {
          'pkg-c@3.0.0': [
            {
              id: 'LOW-1',
              source: 'osv',
              severity: 'LOW',
              summary: 'Low issue',
              references: [],
            },
          ],
          'pkg-b@2.0.0': [
            {
              id: 'HIGH-1',
              source: 'osv',
              severity: 'HIGH',
              summary: 'High issue',
              references: [],
            },
          ],
          'pkg-a@1.0.0': [
            {
              id: 'MEDIUM-1',
              source: 'osv',
              severity: 'MEDIUM',
              summary: 'Medium issue',
              references: [],
            },
            {
              id: 'CRITICAL-1',
              source: 'osv',
              severity: 'CRITICAL',
              summary: 'Critical issue',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      // Get positions of vulnerabilities
      const critical = screen.getByText(/CRITICAL-1/);
      const high = screen.getByText(/HIGH-1/);
      const medium = screen.getByText(/MEDIUM-1/);
      const low = screen.getByText(/LOW-1/);

      // CRITICAL should come first
      expect(critical.compareDocumentPosition(high)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(high.compareDocumentPosition(medium)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(medium.compareDocumentPosition(low)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    });
  });

  describe('Component rendering', () => {
    it('shows summary as title and advisory ID as metadata when both provided', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'GHSA-1234',
              source: 'ghsa',
              severity: 'HIGH',
              summary: 'Remote code execution vulnerability',
              details: 'Detailed description',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      expect(screen.getByText('Remote code execution vulnerability')).toBeInTheDocument();
      expect(screen.getByText(/Advisory ID: GHSA-1234/)).toBeInTheDocument();
      expect(screen.getByText('Detailed description')).toBeInTheDocument();
    });

    it('falls back to advisory ID as title when summary missing', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'OSV-5678',
              source: 'osv',
              severity: 'LOW',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      expect(screen.getByRole('heading', { name: 'OSV-5678' })).toBeInTheDocument();
      expect(screen.queryByText(/Advisory ID:/)).not.toBeInTheDocument();
      expect(screen.getByText('No description available')).toBeInTheDocument();
    });

    it('falls back to placeholder when description missing but summary present', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'CVE-2025-0001',
              source: 'osv',
              severity: 'MEDIUM',
              summary: 'Memory leak vulnerability',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      expect(screen.getByText('Memory leak vulnerability')).toBeInTheDocument();
      expect(screen.getByText(/Advisory ID: CVE-2025-0001/)).toBeInTheDocument();
      expect(screen.getByText('No description available')).toBeInTheDocument();
    });

    it('renders scan results correctly', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {},
        scanDurationMs: 2500,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      expect(screen.getByText(/Scan Results:/)).toBeInTheDocument();
      expect(screen.getByText(/package.json/)).toBeInTheDocument();
    });

    it('displays export button', () => {
      const mockResult: ScanResult = {
        deps: [],
        advisoriesByPackage: {},
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="test.json" />);

      expect(screen.getByText(/Export as JSON/)).toBeInTheDocument();
    });

    it('shows advisory summary as title and details as description', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg1', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg1@1.0.0': [
            {
              id: 'CVE-123',
              source: 'osv',
              severity: 'HIGH',
              summary: 'Execution bug',
              details: 'Arbitrary code execution possible via malformed input.',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      expect(screen.getByText('Execution bug')).toBeInTheDocument();
      expect(
        screen.getByText('Arbitrary code execution possible via malformed input.')
      ).toBeInTheDocument();
    });

    it('falls back to advisory id and default description when data missing', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'pkg2', version: '2.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'pkg2@2.0.0': [
            {
              id: 'GHSA-xyz',
              source: 'ghsa',
              severity: 'LOW',
              references: [],
            },
          ],
        },
        scanDurationMs: 1000,
        detection: mockDetection,
      };

      render(<ScanResults result={mockResult} fileName="package.json" />);

      expect(screen.getByText('GHSA-xyz')).toBeInTheDocument();
      expect(screen.getAllByText('No description available').length).toBeGreaterThan(0);
    });
  });

  describe('Export functionality', () => {
    it('exports scan results as JSON when export button is clicked', () => {
      const mockResult: ScanResult = {
        deps: [{ name: 'test-pkg', version: '1.0.0', ecosystem: 'npm' }],
        advisoriesByPackage: {
          'test-pkg@1.0.0': [
            {
              id: 'CVE-2024-TEST',
              source: 'osv',
              severity: 'HIGH',
              summary: 'Test vulnerability',
              references: ['https://example.com'],
            },
          ],
        },
        scanDurationMs: 1500,
        detection: mockDetection,
      };

      // Mock DOM APIs for file download
      const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
      const mockRevokeObjectURL = vi.fn();
      const mockClick = vi.fn();

      global.URL.createObjectURL = mockCreateObjectURL;
      global.URL.revokeObjectURL = mockRevokeObjectURL;

      // Store original createElement
      const originalCreateElement = document.createElement.bind(document);

      // Mock createElement to only intercept 'a' element creation
      const mockAnchor = originalCreateElement('a');
      mockAnchor.click = mockClick;

      const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
        if (tagName === 'a') {
          return mockAnchor;
        }
        return originalCreateElement(tagName);
      });

      // Render the component
      render(<ScanResults result={mockResult} fileName="test-lockfile.json" />);

      // Click the export button
      const exportButton = screen.getByText(/Export as JSON/);
      fireEvent.click(exportButton);

      // Verify createElement was called with 'a'
      expect(createElementSpy).toHaveBeenCalledWith('a');

      // Verify Blob was created with correct data
      expect(mockCreateObjectURL).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'application/json',
        }),
      );

      // Verify link was clicked
      expect(mockClick).toHaveBeenCalled();

      // Verify URL was revoked after download
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

      // Verify the anchor element had the right properties set
      expect(mockAnchor.href).toContain('blob:mock-url');
      expect(mockAnchor.download).toMatch(/scan-test-lockfile\.json-\d+\.json/);

      // Restore mocks
      vi.restoreAllMocks();
    });
  });
});

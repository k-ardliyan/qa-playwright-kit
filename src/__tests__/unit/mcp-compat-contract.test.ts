import { test, expect } from '@playwright/test';
import {
  assessMcpCliContract,
  validateContractAgainstManifest,
} from '../../../tools/scripts/mcp-compat-check';

/**
 * Excerpt of the REAL installed `@playwright/mcp@0.0.83 --help` output for the
 * flags the launcher emits. Kept as an inline fixture so the contract parser is
 * tested happy-path without spawning the CLI on every run.
 */
const MCP_083_HELP = `  --allowed-origins <origins>           semicolon-separated list of TRUSTED
                                        origins to allow the browser to request.
                                        Default is to allow all.
                                        Important: *does not* serve as a
                                        security boundary and *does not* affect
                                        redirects.
  --browser <browser>                   browser or chrome channel to use,
                                        possible values: chrome, firefox,
                                        webkit, msedge.
  --caps <caps>                         comma-separated list of additional
                                        capabilities to enable, possible values:
                                        vision, pdf, devtools.
  --headless                            run browser in headless mode, headed by
                                        default
  --isolated                            keep the browser profile in memory, do
                                        not save it to disk.
`;

test.describe('MCP CLI contract parser (installed @playwright/mcp)', () => {
  test('extracts advertised caps, origin separator, and browser values from 0.0.83 help', () => {
    const a = assessMcpCliContract(MCP_083_HELP);
    expect(a.additiveCaps.sort()).toEqual(['devtools', 'pdf', 'vision']);
    expect(a.allowedOriginsSeparator).toBe('semicolon');
    expect(a.browserValues).toContain('chrome');
    expect(a.browserValues).toContain('firefox');
    expect(a.browserValues).toContain('webkit');
    expect(a.browserValues).toContain('msedge');
    expect(a.browserValues).not.toContain('chromium');
  });

  test('0.0.83 contract passes framework validation with no errors', () => {
    const { errors, warnings } = validateContractAgainstManifest(
      assessMcpCliContract(MCP_083_HELP),
    );
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('flags a future contract break when an additive cap is dropped', () => {
    const broken = MCP_083_HELP.replace('vision, pdf, devtools', 'vision, pdf');
    const { errors } = validateContractAgainstManifest(assessMcpCliContract(broken));
    expect(errors.some((e) => e.includes('devtools'))).toBe(true);
  });

  test('warns (not errors) when the origin separator semantics change', () => {
    const drifted = MCP_083_HELP.replace('semicolon-separated', 'comma-separated');
    const { errors, warnings } = validateContractAgainstManifest(assessMcpCliContract(drifted));
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('--allowed-origins separator'))).toBe(true);
  });
});

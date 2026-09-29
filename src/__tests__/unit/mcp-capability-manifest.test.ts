import { test, expect } from '@playwright/test';
import {
  PLAYWRIGHT_MCP_CAPABILITY_MANIFEST,
  ALL_MCP_CAPABILITIES,
  isValidCapability,
  getCapabilityTools,
} from '../../shared/mcp/capability-manifest';

test.describe('MCP Capability Manifest (MCP-006)', () => {
  test('contains all expected capability categories', () => {
    const expected = [
      'core',
      'network',
      'storage',
      'testing',
      'vision',
      'pdf',
      'devtools',
      'config',
    ];
    expect(ALL_MCP_CAPABILITIES).toEqual(expected);
  });

  test('validates capability names correctly', () => {
    expect(isValidCapability('core')).toBe(true);
    expect(isValidCapability('testing')).toBe(true);
    expect(isValidCapability('storage')).toBe(true);
    expect(isValidCapability('nonexistent')).toBe(false);
  });

  test('returns tool list for valid capabilities (real 0.0.83 surface)', () => {
    const coreTools = getCapabilityTools('core');
    expect(coreTools).toContain('browser_navigate');
    expect(coreTools).toContain('browser_snapshot');
    expect(coreTools).toContain('browser_click');

    const testingTools = getCapabilityTools('testing');
    expect(testingTools).toContain('browser_generate_locator');
    expect(testingTools).toContain('browser_verify_element_visible');
    expect(testingTools).toContain('browser_verify_text_visible');
    expect(testingTools).not.toContain('browser_assert_visible'); // old/renamed name

    const storageTools = getCapabilityTools('storage');
    expect(storageTools).toContain('browser_storage_state');
    expect(storageTools).toContain('browser_set_storage_state');
    expect(storageTools).not.toContain('browser_storage_state_save');

    const configTools = getCapabilityTools('config');
    expect(configTools).toContain('browser_get_config');
    expect(configTools).not.toContain('browser_config_set');

    expect(getCapabilityTools('devtools')).toContain('browser_start_tracing');
    expect(getCapabilityTools('vision')).toContain('browser_mouse_click_xy');
  });

  test('every manifest tool name exists in the installed server surface', () => {
    // Fixture extracted from the actually installed @playwright/mcp 0.0.83 by
    // probing `tools/list` over stdio for every --caps set (72 exposed tools —
    // identical to 0.0.82). Bundle-only names the server does NOT expose
    // (browser_reload, browser_check, browser_keydown, browser_navigate_forward,
    // browser_console_clear, browser_network_clear, browser_webmcp_list) must
    // stay out: agents calling them get 'unknown tool'.
    const installedSurface = [
      'browser_annotate',
      'browser_click',
      'browser_close',
      'browser_console_messages',
      'browser_cookie_clear',
      'browser_cookie_delete',
      'browser_cookie_get',
      'browser_cookie_list',
      'browser_cookie_set',
      'browser_drag',
      'browser_drop',
      'browser_emulate_media',
      'browser_evaluate',
      'browser_file_upload',
      'browser_fill_form',
      'browser_find',
      'browser_generate_locator',
      'browser_get_config',
      'browser_handle_dialog',
      'browser_hide_highlight',
      'browser_highlight',
      'browser_hover',
      'browser_localstorage_clear',
      'browser_localstorage_delete',
      'browser_localstorage_get',
      'browser_localstorage_list',
      'browser_localstorage_set',
      'browser_mouse_click_xy',
      'browser_mouse_down',
      'browser_mouse_drag_xy',
      'browser_mouse_move_xy',
      'browser_mouse_up',
      'browser_mouse_wheel',
      'browser_navigate',
      'browser_navigate_back',
      'browser_network_request',
      'browser_network_requests',
      'browser_network_state_set',
      'browser_pdf_save',
      'browser_press_key',
      'browser_resize',
      'browser_resume',
      'browser_route',
      'browser_route_list',
      'browser_run_code_unsafe',
      'browser_select_option',
      'browser_sessionstorage_clear',
      'browser_sessionstorage_delete',
      'browser_sessionstorage_get',
      'browser_sessionstorage_list',
      'browser_sessionstorage_set',
      'browser_set_storage_state',
      'browser_snapshot',
      'browser_start_recording',
      'browser_start_tracing',
      'browser_start_video',
      'browser_stop_recording',
      'browser_stop_tracing',
      'browser_stop_video',
      'browser_storage_state',
      'browser_tabs',
      'browser_take_screenshot',
      'browser_type',
      'browser_unroute',
      'browser_verify_element_visible',
      'browser_verify_list_visible',
      'browser_verify_text_visible',
      'browser_verify_value',
      'browser_video_chapter',
      'browser_video_hide_actions',
      'browser_video_show_actions',
      'browser_wait_for',
    ];
    const surface = new Set(installedSurface);

    const manifestTools = Object.values(PLAYWRIGHT_MCP_CAPABILITY_MANIFEST).flat();
    const missing = manifestTools.filter((t) => !surface.has(t));
    expect(missing).toEqual([]);
  });

  test('has no duplicated tools across individual capability buckets', () => {
    const allTools = Object.values(PLAYWRIGHT_MCP_CAPABILITY_MANIFEST).flat();
    const uniqueTools = new Set(allTools);
    expect(allTools.length).toBe(uniqueTools.size);
  });
});

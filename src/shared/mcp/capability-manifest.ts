/**
 * Canonical capability manifest for official @playwright/mcp integration.
 * Represents framework expectations of official MCP capabilities and tools.
 *
 * Tool names verified against the ACTUAL installed server surface
 * (`@playwright/mcp` 0.0.80): browser capability manifest.
 */

export interface CapabilityManifest {
  core: readonly string[];
  network: readonly string[];
  storage: readonly string[];
  testing: readonly string[];
  vision: readonly string[];
  pdf: readonly string[];
  devtools: readonly string[];
  config: readonly string[];
}

export type McpCapability = keyof CapabilityManifest;

export const PLAYWRIGHT_MCP_CAPABILITY_MANIFEST: CapabilityManifest = {
  core: [
    'browser_navigate',
    'browser_navigate_back',
    'browser_navigate_forward',
    'browser_reload',
    'browser_close',
    'browser_tabs',
    'browser_snapshot',
    'browser_take_screenshot',
    'browser_click',
    'browser_drag',
    'browser_drop',
    'browser_hover',
    'browser_type',
    'browser_fill_form',
    'browser_select_option',
    'browser_press_key',
    'browser_resize',
    'browser_wait_for',
    'browser_handle_dialog',
    'browser_file_upload',
    'browser_find',
    'browser_annotate',
    'browser_highlight',
    'browser_hide_highlight',
    'browser_check',
    'browser_uncheck',
    'browser_press_sequentially',
    'browser_keydown',
    'browser_keyup',
    'browser_run_code_unsafe',
  ] as const,
  network: [
    'browser_network_requests',
    'browser_network_request',
    'browser_network_clear',
    'browser_network_state_set',
    'browser_route',
    'browser_unroute',
    'browser_route_list',
  ] as const,
  storage: [
    'browser_cookie_get',
    'browser_cookie_list',
    'browser_cookie_set',
    'browser_cookie_delete',
    'browser_cookie_clear',
    'browser_localstorage_get',
    'browser_localstorage_set',
    'browser_localstorage_clear',
    'browser_localstorage_delete',
    'browser_localstorage_list',
    'browser_sessionstorage_get',
    'browser_sessionstorage_set',
    'browser_sessionstorage_clear',
    'browser_sessionstorage_delete',
    'browser_sessionstorage_list',
    'browser_storage_state',
    'browser_set_storage_state',
  ] as const,
  testing: [
    'browser_generate_locator',
    'browser_verify_element_visible',
    'browser_verify_text_visible',
    'browser_verify_list_visible',
    'browser_verify_value',
  ] as const,
  vision: [
    'browser_mouse_click_xy',
    'browser_mouse_drag_xy',
    'browser_mouse_move_xy',
    'browser_mouse_down',
    'browser_mouse_up',
    'browser_mouse_wheel',
  ] as const,
  pdf: ['browser_pdf_save'] as const,
  devtools: [
    'browser_console_messages',
    'browser_console_clear',
    'browser_start_tracing',
    'browser_stop_tracing',
    'browser_start_video',
    'browser_stop_video',
    'browser_video_chapter',
    'browser_video_hide_actions',
    'browser_video_show_actions',
  ] as const,
  config: ['browser_get_config'] as const,
};

export const ALL_MCP_CAPABILITIES: readonly McpCapability[] = [
  'core',
  'network',
  'storage',
  'testing',
  'vision',
  'pdf',
  'devtools',
  'config',
] as const;

/**
 * Capabilities the installed @playwright/mcp CLI (0.0.80) accepts in `--caps`.
 * core/network/storage/testing/config are base/default capabilities in 0.0.80
 * and cannot be toggled via the CLI — they remain in the logical manifest and in
 * profile definitions, but only these additive values may be passed to --caps.
 */
export const PLAYWRIGHT_MCP_CLI_ADDITIVE_CAPABILITIES: readonly McpCapability[] = [
  'vision',
  'pdf',
  'devtools',
] as const;

export function isValidCapability(cap: string): cap is McpCapability {
  return (ALL_MCP_CAPABILITIES as readonly string[]).includes(cap);
}

export function getCapabilityTools(capability: McpCapability): readonly string[] {
  return PLAYWRIGHT_MCP_CAPABILITY_MANIFEST[capability] ?? [];
}

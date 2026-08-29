/**
 * AUTO-SYNCED from src/contracts/semantic-catalog.ts — do not edit by hand.
 * Run: npm run sync:mcp-generated  (also runs inside npm run mcp:build)
 */

/**
 * Semantic UI Discovery Types (W3C WAI-ARIA APG & Modern SaaS)
 */

export interface SemanticTable {
  name: string;
  headers: string[];
  sampleRow?: Record<string, string>;
  rowActions: string[];
  totalRowsObserved?: number;
  hasExpandableRows?: boolean;
}

export interface SemanticTreegrid {
  name: string;
  headers: string[];
  expandedRowsCount: number;
}

export interface SemanticTreeView {
  name: string;
  rootNodes: string[];
  totalItems: number;
}

export interface SemanticKanbanBoard {
  title?: string;
  columns: Array<{ name: string; cardCount: number }>;
}

export interface SemanticRadioGroup {
  label: string;
  options: string[];
  selectedOption?: string;
}

export interface SemanticToggleSwitch {
  label: string;
  checked: boolean;
}

export interface SemanticSlider {
  label: string;
  min?: number;
  max?: number;
  step?: number;
  value?: number;
}

export interface SemanticSpinbutton {
  label: string;
  value?: number;
  min?: number;
  max?: number;
}

export interface SemanticBreadcrumb {
  items: string[];
  current: string;
}

export interface SemanticPagination {
  currentPage?: number;
  totalPages?: number;
  pageSizeOptions?: string[];
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface SemanticAccordion {
  title: string;
  expanded: boolean;
}

export interface SemanticActionMenu {
  triggerLabel: string;
  menuItems: string[];
}

export interface SemanticCommandPalette {
  placeholder?: string;
  shortcut?: string;
}

export interface SemanticChart {
  title?: string;
  chartType: 'bar' | 'line' | 'pie' | 'donut' | 'area' | 'unknown';
  legends: string[];
}

export interface SemanticProgressBar {
  label?: string;
  valueNow?: number;
  valueMin?: number;
  valueMax?: number;
  percentage?: number;
}

export interface SemanticStatCard {
  title: string;
  value: string;
  description?: string;
  trend?: string;
}

export interface SemanticTab {
  label: string;
  active: boolean;
  panelSummary?: string;
}

export interface SemanticStepper {
  steps: string[];
  currentStepIndex: number;
  currentStepLabel?: string;
}

export interface SemanticFormInput {
  label: string;
  type: 'textbox' | 'combobox' | 'checkbox' | 'radio' | 'textarea' | 'date' | 'unknown';
  placeholder?: string;
  required?: boolean;
  defaultValue?: string;
  options?: string[];
}

export interface SemanticUploadDropzone {
  label: string;
  acceptedFormats?: string[];
  maxSizeBytes?: number;
}

export interface SemanticModalOrDrawer {
  triggerLabel: string;
  type: 'modal' | 'drawer' | 'dialog';
  title?: string;
  ariaPath?: string;
  formInputsCount?: number;
}

export interface SemanticRbacSignal {
  actionLabel: string;
  disabled: boolean;
  tooltipOrReason?: string;
}

export interface SemanticAlertOrToast {
  text: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

export interface SemanticSubRoute {
  label: string;
  targetUrl: string;
  routePattern: string; // e.g. /invoices/:id/edit
  isSampleOnly?: boolean;
}

export interface SemanticCatalog {
  schemaVersion: 'qa.semantic-catalog/v1';
  url: string;
  role?: string;
  capturedAt: string;
  tables: SemanticTable[];
  treegrids: SemanticTreegrid[];
  treeViews: SemanticTreeView[];
  kanbanBoards: SemanticKanbanBoard[];
  radioGroups: SemanticRadioGroup[];
  toggleSwitches: SemanticToggleSwitch[];
  sliders: SemanticSlider[];
  spinbuttons: SemanticSpinbutton[];
  breadcrumbs: SemanticBreadcrumb[];
  paginations: SemanticPagination[];
  accordions: SemanticAccordion[];
  actionMenus: SemanticActionMenu[];
  commandPalettes: SemanticCommandPalette[];
  charts: SemanticChart[];
  progressBars: SemanticProgressBar[];
  statCards: SemanticStatCard[];
  tabs: SemanticTab[];
  steppers: SemanticStepper[];
  forms: SemanticFormInput[];
  uploadDropzones: SemanticUploadDropzone[];
  modalsAndDrawers: SemanticModalOrDrawer[];
  rbacSignals: SemanticRbacSignal[];
  alertsAndToasts: SemanticAlertOrToast[];
  subRoutes: SemanticSubRoute[];
}

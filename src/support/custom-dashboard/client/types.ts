export interface DashboardClientState {
  qRaw: string;
  q: string;
  status: string;
  priority: string;
  role: string;
  module: string;
  feature: string;
  evidence: boolean;
  quickFilter?: string;
}

export type DashboardActionName =
  | 'open-save-modal'
  | 'close-save-modal'
  | 'open-edit-modal'
  | 'close-edit-modal'
  | 'open-delete-modal'
  | 'close-delete-modal'
  | 'open-inspection-drawer'
  | 'close-inspection-drawer'
  | 'switch-drawer-tab'
  | 'copy-failure-packet'
  | 'copy-failure-context'
  | 'toggle-view'
  | 'reset-filters'
  | 'apply-quick-filter'
  | 'theme-toggle';

export interface DashboardClientState {
  qRaw: string;
  q: string;
  status: string;
  priority: string;
  role: string;
  module: string;
  feature: string;
  evidence: boolean;
}

export type DashboardActionName =
  | 'open-save-modal'
  | 'close-save-modal'
  | 'open-edit-modal'
  | 'close-edit-modal'
  | 'open-delete-modal'
  | 'close-delete-modal'
  | 'copy-failure-packet'
  | 'toggle-view'
  | 'reset-filters'
  | 'theme-toggle';

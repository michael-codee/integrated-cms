export interface Question { key: string; label: string; help?: string; required?: boolean }
export interface ReportTemplate { id: string; code: string; name: string; description: string; frequency: 'monthly' | 'quarterly' | 'annual'; unit_types: string[]; due_days: number; questions: Question[]; is_active: boolean }

export interface Figures {
  membership?: { active_members: number; new_members: number; baptisms: number };
  attendance?: { average_sunday: number; sundays_recorded: number; total: number; first_timers: number; new_converts: number };
  finance?: { income: string; expenditure: string; net: string };
  programs?: { held: number; salvations: number; baptisms: number };
  sub_units?: { expected: number; reported: number };
}

export type ReportStatus = 'draft' | 'submitted' | 'approved' | 'returned';

export interface Report {
  id: string; template: string; template_name: string; frequency: string; org_unit: string; org_unit_name: string;
  period_start: string; period_end: string; period_label: string; due_date: string; status: ReportStatus;
  figures: Figures; answers: Record<string, string>; submitted_at: string | null; submitted_by_name: string | null;
  reviewed_at: string | null; reviewed_by_name: string | null; review_comment: string; can_review: boolean; version: number; created_at: string;
}

export interface DueReport { template: string; template_name: string; org_unit: string; org_unit_name: string; period_start: string; period_end: string; period_label: string; due: string; overdue: boolean; submission: string | null; status: string }

export interface ComplianceRow { org_unit: string; org_unit_name: string; unit_type: string; parent_name: string; status: 'missing' | ReportStatus; submission: string | null; submitted_at: string | null; submitted_late: boolean; overdue: boolean }
export interface Compliance {
  template: { id: string; name: string; frequency: string };
  period: { start: string; end: string; label: string; due: string };
  expected: number; counts: Record<string, number>; rate: number | null; on_time_rate: number | null;
  rows: ComplianceRow[]; periods: { start: string; label: string }[];
}

export const REPORT_STATUS: Record<string, string> = { missing: 'Not started', draft: 'Draft', submitted: 'Submitted', approved: 'Accepted', returned: 'Returned' };

export interface Program {
  id: string;
  title: string;
  category: string;
  category_name: string;
  org_unit: string;
  org_unit_name: string;
  department: string | null;
  department_name: string | null;
  description: string;
  venue: string;
  starts_at: string;
  ends_at: string;
  coordinator: string;
  speakers: string;
  expected_attendance: number | null;
  budget_amount: string;
  status: ProgramStatus;
  is_public: boolean;
  report_summary: string;
  salvations: number | null;
  baptisms: number | null;
  follow_up_notes: string;
  created_by_name: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_comment: string;
  attendance_total: number;
  can_decide: boolean;
  version: number;
  created_at: string;
}

export type ProgramStatus = 'planned' | 'pending_approval' | 'approved' | 'completed' | 'postponed' | 'cancelled';

export const PROGRAM_STATUSES: [ProgramStatus, string][] = [
  ['planned', 'Planned'], ['pending_approval', 'Awaiting approval'], ['approved', 'Approved'],
  ['completed', 'Completed'], ['postponed', 'Postponed'], ['cancelled', 'Cancelled'],
];

export const programStatusLabel = (s: string) => PROGRAM_STATUSES.find(([v]) => v === s)?.[1] || s;

export interface Department {
  id: string;
  org_unit: string;
  org_unit_name: string;
  name: string;
  kind: string;
  description: string;
  leader: string | null;
  leader_name: string;
  leader_display: string;
  meeting_schedule: string;
  is_active: boolean;
  member_count: number;
  created_at: string;
}

export const DEPARTMENT_KINDS: [string, string][] = [
  ['youth', 'Youth ministry'], ['women', "Women's ministry"], ['men', "Men's ministry"], ['children', 'Children / Sunday school'],
  ['worship', 'Choir / worship'], ['evangelism', 'Evangelism & missions'], ['prayer', 'Prayer ministry'],
  ['ushering', 'Ushering & protocol'], ['media', 'Media & technical'], ['welfare', 'Welfare & benevolence'], ['other', 'Other'],
];

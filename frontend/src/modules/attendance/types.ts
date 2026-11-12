export interface AttendanceRecord {
  id: string;
  org_unit: string;
  org_unit_name: string;
  service_type: string;
  service_type_name: string;
  program: string | null;
  program_title: string | null;
  department: string | null;
  department_name: string | null;
  date: string;
  men: number;
  women: number;
  boys: number;
  girls: number;
  visitors: number;
  first_timers: number;
  new_converts: number;
  total: number;
  is_individual: boolean;
  present_member_ids: { id: string; full_name: string; membership_no: string; gender: string }[] | null;
  notes: string;
  recorded_by: string | null;
  version: number;
  is_demo: boolean;
  created_at: string;
}

export interface AttendanceStats {
  average_sunday: number;
  gatherings: number;
  total_attendance: number;
  first_timers: number;
  new_converts: number;
  visitors: number;
  weekly: { week: string; sunday: number }[];
  by_service_type: { name: string; average: number; gatherings: number }[];
  by_branch: { id: string; name: string; average: number; sundays: number; members: number; ratio: number | null }[];
  composition: { label: string; count: number }[];
}

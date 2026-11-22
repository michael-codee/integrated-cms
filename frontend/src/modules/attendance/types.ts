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
  /** By ministry category. */
  men: number;
  women: number;
  children: number;
  youth: number;
  young_adults: number;
  /** By gender: the same people, so male + female equals the total. */
  male: number;
  female: number;
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
  weekly: { week: string; sunday: number; tuesday: number; friday: number }[];
  by_service_type: { name: string; average: number; gatherings: number }[];
  by_branch: { id: string; name: string; average: number; sundays: number; members: number; ratio: number | null }[];
  composition: { label: string; count: number }[];
  gender: { label: string; count: number }[];
  by_weekly_service: WeeklyServiceStats[];
}

export interface WeeklyServiceStats {
  key: 'sunday' | 'tuesday' | 'friday';
  name: string;
  average: number;
  gatherings: number;
  ministry: Record<MinistryKey, number>;
  gender: Record<GenderKey, number>;
}

export const MINISTRIES = [['men', 'Men'], ['women', 'Women'], ['children', 'Children'], ['youth', 'Youth'], ['young_adults', 'Young adults']] as const;
export const GENDERS = [['male', 'Male'], ['female', 'Female']] as const;
export type MinistryKey = (typeof MINISTRIES)[number][0];
export type GenderKey = (typeof GENDERS)[number][0];

/** The church's three weekly services, by service-type code and the day of the week they are held (0 = Sunday). */
export const WEEKLY_SERVICES = [
  { code: 'sunday-service', key: 'sunday', day: 0 },
  { code: 'tuesday-bible-study', key: 'tuesday', day: 2 },
  { code: 'friday-prayer-deliverance', key: 'friday', day: 5 },
] as const;

export interface Member {
  id: string;
  membership_no: string | null;
  first_name: string;
  middle_name: string;
  last_name: string;
  full_name: string;
  gender: 'male' | 'female';
  date_of_birth: string | null;
  age: number | null;
  phone: string;
  email: string;
  address: string;
  org_unit: string;
  org_unit_name: string;
  joined_on: string;
  previous_affiliation: string;
  category: string | null;
  category_name: string | null;
  status: 'active' | 'inactive' | 'deceased' | 'withdrawn';
  baptism_status: 'baptized' | 'not_baptized';
  baptism_date: string | null;
  baptism_location: string;
  marital_status: string;
  occupation: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  photo: string | null;
  photo_consent: boolean;
  exit_date: string | null;
  exit_reason: string;
  notes: string;
  is_demo: boolean;
  version: number;
  pending_transfer: { id: string; to_unit_name: string } | null;
  _sync?: string;
}

export interface Transfer {
  id: string; member: string; member_name: string; membership_no: string; org_unit: string; from_unit_name: string; to_unit: string;
  to_unit_name: string; reason: string; effective_date: string; status: string; requested_by: string | null; decided_by_name: string | null;
  decided_at: string | null; decision_note: string; created_at: string; can_decide: boolean;
}

export interface MemberStats {
  total: number; active: number; inactive: number; deceased: number; withdrawn: number; baptized: number;
  new_this_month: number; new_this_year: number; male: number; female: number; transfers_this_year: number;
  growth_rate_month: number | null; growth_rate_year: number | null;
  by_gender: { label: string; count: number }[]; by_age_group: { label: string; count: number }[];
  by_category: { label: string; count: number }[];
  by_branch: { id: string; name: string; code: string; count: number }[];
  by_district: { id: string; name: string; count: number }[]; by_region: { id: string; name: string; count: number }[];
  growth: { month: string; new: number; exits: number; total: number }[];
  baptisms_by_month: { month: string; count: number }[];
}

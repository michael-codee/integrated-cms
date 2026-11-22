export interface Assignment {
  id: string;
  role: string;
  role_name: string;
  role_code: string;
  role_level: number;
  org_unit: string;
  org_unit_name: string;
  org_unit_type: string;
  department_id: string | null;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
}

export interface Me {
  id: string;
  username: string;
  email: string;
  full_name: string;
  title: string;
  phone: string;
  status: string;
  must_change_password: boolean;
  last_login: string | null;
  assignments: Assignment[];
  permissions: string[];
}

export interface OrgUnit {
  id: string;
  code: string;
  name: string;
  /** Code of a StructureLevel defined by the administrator (headquarters, region, district, branch…). */
  unit_type: string;
  unit_type_display?: string;
  parent: string | null;
  parent_name?: string | null;
  path: string;
  depth: number;
  status: 'active' | 'inactive' | 'planned';
  established_on: string | null;
  country: string;
  province: string;
  civil_district: string;
  chiefdom: string;
  town: string;
  address: string;
  latitude: string | null;
  longitude: string | null;
  phone: string;
  email: string;
  notes: string;
  lineage?: { id: string; name: string; unit_type: string }[];
  children_count?: number;
  version?: number;
}

export interface Lookup {
  id: string;
  code: string;
  name: string;
  description: string;
  is_active: boolean;
  sort_order: number;
  kind?: 'income' | 'expense';
  [k: string]: unknown;
}

export interface StructureLevel {
  id: string;
  code: string;
  name: string;
  plural_name: string;
  rank: number;
  code_prefix: string;
  holds_members: boolean;
  icon: string;
  description: string;
  is_active: boolean;
  is_system: boolean;
  unit_count: number;
}

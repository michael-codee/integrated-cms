import type { Assignment } from '@/app/types';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  full_name: string;
  title: string;
  phone: string;
  status: 'active' | 'suspended' | 'deactivated';
  status_reason: string;
  must_change_password: boolean;
  last_login: string | null;
  created_at: string;
  is_locked: boolean;
  assignments: Assignment[];
}

export interface Role {
  id: string;
  code: string;
  name: string;
  level: number;
  description: string;
  is_system: boolean;
  is_active: boolean;
  permissions: string[];
  assignment_count: number;
}

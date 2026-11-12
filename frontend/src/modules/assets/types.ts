export type Condition = 'new' | 'good' | 'fair' | 'poor' | 'unserviceable';
export type AssetStatus = 'active' | 'maintenance' | 'idle' | 'disposed' | 'lost';

export interface AssetListItem {
  id: string; asset_no: string; name: string; category: string; category_name: string; org_unit: string; org_unit_name: string;
  location: string; custodian: string; condition: Condition; status: AssetStatus; cost: string; currency: string; book_value: string;
  acquisition_date: string | null; version: number; is_demo: boolean;
}

export interface Asset extends AssetListItem {
  description: string; serial_number: string; registration_no: string; title_document_no: string; size_description: string;
  acquisition_method: string; funding_source: string; supplier: string; depreciation_rate: string | null; effective_rate: string;
  warranty_expiry: string | null; insurance_expiry: string | null; insurance_details: string; photo: string | null; document: string | null;
  disposed_on: string | null; notes: string; created_at: string; updated_at: string;
  pending_movement: { id: string; to_unit_name: string; reason: string; can_decide: boolean } | null;
  pending_disposal: { id: string; method: string; reason: string; can_decide: boolean } | null;
  last_maintenance: { date: string; kind: string; next_due_date: string | null } | null;
}

export interface Movement { id: string; asset: string; asset_name: string; asset_no: string; from_unit_name: string; to_unit_name: string; reason: string; status: string; requested_by: string; decided_by_name: string | null; decided_at: string | null; comment: string; can_decide: boolean; created_at: string }
export interface Maintenance { id: string; asset: string; kind: string; date: string; description: string; provider: string; cost: string; condition_after: string; next_due_date: string | null; recorded_by: string | null }
export interface Disposal { id: string; asset: string; asset_name: string; asset_no: string; org_unit_name: string; method: string; reason: string; proposed_date: string; proceeds: string; book_value_at_request: string; status: string; requested_by: string; decided_by_name: string | null; comment: string; can_decide: boolean; created_at: string }

export interface AssetSummary {
  count: number; total_cost: string; book_value: string; disposed: number; insurance_expiring: number; needs_attention: number;
  by_category: { category: string; count: number; cost: string; book_value: string }[];
  by_condition: { condition: Condition; label: string; count: number }[];
  by_unit: { org_unit__name: string; count: number; cost: string }[];
  maintenance_due: { asset: string; asset_no: string; name: string; due: string; overdue: boolean }[];
}

export const CONDITIONS: [Condition, string][] = [['new', 'New'], ['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['unserviceable', 'Unserviceable']];
export const STATUSES: [AssetStatus, string][] = [['active', 'In use'], ['maintenance', 'Under maintenance'], ['idle', 'Not in use / stored'], ['disposed', 'Disposed'], ['lost', 'Lost / stolen']];
export const ACQUISITION: [string, string][] = [['purchase', 'Purchase'], ['donation', 'Donation / gift'], ['construction', 'Construction'], ['transfer', 'Transfer from another body'], ['other', 'Other']];
export const MAINT_KINDS: [string, string][] = [['routine', 'Routine service'], ['repair', 'Repair'], ['inspection', 'Inspection'], ['upgrade', 'Upgrade / renovation']];
export const DISPOSAL_METHODS: [string, string][] = [['sale', 'Sale'], ['donation', 'Donation'], ['scrap', 'Scrapped'], ['write_off', 'Written off'], ['lost', 'Lost / stolen']];
export const statusLabel = (s: string) => STATUSES.find(([v]) => v === s)?.[1] || s;

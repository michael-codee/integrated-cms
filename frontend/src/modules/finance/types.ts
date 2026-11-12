export type TxnKind = 'income' | 'expense';
export type TxnStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'reversed';

export interface Step { order: number; level: string; label: string }

export interface TxnListItem {
  id: string; reference: string | null; kind: TxnKind; org_unit: string; org_unit_name: string; account_name: string;
  category: string; category_name: string; amount: string; currency: string; transaction_date: string; party: string;
  member_name: string | null; status: TxnStatus; current_step: number; required_steps: Step[]; reversal_of: string | null;
  version: number; is_demo: boolean; sync_state?: string;
}

export interface Approval { id: string; step: number; step_label: string; decision: 'submitted' | 'approved' | 'rejected' | 'returned'; comment: string; by: string; created_at: string }

export interface Txn extends TxnListItem {
  account: string; financial_year_name: string; method: string; member: string | null; member_no: string | null;
  program_ref: string; description: string; external_ref: string; attachment: string | null;
  next_step: (Step & { index: number; total: number; unit_name: string }) | null; submitted_at: string | null;
  submitted_by_name: string | null; approved_at: string | null; created_by_name: string | null; created_at: string;
  reversal_of_reference: string | null; reversed_by: { id: string; reference: string; status: TxnStatus } | null;
  approvals: Approval[]; can_approve: boolean;
}

export interface Account {
  id: string; org_unit: string; org_unit_name: string; name: string; kind: 'cash' | 'bank' | 'mobile_money';
  institution: string; account_number: string; currency: string; opening_balance: string; opening_date: string;
  is_active: boolean; notes: string; balance: string;
}

export interface Reconciliation { id: string; account: string; account_name: string; org_unit_name: string; as_of: string; statement_balance: string; book_balance: string; difference: string; notes: string; by: string; created_at: string }

export interface BudgetLine { id?: string; category: string; category_name?: string; kind?: TxnKind; amount: string; notes?: string }
export interface Budget {
  id: string; org_unit: string; org_unit_name: string; financial_year: string; financial_year_name: string; name: string;
  currency: string; status: 'draft' | 'submitted' | 'approved' | 'rejected'; notes: string; lines: BudgetLine[];
  total_income: string; total_expense: string; submitted_at: string | null; submitted_by_name: string | null;
  decided_at: string | null; decided_by_name: string | null; decision_comment: string; can_decide: boolean; created_at: string;
}
export interface BudgetPerformance { category: string; category_name: string; kind: TxnKind; budget: string; actual: string; variance: string; percent: number | null }

export interface Policy {
  id: string; name: string; applies_to: 'income' | 'expense' | 'reversal'; unit_type: string; min_amount: string; max_amount: string | null;
  currency: string; priority: number; is_active: boolean; description: string; steps: Step[];
}

export interface FinanceSummary {
  period: { from: string; to: string }; financial_year: string | null;
  totals: { income: string; expense: string; net: string };
  by_category: { kind: TxnKind; category__name: string; total: string }[];
  by_month: { month: string; income: string | number; expense: string | number }[];
  by_unit: { id: string; name: string; unit_type: string; income: string; expense: string; net: string }[];
  pending: { count: number; amount: string | number };
  accounts: { id: string; name: string; org_unit_name: string; currency: string; kind: string; balance: string }[];
}

export const STATUS_LABEL: Record<TxnStatus, string> = {
  draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected', reversed: 'Reversed',
};
export const METHODS: [string, string][] = [['cash', 'Cash'], ['bank_transfer', 'Bank transfer'], ['mobile_money', 'Mobile money'], ['cheque', 'Cheque'], ['other', 'Other']];
export const ACCOUNT_KINDS: [string, string][] = [['cash', 'Cash'], ['bank', 'Bank account'], ['mobile_money', 'Mobile money']];
export const LEVELS: [string, string][] = [['unit', 'Own unit (e.g. Pastor-in-Charge)'], ['district', 'District'], ['region', 'Region'], ['headquarters', 'Headquarters']];

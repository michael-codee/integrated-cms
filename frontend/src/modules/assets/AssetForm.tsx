import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { uuid } from '@/lib/device';
import { submitChange } from '@/offline/repository';
import { useOnline } from '@/lib/useOnline';
import { Button, Field, FormError, FormGrid, Input, Modal, Select, Textarea, useToast } from '@/components/ui';
import { UnitSelect } from '@/components/UnitSelect';
import { useLookup } from '@/lib/queries';
import { today } from '@/lib/format';
import { ACQUISITION, CONDITIONS, STATUSES, type Asset } from './types';

const FIELDS = ['name', 'category', 'org_unit', 'description', 'serial_number', 'registration_no', 'title_document_no', 'size_description', 'acquisition_date', 'acquisition_method', 'cost', 'funding_source', 'supplier', 'location', 'custodian', 'condition', 'status', 'depreciation_rate', 'warranty_expiry', 'insurance_expiry', 'insurance_details', 'notes'] as const;
type F = Record<(typeof FIELDS)[number], string>;
const NULLABLE = ['acquisition_date', 'depreciation_rate', 'warranty_expiry', 'insurance_expiry'];

export function AssetForm({ asset, onClose, onSaved }: { asset?: Asset | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const online = useOnline();
  const toast = useToast();
  const qc = useQueryClient();
  const cats = useLookup('asset-categories');
  const blank = Object.fromEntries(FIELDS.map((k) => [k, ''])) as F;
  const [f, setF] = useState<F>({ ...blank, acquisition_method: 'purchase', condition: 'good', status: 'active', cost: '0', acquisition_date: today() });
  const [photo, setPhoto] = useState<File | null>(null);
  const [document, setDocument] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (asset) setF(Object.fromEntries(FIELDS.map((k) => [k, (asset as unknown as Record<string, unknown>)[k] == null ? '' : String((asset as unknown as Record<string, unknown>)[k])])) as F);
  }, [asset]);
  const set = (k: keyof F, v: string) => setF((p) => ({ ...p, [k]: v }));
  const cat = cats.data?.find((c) => c.id === f.category);
  const code = cat?.code || '';
  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.name.trim()) e.name = 'Name the asset.';
    if (!f.category) e.category = 'Choose a category.';
    if (!asset && !f.org_unit) e.org_unit = 'Choose the unit that holds the asset.';
    if ((photo?.size || 0) > 5 * 1024 * 1024 || (document?.size || 0) > 10 * 1024 * 1024) e.form = 'Files are too large (photos 5 MB, documents 10 MB).';
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    const body: Record<string, unknown> = {};
    FIELDS.forEach((k) => { body[k] = f[k] === '' && NULLABLE.includes(k) ? null : f[k]; });
    if (asset) delete body.org_unit;
    try {
      let id = asset?.id || uuid();
      if (photo || document) {
        const fd = new FormData();
        Object.entries(body).forEach(([k, v]) => v !== null && fd.append(k, String(v)));
        if (photo) fd.append('photo', photo);
        if (document) fd.append('document', document);
        const r = await api<Asset>(asset ? `/assets/${asset.id}/` : '/assets/', { method: asset ? 'PATCH' : 'POST', body: fd });
        id = r.id;
        toast.success(asset ? 'Asset updated.' : `Registered as ${r.asset_no}.`);
      } else {
        const res = await submitChange<Asset>({
          entity: 'assets', op: asset ? 'update' : 'create', method: asset ? 'PATCH' : 'POST', url: asset ? `/assets/${id}/` : '/assets/',
          body: asset ? body : { ...body, id, client_created_at: new Date().toISOString() }, recordId: id, baseVersion: asset?.version,
          label: `${asset ? 'Update' : 'Register'} asset ${f.name}`,
        });
        if (res.state === 'queued') toast.offline('Saved on this device. The asset number is issued when it uploads.');
        else toast.success(asset ? 'Asset updated.' : `Registered as ${res.data.asset_no}.`);
      }
      qc.invalidateQueries({ queryKey: ['assets'] });
      onSaved?.(id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors, form: Object.keys(err.fieldErrors).length ? 'Please correct the highlighted fields.' : err.message });
      else setErrors({ form: (err as Error).message });
    } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="xl" title={asset ? `Edit ${asset.asset_no}` : 'Register an asset'} subtitle="Buildings, land, vehicles, equipment and other church property"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>{asset ? 'Save changes' : 'Register asset'}</Button></>}>
      <FormError message={errors.form} />
      <FormGrid cols={3}>
        <Field label="Asset name" required error={errors.name}><Input value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Generator 15kVA" /></Field>
        <Field label="Category" required error={errors.category}>
          <Select value={f.category} onChange={(e) => set('category', e.target.value)} invalid={!!errors.category}>
            <option value="">Choose category</option>{(cats.data || []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        {!asset ? <Field label="Held by unit" required error={errors.org_unit}><UnitSelect value={f.org_unit} onChange={(v) => set('org_unit', v)} placeholder="Choose unit" /></Field>
          : <Field label="Status" error={errors.status}><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{STATUSES.filter(([v]) => v !== 'disposed' && v !== 'lost').map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}
        <Field label="Location"><Input value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. Church premises, store room" /></Field>
        <Field label="Custodian (person responsible)"><Input value={f.custodian} onChange={(e) => set('custodian', e.target.value)} /></Field>
        <Field label="Condition"><Select value={f.condition} onChange={(e) => set('condition', e.target.value)}>{CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Acquired on" error={errors.acquisition_date}><Input type="date" max={today()} value={f.acquisition_date} onChange={(e) => set('acquisition_date', e.target.value)} /></Field>
        <Field label="How acquired"><Select value={f.acquisition_method} onChange={(e) => set('acquisition_method', e.target.value)}>{ACQUISITION.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Cost or value (SLE)" error={errors.cost}><Input type="number" min="0" step="0.01" value={f.cost} onChange={(e) => set('cost', e.target.value)} /></Field>
        <Field label="Funding source"><Input value={f.funding_source} onChange={(e) => set('funding_source', e.target.value)} /></Field>
        <Field label="Supplier / donor"><Input value={f.supplier} onChange={(e) => set('supplier', e.target.value)} /></Field>
        <Field label="Depreciation % per year" hint={cat ? `Blank uses the category default (${(cat as { default_depreciation_rate?: string }).default_depreciation_rate ?? 0}%)` : undefined} error={errors.depreciation_rate}>
          <Input type="number" min="0" max="100" step="0.5" value={f.depreciation_rate} onChange={(e) => set('depreciation_rate', e.target.value)} />
        </Field>
        <Field label="Serial number"><Input value={f.serial_number} onChange={(e) => set('serial_number', e.target.value)} /></Field>
        {(code === 'vehicles' || f.registration_no) && <Field label="Registration number"><Input value={f.registration_no} onChange={(e) => set('registration_no', e.target.value)} /></Field>}
        {(['land-property', 'church-buildings', 'residential-pastorage'].includes(code) || f.title_document_no) && <>
          <Field label="Title / survey / deed reference"><Input value={f.title_document_no} onChange={(e) => set('title_document_no', e.target.value)} /></Field>
          <Field label="Size"><Input value={f.size_description} onChange={(e) => set('size_description', e.target.value)} placeholder="e.g. 1 town lot" /></Field>
        </>}
        <Field label="Warranty expires" error={errors.warranty_expiry}><Input type="date" value={f.warranty_expiry} onChange={(e) => set('warranty_expiry', e.target.value)} /></Field>
        <Field label="Insurance expires"><Input type="date" value={f.insurance_expiry} onChange={(e) => set('insurance_expiry', e.target.value)} /></Field>
        <Field label="Insurance details"><Input value={f.insurance_details} onChange={(e) => set('insurance_details', e.target.value)} /></Field>
        <Field label="Photograph" hint={online ? 'JPG, PNG or WebP up to 5 MB' : 'Uploading needs internet'}><Input type="file" accept="image/jpeg,image/png,image/webp" disabled={!online} onChange={(e) => setPhoto(e.target.files?.[0] || null)} /></Field>
        <Field label="Ownership / purchase document" hint={online ? 'PDF or image up to 10 MB' : 'Uploading needs internet'}><Input type="file" accept=".pdf,image/*" disabled={!online} onChange={(e) => setDocument(e.target.files?.[0] || null)} /></Field>
      </FormGrid>
      <FormGrid cols={2}>
        <Field label="Description" className="mt-4"><Textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Notes" className="mt-4"><Textarea rows={2} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
      </FormGrid>
    </Modal>
  );
}

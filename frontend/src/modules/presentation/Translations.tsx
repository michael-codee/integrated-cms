import { useState } from 'react';
import { BookOpen, Trash2, Upload } from 'lucide-react';
import { Button, Field, FormError, FormGrid, Input, Modal, Select, useToast } from '@/components/ui';
import { BUILT_IN } from './bible';
import {
  deleteImportedBible, LICENSED, MAX_BIBLE_FILE, parseBible, saveImportedBible, useTranslations, type ParsedBible,
} from './bibleImport';

/**
 * Bible translations on this computer: the public-domain ones built in, and licensed ones the
 * media team imports from the ministry's own copy. Imported text stays in this browser.
 */
export function TranslationsDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { imported } = useTranslations();
  const [importing, setImporting] = useState(false);
  if (importing) return <ImportDialog onClose={() => setImporting(false)} />;
  const remove = async (id: string, short: string) => {
    if (!window.confirm(`Remove ${short} from this computer? Orders of service that use it will show an error until it is imported again.`)) return;
    await deleteImportedBible(id);
    toast.success(`${short} removed from this computer.`);
  };
  return (
    <Modal open onClose={onClose} title="Bible translations" subtitle="Choose the translation for each order of service under Look, or for one passage when you add it."
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button icon={<Upload className="h-4 w-4" />} onClick={() => setImporting(true)}>Import a licensed translation</Button></>}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Built in (public domain)</p>
      <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-700">
        {BUILT_IN.map((t) => (
          <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <BookOpen className="h-4 w-4 shrink-0 text-royal-600" />
            <span className="w-12 font-semibold">{t.short}</span>
            <span className="min-w-0 flex-1 truncate">{t.name}</span>
          </li>
        ))}
      </ul>
      <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Imported on this computer (licensed)</p>
      {!imported.length && (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
          None yet. Translations such as the NIV, NKJV or ESV belong to their publishers and cannot be built into the app. Import the ministry's licensed copy from a file on each media computer.
        </p>
      )}
      {!!imported.length && (
        <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200 dark:divide-slate-800 dark:ring-slate-700">
          {imported.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <BookOpen className="h-4 w-4 shrink-0 text-gold-500" />
              <span className="w-12 font-semibold">{t.short}</span>
              <span className="min-w-0 flex-1 truncate">{t.name}<span className="ml-2 text-xs text-slate-500">{t.verses.toLocaleString()} verses</span></span>
              <button type="button" className="rounded p-1 text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40" aria-label={`Remove ${t.short}`} title="Remove from this computer" onClick={() => remove(t.id, t.short)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [choice, setChoice] = useState(LICENSED[0].short);
  const [short, setShort] = useState('');
  const [name, setName] = useState('');
  const [parsed, setParsed] = useState<ParsedBible | null>(null);
  const [fileName, setFileName] = useState('');
  const [licensed, setLicensed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const known = LICENSED.find((l) => l.short === choice);
  const code = known ? known.short : short.trim().toUpperCase();
  const fullName = known ? known.name : name.trim();

  const readFile = async (f: File | undefined) => {
    setParsed(null);
    setError('');
    if (!f) return;
    setFileName(f.name);
    if (f.size > MAX_BIBLE_FILE) { setError('This file is larger than 40 MB. A whole Bible as text is usually 4–10 MB.'); return; }
    try {
      setParsed(parseBible(await f.text(), f.name));
    } catch (e) { setError((e as Error).message); }
  };
  const save = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      await saveImportedBible(code, fullName, parsed);
      toast.success(`${code} imported on this computer.`);
      onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Import a licensed translation" size="lg"
      subtitle="The text stays on this computer. It is never uploaded or shown to anyone outside the screens."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!parsed || !licensed || !code} onClick={save}>Import {code}</Button></>}>
      <FormError message={error} />
      <FormGrid>
        <Field label="Translation">
          <Select value={choice} onChange={(e) => setChoice(e.target.value)}>
            {LICENSED.map((l) => <option key={l.short} value={l.short}>{l.short} · {l.name}</option>)}
            <option value="">Another translation…</option>
          </Select>
        </Field>
        {!known && <Field label="Short name" required hint="2 to 12 letters, e.g. NASB"><Input value={short} onChange={(e) => setShort(e.target.value)} maxLength={12} /></Field>}
        {!known && <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>}
        <Field label="File" hint="JSON, CSV or text with book, chapter, verse and text, e.g. one verse per line: John 3:16 For God so loved…">
          <input type="file" accept=".json,.csv,.tsv,.txt,application/json,text/plain,text/csv" onChange={(e) => readFile(e.target.files?.[0])}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-royal-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-royal-800 dark:file:bg-slate-800 dark:file:text-slate-200" />
        </Field>
      </FormGrid>
      {parsed && (
        <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <b>{fileName}</b>: {parsed.verses.toLocaleString()} verses in {parsed.bookCount} of 66 books.
          {parsed.bookCount < 66 && ' Books that are missing will say so when chosen.'}
          {!!parsed.unknownBooks.length && <span className="block text-amber-800 dark:text-amber-200">Not recognised and left out: {parsed.unknownBooks.join(', ')}</span>}
        </div>
      )}
      <label className="mt-4 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={licensed} onChange={(e) => setLicensed(e.target.checked)} />
        <span>
          The ministry holds a licence{known ? ` from ${known.holder}` : ' from the publisher'} (or a church copyright licence that covers it) to show {code || 'this translation'} on screens in our services.
        </span>
      </label>
    </Modal>
  );
}

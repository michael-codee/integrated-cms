export interface SongSummary {
  id: string;
  title: string;
  alternate_title: string;
  author: string;
  language: string;
  song_key: string;
  tags: string;
  first_line: string;
}

export interface Song extends Omit<SongSummary, 'first_line'> {
  copyright: string;
  lyrics: string;
  updated_at?: string;
}

export interface MediaImage {
  id: string;
  title: string;
  kind: 'background' | 'slide';
  image: string;
}

export type PlanItem =
  | { kind: 'song'; key: string; song: string; label?: string }
  | { kind: 'scripture'; key: string; ref: string; label?: string }
  | { kind: 'text'; key: string; title: string; body: string; label?: string }
  | { kind: 'image'; key: string; image: string; label?: string }
  | { kind: 'blank'; key: string; label?: string };

export interface Theme {
  preset?: string;
  background_image?: string | null;
  font_scale?: number;
  align?: 'center' | 'left';
  show_reference?: boolean;
  uppercase?: boolean;
}

export interface ServicePlan {
  id: string;
  org_unit: string;
  org_unit_name: string;
  title: string;
  service_date: string;
  service_type: string | null;
  service_type_name: string;
  items: PlanItem[];
  item_count: number;
  theme: Theme;
  notes: string;
}

/** One screenful. */
export interface Slide {
  kind: 'song' | 'scripture' | 'text' | 'image' | 'blank';
  /** Section name, e.g. "Chorus", shown on the control desk only. */
  label?: string;
  heading?: string;
  lines: string[];
  /** Small caption at the bottom of the screen: the song title or the Bible reference. */
  footer?: string;
  /** Picture slides: the library picture id. */
  image?: string;
}

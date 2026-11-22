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

/** Every item can carry notes for the preacher; they show on the stage display only. */
interface ItemBase { key: string; label?: string; notes?: string }

export type PlanItem = ItemBase & (
  | { kind: 'song'; song: string }
  | { kind: 'scripture'; ref: string }
  | { kind: 'text'; title: string; body: string }
  | { kind: 'image'; image: string }
  /** A video kept on the media computer: its local id, and the file name to find it on another computer. */
  | { kind: 'video'; video: string; name: string; loop?: boolean }
  /** The live camera or HDMI capture feed chosen on this computer. */
  | { kind: 'camera' }
  | { kind: 'blank' }
);

export interface Theme {
  preset?: string;
  background_image?: string | null;
  /** A looping video behind the words: local id plus file name (videos stay on the media computer). */
  background_video?: string | null;
  background_video_name?: string;
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
  kind: 'song' | 'scripture' | 'text' | 'image' | 'video' | 'camera' | 'blank';
  /** Section name, e.g. "Chorus", shown on the control desk only. */
  label?: string;
  heading?: string;
  lines: string[];
  /** Small caption at the bottom of the screen: the song title or the Bible reference. */
  footer?: string;
  /** Picture slides: the library picture id. */
  image?: string;
  /** Video slides: the local video id and whether it repeats. */
  video?: string;
  loop?: boolean;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * DoStuff network MCP.
 *
 * Curated "things to do" / events for major US metros, from the DoStuff Media
 * network (DoNYC, Do312, Do617, etc.). Each metro exposes a keyless per-day
 * JSON feed at https://<host>.com/events/YYYY/M/D.json with structured events
 * (title, category, start/end times, venue, artists, is_free, popularity).
 */


// DoStuff returns 403 to non-browser User-Agents, so present a standard browser UA.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** friendly slug → { host subdomain, display name } */
const METROS: Record<string, { host: string; name: string }> = {
  nyc: { host: 'donyc', name: 'New York City' },
  chicago: { host: 'do312', name: 'Chicago' },
  boston: { host: 'do617', name: 'Boston' },
  austin: { host: 'do512', name: 'Austin' },
  'san-antonio': { host: 'do210', name: 'San Antonio' },
  'sf-bay': { host: 'dothebay', name: 'San Francisco Bay Area' },
};

const MAX_DAYS = 7;

const tools: McpToolExport['tools'] = [
  {
    name: 'metros',
    description: 'List the metros DoStuff covers (slug + name). Pass a slug to the events tool.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'events',
    description:
      'Curated things-to-do / events for a DoStuff metro. Defaults to today; pass `date` and/or `days` to cover a window (e.g. a weekend). Optionally filter by category (music, art, performing-arts, comedy, food-drink, other-fun-deals) and free-only. Sorted by start time.',
    inputSchema: {
      type: 'object',
      properties: {
        metro: { type: 'string', description: 'Metro slug: nyc, chicago, boston, austin, san-antonio, sf-bay. Use the metros tool to list.' },
        date: { type: 'string', description: 'Start date YYYY-MM-DD (default: today, US Eastern).' },
        days: { type: 'number', description: 'How many days from the start date to include (1-7, default 1). Use 3 for a weekend.' },
        category: { type: 'string', description: 'Filter by category, e.g. "music", "art", "comedy", "performing-arts", "food-drink".' },
        free_only: { type: 'boolean', description: 'If true, only return free events.' },
        limit: { type: 'number', description: 'Max events to return (1-200, default 50).' },
      },
      required: ['metro'],
    },
  },
];

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'metros':
      return { count: Object.keys(METROS).length, metros: Object.entries(METROS).map(([slug, m]) => ({ slug, name: m.name })) };
    case 'events':
      return getEvents(args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function getEvents(args: Record<string, unknown>): Promise<unknown> {
  const slug = String(args.metro ?? '').toLowerCase().trim();
  const metro = METROS[slug];
  if (!metro) throw new Error(`Unknown metro "${args.metro}". Valid: ${Object.keys(METROS).join(', ')}.`);

  const start = parseDate(args.date) ?? todayET();
  const days = clamp(numArg(args.days, 1), 1, MAX_DAYS);
  const limit = clamp(numArg(args.limit, 50), 1, 200);
  const category = typeof args.category === 'string' ? args.category.trim().toLowerCase() : '';
  const freeOnly = args.free_only === true;

  // Fetch each day's feed (deduping events that span multiple days).
  const seen = new Set<number>();
  const all: NormalizedEvent[] = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(start, i);
    const url = `https://${metro.host}.com/events/${d.y}/${d.m}/${d.d}.json`;
    let feed: DoStuffFeed;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
      if (!res.ok) continue;
      feed = (await res.json()) as DoStuffFeed;
    } catch {
      continue;
    }
    for (const e of feed.events ?? []) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      if (category && (e.category_param ?? '').toLowerCase() !== category) continue;
      if (freeOnly && !e.is_free) continue;
      all.push(normalize(e, metro.host));
    }
  }

  all.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return {
    metro: metro.name,
    metro_slug: slug,
    source: `${metro.host}.com`,
    date_from: `${start.y}-${pad(start.m)}-${pad(start.d)}`,
    days,
    total_matching: all.length,
    count: Math.min(all.length, limit),
    events: all.slice(0, limit),
  };
}

interface DoStuffVenue { title?: string; full_address?: string; address?: string; city?: string; state?: string; latitude?: number | null; longitude?: number | null }
interface DoStuffArtist { name?: string }
interface DoStuffEvent {
  id: number;
  permalink?: string;
  title?: string;
  excerpt?: string;
  category_param?: string;
  begin_time?: string;
  end_time?: string;
  begin_date?: string;
  end_date?: string;
  is_free?: boolean;
  is_ongoing?: boolean;
  votes?: number;
  popularity?: number;
  sold_out?: boolean;
  buy_url?: string | null;
  venue?: DoStuffVenue;
  artists?: DoStuffArtist[];
}
interface DoStuffFeed { events?: DoStuffEvent[] }
interface NormalizedEvent { start: string | undefined; [k: string]: unknown }

function normalize(e: DoStuffEvent, host: string): NormalizedEvent {
  const v = e.venue;
  const venue = v
    ? { name: v.title, address: v.full_address || v.address || [v.city, v.state].filter(Boolean).join(', ') || undefined, latitude: v.latitude ?? undefined, longitude: v.longitude ?? undefined }
    : undefined;
  return {
    id: e.id,
    title: e.title,
    category: e.category_param,
    start: e.begin_time,
    end: e.end_time || undefined,
    begin_date: e.begin_date,
    end_date: e.end_date !== e.begin_date ? e.end_date : undefined,
    is_free: Boolean(e.is_free),
    is_ongoing: Boolean(e.is_ongoing),
    sold_out: Boolean(e.sold_out),
    popularity: e.votes ?? e.popularity,
    venue,
    artists: (e.artists ?? []).map((a) => a.name).filter(Boolean),
    summary: e.excerpt?.replace(/\s+/g, ' ').trim(),
    url: e.permalink ? `https://${host}.com${e.permalink}` : undefined,
    buy_url: e.buy_url || undefined,
  };
}

interface YMD { y: number; m: number; d: number }
function todayET(): YMD {
  // Approximate US Eastern (UTC-4/5); good enough for picking the day's feed.
  const now = new Date(Date.now() - 4 * 3600 * 1000);
  return { y: now.getUTCFullYear(), m: now.getUTCMonth() + 1, d: now.getUTCDate() };
}
function parseDate(v: unknown): YMD | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
function addDays(base: YMD, n: number): YMD {
  const dt = new Date(Date.UTC(base.y, base.m - 1, base.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function numArg(v: unknown, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : dflt;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;

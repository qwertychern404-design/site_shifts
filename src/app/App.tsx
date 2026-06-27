import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Search,
  RefreshCw,
  Zap,
  ChevronLeft,
  ChevronRight as Next,
  RotateCcw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// Types

interface DayData {
  posts: number;
  deleted: number;
  start: string;
  end: string;
  karma: number;
  karmaGrowth: number;
}

interface Account {
  id: string;
  username: string;
  banned: boolean;
  days: (DayData | null)[];
}

interface CRMModel {
  id: string;
  name: string;
  shifts: number[];
  accounts: Account[];
}

interface Worker {
  id: string;
  name: string;
  color: string;
  models: CRMModel[];
  deleted?: boolean;
}

type ShiftsMap = Record<string, number>;

// Static data

const DAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SHIFT_OPTS = [0, 0.5, 1, 1.5, 2];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function makeDay(active = true): DayData | null {
  if (!active) return null;
  const h = 7 + Math.floor(Math.random() * 5);
  const dur = 7 + Math.floor(Math.random() * 4);
  return {
    posts: 4 + Math.floor(Math.random() * 16),
    deleted: Math.floor(Math.random() * 4),
    start: `${pad(h)}:00`,
    end: `${pad(Math.min(h + dur, 23))}:00`,
    karma: 8000 + Math.floor(Math.random() * 72000),
    karmaGrowth: -200 + Math.floor(Math.random() * 2700),
  };
}

function acct(username: string, banned = false): Account {
  return {
    id: username,
    username,
    banned,
    days: Array.from({ length: 7 }, () => makeDay(Math.random() > 0.07)),
  };
}

// Helper: создаёт N аккаунтов с именами account_1, account_2, ...
// bannedIndex (1-based) — номер аккаунта, который должен быть в бане
function accts(count: number, bannedIndex?: number): Account[] {
  return Array.from({ length: count }, (_, i) =>
    acct(`u/account_${i + 1}`, bannedIndex === i + 1)
  );
}

const DATA: Worker[] = [
  {
    id: "oleg", name: "Oleg", color: "#6366f1",
    models: [
      { id: "oleg_isabella", name: "Isabella", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(2) },
      { id: "oleg_missy", name: "Missy", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(2) },
      { id: "oleg_ren", name: "Ren", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(1) },
    ],
  },
  {
    id: "slava", name: "Slava", color: "#f59e0b",
    models: [
      { id: "slava_mimi", name: "Mimi", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(2) },
      { id: "slava_kumi", name: "Kumi", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(3) },
    ],
  },
  {
    id: "sofia", name: "Sofia", color: "#10b981",
    models: [
      { id: "sofia_juno", name: "Juno", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(2) },
      { id: "sofia_hazel", name: "Hazel", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(3) },
      { id: "sofia_blake", name: "Blake", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(2, 1) },
    ],
  },
  {
    id: "dima", name: "Dima", color: "#3b82f6",
    models: [
      { id: "dima_coco", name: "Coco", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(3) },
    ],
  },
  {
    id: "vasia", name: "Vasia", color: "#06b6d4",
    models: [
      { id: "vasia_kitty", name: "Kitty", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(3) },
    ],
  },
  {
    id: "yaroslav", name: "Yaroslav", color: "#ec4899",
    models: [
      { id: "yaroslav_ariana", name: "Ariana", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(3) },
      { id: "yaroslav_maddie", name: "Maddie", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(2) },
    ],
  },
  {
    id: "nastia", name: "Nastia", color: "#8b5cf6", deleted: true,
    models: [
      { id: "nastia_ruby", name: "Ruby", shifts: [0, 0, 0, 0, 0, 0, 0], accounts: accts(2) },
    ],
  },
];

// Aggregation helpers

function minT(a: string, b: string) { return a < b ? a : b; }
function maxT(a: string, b: string) { return a > b ? a : b; }

// autoShift — maps post counts to shift values
// 0 posts       → 0 shifts
// 1–15 posts    → 0.5 shifts
// 16–35 posts   → 1 shift
// 36–55 posts   → 1.5 shifts
// 56+ posts     → 2 shifts
function autoShift(posts: number): number {
  if (posts === 0) return 0;
  if (posts <= 15) return 0.5;
  if (posts <= 35) return 1;
  if (posts <= 55) return 1.5;
  return 2;
}

// Compute auto shift value for a model+day from its accounts' actual posts
function modelDayAutoShift(model: CRMModel, d: number): number {
  const days = model.accounts.map(a => a.days[d]).filter(Boolean) as DayData[];
  const totalPosts = days.reduce((s, x) => s + x.posts, 0);
  return autoShift(totalPosts);
}

function modelDayAgg(model: CRMModel, d: number, shifts: ShiftsMap) {
  const days = model.accounts.map(a => a.days[d]).filter(Boolean) as DayData[];
  if (!days.length) return null;
  return {
    posts: days.reduce((s, x) => s + x.posts, 0),
    deleted: days.reduce((s, x) => s + x.deleted, 0),
    start: days.reduce((s, x) => minT(s, x.start), days[0].start),
    end: days.reduce((s, x) => maxT(s, x.end), days[0].end),
    shift: shifts[`${model.id}_${d}`] !== undefined
      ? shifts[`${model.id}_${d}`]
      : modelDayAutoShift(model, d),
  };
}

function workerDayAgg(worker: Worker, d: number, shifts: ShiftsMap) {
  const days = worker.models.flatMap(m => m.accounts.map(a => a.days[d]).filter(Boolean)) as DayData[];
  if (!days.length) return null;
  return {
    posts: days.reduce((s, x) => s + x.posts, 0),
    deleted: days.reduce((s, x) => s + x.deleted, 0),
    start: days.reduce((s, x) => minT(s, x.start), days[0].start),
    end: days.reduce((s, x) => maxT(s, x.end), days[0].end),
    totalShifts: worker.models.reduce((s, m) => {
      const val = shifts[`${m.id}_${d}`] !== undefined
        ? shifts[`${m.id}_${d}`]
        : modelDayAutoShift(m, d);
      return s + val;
    }, 0),
  };
}

function modelWeekShifts(model: CRMModel, shifts: ShiftsMap) {
  return DAYS_SHORT.reduce((s, _, d) => {
    const val = shifts[`${model.id}_${d}`] !== undefined
      ? shifts[`${model.id}_${d}`]
      : modelDayAutoShift(model, d);
    return s + val;
  }, 0);
}

function workerWeekShifts(worker: Worker, shifts: ShiftsMap) {
  return worker.models.reduce((s, m) => s + modelWeekShifts(m, shifts), 0);
}

function weekLabel(week: number) {
  const base = new Date(2026, 5, 22);
  const off = (week - 26) * 7;
  const start = new Date(base.getTime() + off * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const fmtDay = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return { label: `${fmtDay(start)} — ${fmt(end)}`, start, end };
}

function weekDates(week: number) {
  const base = new Date(2026, 5, 22);
  const off = (week - 26) * 7;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getTime() + (off + i) * 86400000);
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  });
}

// Column layout
const W1 = 156;
const W2 = 148;
const W3 = 76;
const FIXED_MIN = W1 + W2 + W3;

// Row heights
const RH_WORKER = 44;
const RH_MODEL  = 38;
const RH_ACCT   = 34;

// Border tokens
const BORDER_CELL  = "#E8E8F0";
const BORDER_HEAVY = "#D2D2E0";
const BG_WORKER    = "#F7F7FA";
const BG_MODEL     = "#FFFFFF";

function stickyStyle(left: number, bg: string, zIndex = 10) {
  return { position: "sticky" as const, left, zIndex, backgroundColor: bg };
}

// Sub-components

function PostsBadge({ n, banned }: { n: number; banned?: boolean }) {
  return (
    <span className={`inline-flex items-center justify-center min-w-[22px] px-1.5 py-px rounded text-[11px] font-semibold tabular-nums leading-none ${banned ? "bg-red-50 text-red-500" : "bg-indigo-50 text-indigo-700"}`}>
      {n}
    </span>
  );
}

function DeletedBadge({ n }: { n: number }) {
  if (!n) return <span className="w-[22px]" />;
  return (
    <span className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-px rounded text-[11px] font-medium tabular-nums bg-red-50 text-red-500 leading-none">
      {n}
    </span>
  );
}

interface TimeHover { x: number; y: number; start: string; end: string; }

function TimeTooltip({ tip }: { tip: TimeHover }) {
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ left: tip.x, top: tip.y - 8, transform: "translate(-50%, -100%)" }}
    >
      <div className="bg-[#18182A] text-white rounded-lg shadow-xl px-2.5 py-1.5 border border-[#2A2A40]">
        <span className="text-[11px] tabular-nums" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {tip.start} – {tip.end}
        </span>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{ borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid #18182A" }}
      />
    </div>
  );
}

function ShiftBadge({ value, color }: { value: number; color?: string }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded text-[11px] font-semibold tabular-nums bg-[#F0F0F8] text-[#BCBCCC] leading-none">
        0
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded text-[11px] font-bold tabular-nums leading-none"
      style={{
        backgroundColor: color ? `${color}18` : "#EEF0FC",
        color: color ?? "#5E6AD2",
      }}
    >
      {value}
    </span>
  );
}

function ShiftSelect({
  value,
  onChange,
  onClick,
}: {
  value: number;
  onChange: (v: number) => void;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="relative shrink-0" onClick={onClick}>
      <select
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="text-[11px] border border-[#DDE0F0] rounded px-1.5 py-0.5 bg-white text-[#5E6AD2] font-semibold cursor-pointer appearance-none pr-4 focus:outline-none focus:ring-1 focus:ring-[#5E6AD2] focus:border-[#5E6AD2] h-6"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {SHIFT_OPTS.map(o => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown size={9} className="absolute right-1 top-1/2 -translate-y-1/2 text-[#5E6AD2] pointer-events-none" />
    </div>
  );
}

interface TooltipState {
  x: number;
  y: number;
  data: DayData;
  username: string;
  banned: boolean;
}

function Tooltip({ tip }: { tip: TooltipState }) {
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{ left: tip.x, top: tip.y - 12, transform: "translate(-50%, -100%)" }}
    >
      <div className="bg-[#18182A] text-white rounded-xl shadow-2xl px-3.5 py-3 min-w-[172px] border border-[#2A2A40]">
        <div className="text-[10px] text-[#8888BB] mb-2 truncate" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {tip.username}
        </div>
        <div className="flex items-baseline gap-1.5 mb-1.5">
          <span className="text-[11px] text-[#6666AA]">Karma</span>
          <span className="text-sm font-semibold tabular-nums">{tip.data.karma.toLocaleString()}</span>
          <span className={`text-[11px] font-medium tabular-nums ${tip.data.karmaGrowth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            ({tip.data.karmaGrowth >= 0 ? "+" : ""}{tip.data.karmaGrowth.toLocaleString()})
          </span>
          {tip.data.karmaGrowth >= 0
            ? <TrendingUp size={11} className="text-emerald-400 shrink-0" />
            : <TrendingDown size={11} className="text-red-400 shrink-0" />}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[#6666AA]">Status</span>
          {tip.banned ? (
            <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded font-semibold tracking-wide">BANNED</span>
          ) : (
            <span className="px-1.5 py-0.5 text-[10px] bg-emerald-500/20 text-emerald-400 rounded font-semibold tracking-wide">ACTIVE</span>
          )}
        </div>
        <div className="mt-2 text-[10px] text-[#555577]" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
          {tip.data.start} → {tip.data.end}
        </div>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{ borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "6px solid #18182A" }}
      />
    </div>
  );
}

// Main App

export default function App() {
  // По умолчанию всё свёрнуто
  const [expandedWorkers, setExpandedWorkers] = useState<Set<string>>(new Set());
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(26);
  const [workerFilter, setWorkerFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const [timeHover, setTimeHover] = useState<TimeHover | null>(null);

  // shifts stores ONLY manual overrides — auto values are computed on the fly
  const [shifts, setShifts] = useState<ShiftsMap>({});

  const toggleWorker = useCallback((id: string) => {
    setExpandedWorkers(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const toggleModel = useCallback((id: string) => {
    setExpandedModels(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const setShift = useCallback((modelId: string, d: number, val: number) => {
    setShifts(p => ({ ...p, [`${modelId}_${d}`]: val }));
  }, []);

  const expandAllModels = () => {
    setExpandedWorkers(new Set(DATA.map(w => w.id)));
    setExpandedModels(new Set());
  };
  const collapseAllModels = () => { setExpandedWorkers(new Set()); setExpandedModels(new Set()); };
  const expandAllAccounts = () => {
    setExpandedWorkers(new Set(DATA.map(w => w.id)));
    setExpandedModels(new Set(DATA.flatMap(w => w.models.map(m => m.id))));
  };
  const collapseAllAccounts = () => setExpandedModels(new Set());

  const wkLabel = weekLabel(currentWeek);
  const wkDates = weekDates(currentWeek);
  const searchLower = search.toLowerCase();

  const filteredWorkers = DATA.filter(w => {
    if (!showDeleted && w.deleted) return false;
    if (workerFilter !== "all" && w.id !== workerFilter) return false;
    if (searchLower) {
      const matchWorker = w.name.toLowerCase().includes(searchLower);
      const matchModel = w.models.some(m =>
        m.name.toLowerCase().includes(searchLower) ||
        m.accounts.some(a => a.username.toLowerCase().includes(searchLower))
      );
      if (!matchWorker && !matchModel) return false;
    }
    return true;
  });

  const btnBase = "inline-flex items-center gap-1.5 px-2.5 h-7 text-xs text-[#444456] border border-[#E0E0EC] rounded-md bg-white hover:bg-[#F5F5FA] active:bg-[#EDEDF5] transition-colors whitespace-nowrap";
  const btnPrimary = "inline-flex items-center gap-1.5 px-2.5 h-7 text-xs font-medium text-white bg-[#5E6AD2] rounded-md hover:bg-[#5060C8] active:bg-[#4858C0] transition-colors shadow-sm whitespace-nowrap";

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-[#F4F4F8]" style={{ fontFamily: "'Inter', sans-serif" }}>

      {/* HEADER */}
      <div className="shrink-0 bg-white border-b border-[#E0E0EC]">

        {/* Top row */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-[#EAEAF2]">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-[14px] font-semibold text-[#0D0D18] tracking-tight">Shift Weeks Management</span>
              <span className="text-xs text-[#9898AA] ml-2">Reddit posting shifts</span>
            </div>
            <div className="w-px h-5 bg-[#E4E4EC]" />
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentWeek(w => w - 1)} className={btnBase}>
                <ChevronLeft size={12} />
                <span>Wk {currentWeek - 1}</span>
              </button>
              <div className="px-3 h-7 flex items-center text-xs font-medium text-[#0D0D18] bg-[#F0F0F8] rounded-md border border-[#E0E0EC] min-w-[196px] justify-center">
                {wkLabel.label}
              </div>
              <button onClick={() => setCurrentWeek(w => w + 1)} className={btnBase}>
                <span>Wk {currentWeek + 1}</span>
                <Next size={12} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button className={btnBase}><RefreshCw size={11} className="text-[#999]" />Rebuild snapshot</button>
            <button className={btnBase}><Zap size={11} className="text-[#999]" />Generate week</button>
            <button className={btnPrimary}><RotateCcw size={11} />Regenerate week</button>
            <div className="w-px h-5 bg-[#E4E4EC] mx-1" />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-[#6E6E82] whitespace-nowrap">Show deleted</span>
              <button
                onClick={() => setShowDeleted(p => !p)}
                className="relative rounded-full transition-colors duration-200 shrink-0"
                style={{ width: 32, height: 18, backgroundColor: showDeleted ? "#5E6AD2" : "#C8C8D6" }}
              >
                <span
                  className="absolute top-[2px] left-[2px] bg-white rounded-full shadow-sm transition-transform duration-200"
                  style={{ width: 14, height: 14, transform: showDeleted ? "translateX(14px)" : "translateX(0)" }}
                />
              </button>
            </label>
          </div>
        </div>

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-5 h-10 gap-3">
          <div className="flex items-center gap-1">
            <button onClick={expandAllModels} className={btnBase}>Expand models</button>
            <button onClick={collapseAllModels} className={btnBase}>Collapse models</button>
            <button onClick={expandAllAccounts} className={btnBase}>Expand accounts</button>
            <button onClick={collapseAllAccounts} className={btnBase}>Collapse accounts</button>
            <div className="w-px h-4 bg-[#E4E4EC] mx-1" />
            <div className="relative">
              <select value={workerFilter} onChange={e => setWorkerFilter(e.target.value)} className="pl-2.5 pr-6 h-7 text-xs text-[#444456] border border-[#E0E0EC] rounded-md bg-white hover:bg-[#F5F5FA] appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#5E6AD2]">
                <option value="all">All workers</option>
                {DATA.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
            </div>
            <div className="relative">
              <select value={modelFilter} onChange={e => setModelFilter(e.target.value)} className="pl-2.5 pr-6 h-7 text-xs text-[#444456] border border-[#E0E0EC] rounded-md bg-white hover:bg-[#F5F5FA] appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-[#5E6AD2]">
                <option value="all">All models</option>
                {DATA.flatMap(w => w.models.map(m => <option key={m.id} value={m.id}>{m.name} ({w.name})</option>))}
              </select>
              <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[#999] pointer-events-none" />
            </div>
          </div>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#BCBCCC]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="pl-7 pr-3 h-7 text-xs border border-[#E0E0EC] rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-[#5E6AD2] focus:border-[#5E6AD2] w-44 placeholder:text-[#BCBCCC]"
            />
          </div>
        </div>
      </div>

      {/* TABLE AREA */}
      <div className="flex-1 overflow-auto">
        <table
          style={{
            width: "100%",
            minWidth: FIXED_MIN + 7 * 120,
            tableLayout: "fixed",
            borderCollapse: "separate",
            borderSpacing: 0,
          }}
        >
          <colgroup>
            <col style={{ width: W1 }} />
            <col style={{ width: W2 }} />
            <col style={{ width: W3 }} />
            {DAYS_SHORT.map((_, i) => <col key={i} />)}
          </colgroup>

          {/* Table Header */}
          <thead>
            <tr>
              <th
                className="text-left text-[10px] font-semibold text-[#9898AA] uppercase tracking-widest px-4 border-b border-[#E0E0EC] border-r border-[#E8E8F0] bg-white"
                style={{ position: "sticky", top: 0, left: 0, zIndex: 32, height: 36 }}
              >
                Worker
              </th>
              <th
                className="text-left text-[10px] font-semibold text-[#9898AA] uppercase tracking-widest px-3 border-b border-[#E0E0EC] border-r border-[#E8E8F0] bg-white"
                style={{ position: "sticky", top: 0, left: W1, zIndex: 32, height: 36 }}
              >
                Model
              </th>
              <th
                className="text-center text-[10px] font-semibold text-[#9898AA] uppercase tracking-widest px-2 border-b border-[#E0E0EC] border-r border-[#E8E8F0] bg-white"
                style={{ position: "sticky", top: 0, left: W1 + W2, zIndex: 32, height: 36 }}
              >
                Shifts
              </th>
              {DAYS_SHORT.map((day, i) => (
                <th
                  key={i}
                  className="text-center px-3 border-b border-[#E0E0EC] border-r border-[#E8E8F0] last:border-r-0 bg-white"
                  style={{ position: "sticky", top: 0, zIndex: 29, height: 36 }}
                >
                  <div className="text-[11px] font-semibold text-[#0D0D18] leading-none">{day}</div>
                  <div className="text-[10px] font-normal text-[#BCBCCC] mt-0.5 leading-none">{wkDates[i]}</div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredWorkers.map((worker, wi) => {
              const isWorkerExpanded = expandedWorkers.has(worker.id);
              const wShifts = workerWeekShifts(worker, shifts);
              const visibleModels = worker.models.filter(m => modelFilter === "all" || m.id === modelFilter);

              return (
                <WorkerSection
                  key={worker.id}
                  worker={worker}
                  visibleModels={visibleModels}
                  isWorkerExpanded={isWorkerExpanded}
                  expandedModels={expandedModels}
                  isFirst={wi === 0}
                  wShifts={wShifts}
                  shifts={shifts}
                  onToggleWorker={toggleWorker}
                  onToggleModel={toggleModel}
                  onSetShift={setShift}
                  onTooltipEnter={(x, y, data, username, banned) => setTooltip({ x, y, data, username, banned })}
                  onTooltipLeave={() => setTooltip(null)}
                  onTimeHover={(x, y, start, end) => setTimeHover({ x, y, start, end })}
                  onTimeLeave={() => setTimeHover(null)}
                />
              );
            })}
          </tbody>
        </table>

        {filteredWorkers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-[#BCBCCC]">
            <Search size={22} className="mb-2 opacity-40" />
            <span className="text-sm">No workers match your filters</span>
          </div>
        )}
      </div>

      {tooltip && <Tooltip tip={tooltip} />}
      {timeHover && <TimeTooltip tip={timeHover} />}
    </div>
  );
}

// WorkerSection

interface WorkerSectionProps {
  worker: Worker;
  visibleModels: CRMModel[];
  isWorkerExpanded: boolean;
  expandedModels: Set<string>;
  isFirst: boolean;
  wShifts: number;
  shifts: ShiftsMap;
  onToggleWorker: (id: string) => void;
  onToggleModel: (id: string) => void;
  onSetShift: (modelId: string, d: number, val: number) => void;
  onTooltipEnter: (x: number, y: number, data: DayData, username: string, banned: boolean) => void;
  onTooltipLeave: () => void;
  onTimeHover: (x: number, y: number, start: string, end: string) => void;
  onTimeLeave: () => void;
}

function WorkerSection({
  worker, visibleModels, isWorkerExpanded, expandedModels,
  isFirst, wShifts, shifts,
  onToggleWorker, onToggleModel, onSetShift,
  onTooltipEnter, onTooltipLeave, onTimeHover, onTimeLeave,
}: WorkerSectionProps) {
  const topBorder = isFirst ? {} : { borderTop: `2px solid ${BORDER_HEAVY}` };

  return (
    <>
      {/* Worker row */}
      <tr
        className="group cursor-pointer"
        style={{ ...topBorder, backgroundColor: BG_WORKER }}
        onClick={() => onToggleWorker(worker.id)}
      >
        {/* Col 1: Worker name */}
        <td
          className="px-3 border-r border-[#E8E8F0] group-hover:bg-[#F0F0F8] transition-colors relative"
          style={{ ...stickyStyle(0, BG_WORKER), height: RH_WORKER }}
        >
          <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: worker.color }} />
          <div className="flex items-center gap-2 pl-1">
            <div className="w-4 h-4 flex items-center justify-center text-[#BCBCCC]">
              {isWorkerExpanded ? <ChevronDown size={13} strokeWidth={2.5} /> : <ChevronRight size={13} strokeWidth={2.5} />}
            </div>
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ backgroundColor: worker.color }}>
              {worker.name[0]}
            </div>
            <span className="text-[13px] font-semibold text-[#0D0D18] tracking-tight">{worker.name}</span>
            {worker.deleted && (
              <span className="px-1.5 py-px text-[10px] font-medium text-red-500 bg-red-50 rounded border border-red-100 leading-none">deleted</span>
            )}
          </div>
        </td>

        {/* Col 2: Model count */}
        <td
          className="px-3 border-r border-[#E8E8F0] group-hover:bg-[#F0F0F8] transition-colors"
          style={{ ...stickyStyle(W1, BG_WORKER), height: RH_WORKER }}
        >
          <span className="text-xs text-[#BCBCCC]">
            {worker.models.length} model{worker.models.length !== 1 ? "s" : ""}
          </span>
        </td>

        {/* Col 3: Total shifts */}
        <td
          className="px-2 text-center border-r border-[#E8E8F0] group-hover:bg-[#F0F0F8] transition-colors"
          style={{ ...stickyStyle(W1 + W2, BG_WORKER), height: RH_WORKER }}
        >
          <span className="text-[13px] font-bold text-[#0D0D18] tabular-nums">{wShifts}</span>
        </td>

        {/* Day cells */}
        {DAYS_SHORT.map((_, d) => {
          const s = workerDayAgg(worker, d, shifts);
          return (
            <td
              key={d}
              className="border-r border-[#E8E8F0] last:border-r-0 group-hover:bg-[#F0F0F8] transition-colors"
              style={{ height: RH_WORKER, backgroundColor: BG_WORKER }}
              onMouseEnter={s ? (e) => { const r = e.currentTarget.getBoundingClientRect(); onTimeHover(r.left + r.width / 2, r.top, s.start, s.end); } : undefined}
              onMouseLeave={s ? onTimeLeave : undefined}
            >
              <div className="flex items-center justify-between h-full px-3 gap-3">
                <div className="flex items-center gap-1.5">
                  {s ? (
                    <>
                      <PostsBadge n={s.posts} />
                      {s.deleted > 0 && <DeletedBadge n={s.deleted} />}
                    </>
                  ) : (
                    <span className="text-[#D8D8E4] text-sm">—</span>
                  )}
                </div>
                {s && <ShiftBadge value={s.totalShifts} color={worker.color} />}
              </div>
            </td>
          );
        })}
      </tr>

      {/* Model rows */}
      {isWorkerExpanded && visibleModels.map((model) => {
        const isModelExpanded = expandedModels.has(model.id);
        const mShifts = modelWeekShifts(model, shifts);
        return (
          <ModelSection
            key={model.id}
            model={model}
            worker={worker}
            isModelExpanded={isModelExpanded}
            mShifts={mShifts}
            shifts={shifts}
            onToggleModel={onToggleModel}
            onSetShift={onSetShift}
            onTooltipEnter={onTooltipEnter}
            onTooltipLeave={onTooltipLeave}
            onTimeHover={onTimeHover}
            onTimeLeave={onTimeLeave}
          />
        );
      })}
    </>
  );
}

// ModelSection

interface ModelSectionProps {
  model: CRMModel;
  worker: Worker;
  isModelExpanded: boolean;
  mShifts: number;
  shifts: ShiftsMap;
  onToggleModel: (id: string) => void;
  onSetShift: (modelId: string, d: number, val: number) => void;
  onTooltipEnter: (x: number, y: number, data: DayData, username: string, banned: boolean) => void;
  onTooltipLeave: () => void;
  onTimeHover: (x: number, y: number, start: string, end: string) => void;
  onTimeLeave: () => void;
}

function ModelSection({
  model, worker, isModelExpanded, mShifts, shifts,
  onToggleModel, onSetShift, onTooltipEnter, onTooltipLeave, onTimeHover, onTimeLeave,
}: ModelSectionProps) {
  return (
    <>
      {/* Model row */}
      <tr
        className="group cursor-pointer"
        style={{ borderTop: `1px solid ${BORDER_CELL}`, backgroundColor: BG_MODEL }}
        onClick={() => onToggleModel(model.id)}
      >
        {/* Col 1: accent line */}
        <td
          className="border-r border-[#E8E8F0] group-hover:bg-[#F8F8FC] transition-colors relative"
          style={{ ...stickyStyle(0, BG_MODEL), height: RH_MODEL }}
        >
          <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: worker.color, opacity: 0.25 }} />
        </td>

        {/* Col 2: Model name */}
        <td
          className="px-3 border-r border-[#E8E8F0] group-hover:bg-[#F8F8FC] transition-colors"
          style={{ ...stickyStyle(W1, BG_MODEL), height: RH_MODEL }}
        >
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 flex items-center justify-center text-[#BCBCCC] shrink-0">
              {isModelExpanded ? <ChevronDown size={11} strokeWidth={2.5} /> : <ChevronRight size={11} strokeWidth={2.5} />}
            </div>
            <span className="text-[12px] font-medium text-[#1A1A30]">{model.name}</span>
          </div>
        </td>

        {/* Col 3: Model shifts total */}
        <td
          className="px-2 text-center border-r border-[#E8E8F0] group-hover:bg-[#F8F8FC] transition-colors"
          style={{ ...stickyStyle(W1 + W2, BG_MODEL), height: RH_MODEL }}
        >
          <span className="text-[12px] font-semibold tabular-nums" style={{ color: worker.color }}>
            {mShifts}
          </span>
        </td>

        {/* Day cells — model level */}
        {DAYS_SHORT.map((_, d) => {
          const s = modelDayAgg(model, d, shifts);
          const shiftVal = shifts[`${model.id}_${d}`] !== undefined
            ? shifts[`${model.id}_${d}`]
            : modelDayAutoShift(model, d);
          return (
            <td
              key={d}
              className="border-r border-[#E8E8F0] last:border-r-0 group-hover:bg-[#F8F8FC] transition-colors"
              style={{ height: RH_MODEL }}
              onClick={e => e.stopPropagation()}
              onMouseEnter={s ? (e) => { const r = e.currentTarget.getBoundingClientRect(); onTimeHover(r.left + r.width / 2, r.top, s.start, s.end); } : undefined}
              onMouseLeave={s ? onTimeLeave : undefined}
            >
              <div className="flex items-center justify-between h-full px-3 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {s ? (
                    <>
                      <PostsBadge n={s.posts} />
                      {s.deleted > 0 && <DeletedBadge n={s.deleted} />}
                    </>
                  ) : null}
                </div>
                <ShiftSelect
                  value={shiftVal}
                  onChange={v => onSetShift(model.id, d, v)}
                  onClick={e => e.stopPropagation()}
                />
              </div>
            </td>
          );
        })}
      </tr>

      {/* Account rows */}
      {isModelExpanded && model.accounts.map((account) => {
        const isBanned = account.banned;
        const acctBg = isBanned ? "#FFF5F5" : "#FAFAFA";

        return (
          <tr
            key={account.id}
            style={{ borderTop: `1px solid ${BORDER_CELL}`, backgroundColor: acctBg }}
          >
            {/* Col 1: accent line */}
            <td className="border-r border-[#E8E8F0] relative" style={{ ...stickyStyle(0, acctBg), height: RH_ACCT }}>
              <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ backgroundColor: worker.color, opacity: 0.12 }} />
            </td>

            {/* Col 2: username */}
            <td className="px-3 border-r border-[#E8E8F0]" style={{ ...stickyStyle(W1, acctBg), height: RH_ACCT }}>
              <div className="flex items-center gap-1.5 pl-5">
                {isBanned && <AlertTriangle size={10} className="text-red-400 shrink-0" />}
                <span
                  className="text-[11px] font-medium truncate"
                  style={{ fontFamily: "'JetBrains Mono', monospace", color: isBanned ? "#EF4444" : "#3535A8" }}
                >
                  {account.username}
                </span>
                {isBanned && (
                  <span className="shrink-0 px-1.5 py-px text-[9px] font-bold tracking-wide bg-red-100 text-red-500 rounded border border-red-200 leading-none">BAN</span>
                )}
              </div>
            </td>

            {/* Col 3: empty */}
            <td className="border-r border-[#E8E8F0]" style={{ ...stickyStyle(W1 + W2, acctBg), height: RH_ACCT }} />

            {/* Day cells */}
            {account.days.map((day, d) => (
              <td
                key={d}
                className={`border-r border-[#E8E8F0] last:border-r-0 ${day ? "hover:bg-[#EBEBF6] cursor-default" : ""}`}
                style={{ height: RH_ACCT, backgroundColor: isBanned ? "#FFF5F5" : undefined }}
                onMouseEnter={day ? (e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  onTooltipEnter(rect.left + rect.width / 2, rect.top, day, account.username, account.banned);
                } : undefined}
                onMouseLeave={day ? onTooltipLeave : undefined}
              >
                {day ? (
                  <div
                    className="h-full flex items-center px-3"
                    style={{ display: "grid", gridTemplateColumns: "26px 26px 1fr", alignItems: "center", padding: "0 12px" }}
                  >
                    <span
                      className="text-[11px] font-semibold tabular-nums text-right"
                      style={{ color: isBanned ? "#EF4444" : "#4040B0" }}
                    >
                      {day.posts}
                    </span>
                    <span className="text-[11px] font-medium text-red-400 tabular-nums text-right">
                      {day.deleted > 0 ? day.deleted : ""}
                    </span>
                    <span
                      className="text-[10px] text-[#BCBCCC] pl-1.5 truncate"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {day.start}–{day.end}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-[#E0E0EA] text-[12px]">·</span>
                  </div>
                )}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

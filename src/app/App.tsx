import {
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Search,
  Settings,
  RefreshCw,
  Zap,
  ChevronLeft,
  ChevronRight as Next,
  RotateCcw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
} from "lucide-react";

// Types

interface DayData {
  posts: number;
  deleted: number;
  comments: number;
  start: string;
  end: string;
  karma: number;
  karmaGrowth: number;
}

type DayState = DayData | "banned" | null;

interface Account {
  id: string;
  username: string;
  banned: boolean;
  banFromDay?: number; // с какого дня (0-6) аккаунт считается забаненным
  days: DayState[];
}

interface CRMModel {
  id: string;
  name: string;
  shifts: number[];
  postRange: [number, number];
  zeroDay: number; // день (0-6), когда у модели суммарно 0 постов по всем аккаунтам
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

const DAYS_SHORT = [
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
  "Sun",
];
const SHIFT_OPTS = [0, 0.5, 1, 1.5, 2];

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function stripU(u: string) {
  return u.startsWith("u/") ? u.slice(2) : u;
}

// --- Реалистичное расписание смен ---
// Смена начинается не раньше 14:00, на каждый аккаунт уходит ~40 минут,
// аккаунты одного работника (по всем его моделям) идут строго по очереди —
// один человек не может вести два аккаунта параллельно.
// Максимум — 06:00 следующего дня.

const SHIFT_START_MIN = 14 * 60; // 14:00
const SHIFT_HARD_END_MIN = 30 * 60; // 06:00 следующего дня (24:00 + 6:00)
const SLOT_DURATION = 40; // минут на аккаунт
const SKIP_CHANCE = 0; // вероятность, что аккаунт сегодня не работал

function formatMinutes(totalMinutes: number) {
  const m = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

// Делит total постов между n аккаунтами случайным образом (сумма = total)
function splitTotalAmong(total: number, n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [total];
  const parts = new Array(n).fill(0);
  for (let i = 0; i < total; i++) {
    parts[Math.floor(Math.random() * n)]++;
  }
  return parts;
}

function makeAccountStats(posts: number) {
  return {
    posts,
    deleted: posts === 0 ? 0 : Math.floor(Math.random() * 4),
    comments: Math.floor(Math.random() * 5),
  };
}

function acct(username: string, banned = false): Account {
  // Если аккаунт забанен — выбираем день (2–5), начиная с которого он "banned"
  const banFromDay = banned
    ? 2 + Math.floor(Math.random() * 3)
    : undefined;
  return {
    id: username,
    username,
    banned,
    banFromDay,
    days: Array.from({ length: 7 }, () => null), // расписание назначается позже, в assignAllSchedules()
  };
}

// Создаёт count аккаунтов вида account_1, account_2, ...
// bannedIndex (1-based) — номер аккаунта, который должен быть в бане
function accts(count: number, bannedIndex?: number): Account[] {
  return Array.from({ length: count }, (_, i) =>
    acct(`u/account_${i + 1}`, bannedIndex === i + 1),
  );
}

// Назначает время каждому аккаунту работника на конкретный день,
// двигаясь по очереди и не допуская пересечений.
// Сумма постов считается на уровне модели (по диапазону модели) и
// распределяется между аккаунтами, которые реально работали в этот день.
function assignWorkerDaySchedule(worker: Worker, d: number) {
  // случайное начало смены: между 14:00 и 19:00
  let cursor =
    SHIFT_START_MIN + Math.floor(Math.random() * 6) * 60;

  for (const model of worker.models) {
    const [min, max] = model.postRange;
    const isZeroDay = d === model.zeroDay;

    // Сначала проходим по аккаунтам модели, назначаем время и
    // определяем, кто из них реально "работал" в этот день
    const activeAccounts: Account[] = [];
    const accountTimes: Record<
      string,
      { start: string; end: string }
    > = {};

    for (const account of model.accounts) {
      // аккаунт уже забанен на этот день — просто помечаем, время не тратим
      if (
        account.banned &&
        account.banFromDay !== undefined &&
        d >= account.banFromDay
      ) {
        account.days[d] = "banned";
        continue;
      }
      // время вышло за допустимое окно (до 06:00) — на сегодня смена окончена
      if (cursor + SLOT_DURATION > SHIFT_HARD_END_MIN) {
        account.days[d] = null;
        continue;
      }
      // аккаунт сегодня не работал
      if (Math.random() < SKIP_CHANCE) {
        account.days[d] = null;
        continue;
      }
      const start = cursor;
      const end = cursor + SLOT_DURATION;
      accountTimes[account.id] = {
        start: formatMinutes(start),
        end: formatMinutes(end),
      };
      activeAccounts.push(account);
      cursor = end; // следующий аккаунт начинается ровно когда закончился этот
    }

    // Общее число постов модели за день — из диапазона модели (или 0, если zeroDay)
    const totalPosts = isZeroDay
      ? 0
      : min + Math.floor(Math.random() * (max - min + 1));
    const splitPosts = splitTotalAmong(
      totalPosts,
      activeAccounts.length,
    );

    activeAccounts.forEach((account, i) => {
      const time = accountTimes[account.id];
      account.days[d] = {
        ...makeAccountStats(splitPosts[i]),
        karma: 0,
        karmaGrowth: 0,
        start: time.start,
        end: time.end,
      };
    });
  }
}

function assignAllSchedules(workers: Worker[]) {
  workers.forEach((worker) => {
    for (let d = 0; d < 7; d++)
      assignWorkerDaySchedule(worker, d);

    // Карма копится последовательно по дням, отдельно на каждом аккаунте:
    // понедельник 12000 → вторник +200 → среда +300 и т.д.
    // Рост только в дни, когда аккаунт реально работал (есть DayData)
    worker.models.forEach((model) => {
      model.accounts.forEach((account) => {
        let karma = 8000 + Math.floor(Math.random() * 12000); // стартовая база
        for (let d = 0; d < 7; d++) {
          const day = account.days[d];
          if (!day || day === "banned") continue;
          const growth = 100 + Math.floor(Math.random() * 901); // +100..+1000
          karma += growth;
          day.karma = karma;
          day.karmaGrowth = growth;
        }
      });
    });
  });
}

const DATA: Worker[] = [
  {
    id: "oleg",
    name: "Oleg",
    color: "#6366f1",
    models: [
      {
        id: "oleg_isabella",
        name: "Isabella",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [36, 50],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(2),
      },
      {
        id: "oleg_missy",
        name: "Missy",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [40, 47],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(2),
      },
      {
        id: "oleg_ren",
        name: "Ren",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [15, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(1),
      },
    ],
  },
  {
    id: "slava",
    name: "Slava",
    color: "#f59e0b",
    models: [
      {
        id: "slava_mimi",
        name: "Mimi",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [30, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(2),
      },
      {
        id: "slava_kumi",
        name: "Kumi",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [28, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(3),
      },
    ],
  },
  {
    id: "sofia",
    name: "Sofia",
    color: "#10b981",
    models: [
      {
        id: "sofia_juno",
        name: "Juno",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [30, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(2),
      },
      {
        id: "sofia_hazel",
        name: "Hazel",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [30, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(3),
      },
      {
        id: "sofia_blake",
        name: "Blake",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [40, 47],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(2, 1),
      },
    ],
  },
  {
    id: "dima",
    name: "Dima",
    color: "#3b82f6",
    models: [
      {
        id: "dima_coco",
        name: "Coco",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [56, 64],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(3),
      },
    ],
  },
  {
    id: "vasia",
    name: "Vasia",
    color: "#06b6d4",
    models: [
      {
        id: "vasia_kitty",
        name: "Kitty",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [30, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(3),
      },
    ],
  },
  {
    id: "yaroslav",
    name: "Yaroslav",
    color: "#ec4899",
    models: [
      {
        id: "yaroslav_ariana",
        name: "Ariana",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [40, 48],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(3),
      },
      {
        id: "yaroslav_maddie",
        name: "Maddie",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [30, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(2),
      },
    ],
  },
  {
    id: "nastia",
    name: "Nastia",
    color: "#8b5cf6",
    deleted: true,
    models: [
      {
        id: "nastia_ruby",
        name: "Ruby",
        shifts: [0, 0, 0, 0, 0, 0, 0],
        postRange: [14, 35],
        zeroDay: Math.floor(Math.random() * 7),
        accounts: accts(2),
      },
    ],
  },
];

// Назначаем реалистичное расписание (время, посты, карма) каждому работнику
assignAllSchedules(DATA);

const WORKER_META: Record<
  string,
  { role: string; addedDate: string; deletedDate?: string }
> = {
  oleg: {
    role: "Reddit Poster Velvet",
    addedDate: "2025-03-10",
  },
  slava: {
    role: "Reddit Assistant Velvet",
    addedDate: "2025-05-22",
  },
  sofia: {
    role: "Reddit Poster Velvet",
    addedDate: "2025-01-08",
  },
  dima: {
    role: "Reddit Poster Velvet",
    addedDate: "2025-06-01",
  },
  vasia: {
    role: "Reddit Poster Velvet",
    addedDate: "2025-07-14",
  },
  yaroslav: {
    role: "Reddit Poster Velvet",
    addedDate: "2025-04-30",
  },
  nastia: {
    role: "Reddit Poster Velvet",
    addedDate: "2025-02-18",
    deletedDate: "2026-05-03",
  },
};

// Post count color helpers

function postColorKey(posts: number): string {
  if (posts === 0) return "red";
  if (
    (posts >= 1 && posts <= 29) ||
    (posts >= 36 && posts <= 44) ||
    (posts >= 51 && posts <= 59)
  )
    return "yellow";
  if (posts >= 30 && posts <= 35) return "green";
  if (posts >= 45 && posts <= 50) return "blue";
  return "purple";
}

const POST_COLORS: Record<string, string> = {
  red: "#EF4444",
  yellow: "#EAB308",
  green: "#22C55E",
  blue: "#3B82F6",
  purple: "#A855F7",
};

function postBorderColor(posts: number): string {
  return POST_COLORS[postColorKey(posts)];
}

const MODEL_COLOR_OPTS = [
  { key: "ban", label: "Ban", color: "#DC2626" },
  { key: "red", label: "0 posts", color: "#EF4444" },
  {
    key: "yellow",
    label: "1–29, 36–44, 51–59 posts",
    color: "#EAB308",
  },
  { key: "green", label: "30–35 posts", color: "#22C55E" },
  { key: "blue", label: "45–50 posts", color: "#3B82F6" },
  { key: "purple", label: "60+ posts", color: "#A855F7" },
];

// Aggregation helpers — skip "banned" day entries

function isDayData(d: DayState): d is DayData {
  return d !== null && d !== "banned";
}

function minT(a: string, b: string) {
  return a < b ? a : b;
}
function maxT(a: string, b: string) {
  return a > b ? a : b;
}

function modelDayAgg(
  model: CRMModel,
  d: number,
  shifts: ShiftsMap,
) {
  const days = model.accounts
    .map((a) => a.days[d])
    .filter(isDayData) as DayData[];
  if (!days.length) return null;
  return {
    posts: days.reduce((s, x) => s + x.posts, 0),
    deleted: days.reduce((s, x) => s + x.deleted, 0),
    start: days.reduce(
      (s, x) => minT(s, x.start),
      days[0].start,
    ),
    end: days.reduce((s, x) => maxT(s, x.end), days[0].end),
    shift: shifts[`${model.id}_${d}`] ?? model.shifts[d],
  };
}

function workerDayAgg(
  worker: Worker,
  d: number,
  shifts: ShiftsMap,
) {
  const days = worker.models.flatMap((m) =>
    m.accounts.map((a) => a.days[d]).filter(isDayData),
  ) as DayData[];
  if (!days.length) return null;
  return {
    posts: days.reduce((s, x) => s + x.posts, 0),
    deleted: days.reduce((s, x) => s + x.deleted, 0),
    start: days.reduce(
      (s, x) => minT(s, x.start),
      days[0].start,
    ),
    end: days.reduce((s, x) => maxT(s, x.end), days[0].end),
    totalShifts: worker.models.reduce(
      (s, m) => s + (shifts[`${m.id}_${d}`] ?? m.shifts[d]),
      0,
    ),
  };
}

function modelWeekShifts(model: CRMModel, shifts: ShiftsMap) {
  return DAYS_SHORT.reduce(
    (s, _, d) =>
      s + (shifts[`${model.id}_${d}`] ?? model.shifts[d]),
    0,
  );
}

function workerWeekShifts(worker: Worker, shifts: ShiftsMap) {
  return worker.models.reduce(
    (s, m) => s + modelWeekShifts(m, shifts),
    0,
  );
}

function autoShift(posts: number): number {
  if (posts === 0) return 0;
  if (posts <= 15) return 0.5;
  if (posts <= 35) return 1;
  if (posts <= 55) return 1.5;
  return 2;
}

function weekLabel(week: number) {
  const base = new Date(2026, 5, 22);
  const off = (week - 26) * 7;
  const start = new Date(base.getTime() + off * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const fmtDay = (d: Date) =>
    d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  return {
    label: `${fmtDay(start)} — ${fmt(end)}`,
    start,
    end,
  };
}

function weekDates(week: number) {
  const base = new Date(2026, 5, 22);
  const off = (week - 26) * 7;
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getTime() + (off + i) * 86400000);
    return d.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
    });
  });
}

// Column layout
const W1 = 156;
const W2 = 148;
const W3 = 76;
const FIXED_MIN = W1 + W2 + W3;

// Row heights
const RH_WORKER = 44;
const RH_MODEL = 38;
const RH_ACCT = 34;

// Border tokens
const BORDER_CELL = "#E8E8F0";
const BORDER_HEAVY = "#D2D2E0";
const BG_WORKER = "#F7F7FA";
const BG_MODEL = "#FFFFFF";
const BG_ACCT = "#FFFFFF";

// bg is kept for call-site compatibility but is NOT applied inline —
// backgrounds are set via CSS classes so group-hover can override them
function stickyStyle(left: number, _bg?: string, zIndex = 10) {
  return { position: "sticky" as const, left, zIndex };
}

// Sub-components

function PostsBadge({
  n,
  banned,
  borderColor,
}: {
  n: number;
  banned?: boolean;
  borderColor?: string;
}) {
  if (banned) {
    return (
      <span
        className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-px rounded text-[11px] font-semibold tabular-nums leading-none"
        style={{
          backgroundColor: "#FEF2F2",
          color: "#EF4444",
          border: "1.5px solid transparent",
        }}
      >
        {n}
      </span>
    );
  }
  if (borderColor) {
    return (
      <span
        className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-px rounded text-[11px] font-semibold tabular-nums leading-none"
        style={{
          backgroundColor: `${borderColor}22`,
          color: borderColor,
          border: `1.5px solid ${borderColor}`,
        }}
      >
        {n}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center justify-center min-w-[22px] px-1.5 py-px rounded text-[11px] font-semibold tabular-nums leading-none"
      style={{
        backgroundColor: "#F2F2F2",
        color: "#111111",
        border: "1.5px solid transparent",
      }}
    >
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

interface TimeHover {
  x: number;
  y: number;
  start: string;
  end: string;
}
interface WorkerHover {
  x: number;
  y: number;
  worker: Worker;
}
interface ShiftHover {
  x: number;
  y: number;
  value: number;
}
interface ModelsHover {
  x: number;
  y: number;
  models: CRMModel[];
}
interface BanHover {
  x: number;
  y: number;
  username: string;
  banDate: string;
}

function TimeTooltip({ tip }: { tip: TimeHover }) {
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: tip.x,
        top: tip.y - 8,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="bg-white rounded-lg shadow-lg px-2.5 py-1.5 border border-[#E4E4F0]">
        <span
          className="text-[11px] tabular-nums text-[#1A1A30]"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {tip.start} – {tip.end}
        </span>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid #E4E4F0",
        }}
      />
    </div>
  );
}

function ShiftBadge({ value }: { value: number }) {
  if (value === 0) {
    return (
      <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded text-[11px] font-semibold tabular-nums bg-[#F0F0F0] text-[#C0C0C0] leading-none">
        0
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center min-w-[28px] h-6 px-2 rounded text-[11px] font-bold tabular-nums leading-none bg-[#EBEBEB] text-[#111111]">
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
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="text-[11px] border border-[#DDDDE8] rounded px-1.5 py-0.5 bg-white text-[#111111] font-semibold cursor-pointer appearance-none pr-4 focus:outline-none focus:ring-1 focus:ring-[#333] focus:border-[#333] h-6"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {SHIFT_OPTS.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <ChevronDown
        size={9}
        className="absolute right-1 top-1/2 -translate-y-1/2 text-[#888] pointer-events-none"
      />
    </div>
  );
}

function WorkerTooltip({ tip }: { tip: WorkerHover }) {
  const meta = WORKER_META[tip.worker.id];
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: tip.x,
        top: tip.y - 10,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="bg-white rounded-xl shadow-lg px-3.5 py-3 min-w-[180px] border border-[#E4E4F0]">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0"
            style={{ backgroundColor: tip.worker.color }}
          >
            {tip.worker.name[0]}
          </div>
          <div>
            <div className="text-[13px] font-semibold text-[#0D0D18]">
              {tip.worker.name}
            </div>
            <div className="text-[11px] text-[#7070AA]">
              {meta?.role ?? "Worker"}
            </div>
          </div>
        </div>
        <div className="border-t border-[#F0F0F8] pt-2 space-y-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] text-[#9898AA]">
              Added
            </span>
            <span className="text-[11px] font-medium text-[#1A1A30]">
              {meta?.addedDate ?? "—"}
            </span>
          </div>
          {tip.worker.deleted && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-[11px] text-red-400">
                Deleted
              </span>
              <span className="text-[11px] font-medium text-red-500">
                {meta?.deletedDate ?? "—"}
              </span>
            </div>
          )}
        </div>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid #E4E4F0",
        }}
      />
    </div>
  );
}

function ShiftTooltip({ tip }: { tip: ShiftHover }) {
  const salary = (tip.value * 10.5).toFixed(2);
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: tip.x,
        top: tip.y - 8,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="bg-white rounded-lg shadow-lg px-2.5 py-2 border border-[#E4E4F0] min-w-[130px]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-[#9898AA]">
            {tip.value} shift{tip.value !== 1 ? "s" : ""}
          </span>
          <span className="text-[12px] font-semibold text-[#0D0D18]">
            ${salary}
          </span>
        </div>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid #E4E4F0",
        }}
      />
    </div>
  );
}

function ModelsTooltip({ tip }: { tip: ModelsHover }) {
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: tip.x,
        top: tip.y - 8,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="bg-white rounded-lg shadow-lg px-3 py-2 border border-[#E4E4F0] min-w-[120px]">
        <div className="text-[10px] text-[#9898AA] mb-1.5 font-semibold uppercase tracking-wide">
          Models
        </div>
        {tip.models.map((m) => (
          <div
            key={m.id}
            className="text-[12px] text-[#1A1A30] py-0.5"
          >
            {m.name}
          </div>
        ))}
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid #E4E4F0",
        }}
      />
    </div>
  );
}

function BanTooltip({ tip }: { tip: BanHover }) {
  return (
    <div
      className="fixed z-[9999] pointer-events-none"
      style={{
        left: tip.x,
        top: tip.y - 8,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="bg-white rounded-xl shadow-lg px-3.5 py-3 border border-[#F0D0D0] min-w-[160px]">
        <div
          className="text-[11px] text-[#7070AA] mb-1.5 truncate"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {tip.username}
        </div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="px-1.5 py-0.5 text-[10px] bg-red-50 text-red-500 rounded font-semibold tracking-wide border border-red-200">
            BANNED
          </span>
        </div>
        <div className="text-[11px] text-[#9898AA]">
          Since{" "}
          <span className="font-medium text-red-500">
            {tip.banDate}
          </span>
        </div>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{
          borderLeft: "5px solid transparent",
          borderRight: "5px solid transparent",
          borderTop: "5px solid #F0D0D0",
        }}
      />
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
      style={{
        left: tip.x,
        top: tip.y - 12,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="bg-white rounded-xl shadow-lg px-3.5 py-3 min-w-[180px] border border-[#E4E4F0]">
        <div
          className="text-[10px] text-[#7070AA] mb-2 truncate"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {tip.username}
        </div>
        <div className="flex items-baseline gap-1.5 mb-1.5">
          <span className="text-[11px] text-[#9898AA]">
            Karma
          </span>
          <span className="text-sm font-semibold tabular-nums text-[#0D0D18]">
            {tip.data.karma.toLocaleString()}
          </span>
          <span
            className={`text-[11px] font-medium tabular-nums ${tip.data.karmaGrowth >= 0 ? "text-emerald-500" : "text-red-500"}`}
          >
            ({tip.data.karmaGrowth >= 0 ? "+" : ""}
            {tip.data.karmaGrowth.toLocaleString()})
          </span>
          {tip.data.karmaGrowth >= 0 ? (
            <TrendingUp
              size={11}
              className="text-emerald-500 shrink-0"
            />
          ) : (
            <TrendingDown
              size={11}
              className="text-red-500 shrink-0"
            />
          )}
        </div>
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[11px] text-[#9898AA]">
            Comments
          </span>
          <span className="text-[12px] font-semibold text-[#0D0D18]">
            {tip.data.comments}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-[11px] text-[#9898AA]">
            Status
          </span>
          {tip.banned ? (
            <span className="px-1.5 py-0.5 text-[10px] bg-red-50 text-red-500 rounded font-semibold tracking-wide border border-red-100">
              BANNED
            </span>
          ) : (
            <span className="px-1.5 py-0.5 text-[10px] bg-emerald-50 text-emerald-600 rounded font-semibold tracking-wide border border-emerald-100">
              ACTIVE
            </span>
          )}
        </div>
        <div
          className="text-[10px] text-[#BCBCCC] border-t border-[#F0F0F8] pt-1.5"
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          {tip.data.start} → {tip.data.end}
        </div>
      </div>
      <div
        className="absolute left-1/2 -translate-x-1/2 bottom-0 translate-y-full w-0 h-0"
        style={{
          borderLeft: "6px solid transparent",
          borderRight: "6px solid transparent",
          borderTop: "6px solid #E4E4F0",
        }}
      />
    </div>
  );
}

// Worker multi-select dropdown

function WorkerMultiSelect({
  selected,
  onChange,
  showDeleted,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  showDeleted: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node)
      )
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () =>
      document.removeEventListener("mousedown", handle);
  }, []);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  const visibleWorkers = showDeleted
    ? DATA
    : DATA.filter((w) => !w.deleted);

  const label =
    selected.size === 0
      ? "All workers"
      : selected.size === 1
        ? (DATA.find((w) => w.id === [...selected][0])?.name ??
          "1 worker")
        : `${selected.size} workers`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 pl-2.5 pr-2 h-7 text-xs text-[#444456] border border-[#E0E0EC] rounded-md bg-white hover:bg-[#F5F5FA] transition-colors whitespace-nowrap"
      >
        {selected.size > 0 && (
          <span className="flex items-center gap-0.5">
            {[...selected].map((id) => {
              const w = DATA.find((x) => x.id === id);
              return w ? (
                <span
                  key={id}
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: w.color }}
                />
              ) : null;
            })}
          </span>
        )}
        <span>{label}</span>
        <ChevronDown size={10} className="text-[#999]" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[#E0E0EC] rounded-lg shadow-lg py-1 min-w-[160px]">
          <button
            onClick={() => onChange(new Set())}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#F5F5FA] flex items-center gap-2 ${selected.size === 0 ? "font-semibold text-[#111]" : "text-[#444456]"}`}
          >
            <span className="w-3.5 h-3.5 rounded-full border border-[#DDD] flex items-center justify-center shrink-0">
              {selected.size === 0 && (
                <span className="w-2 h-2 rounded-full bg-[#111]" />
              )}
            </span>
            All workers
          </button>
          <div className="h-px bg-[#F0F0F0] my-1" />
          {visibleWorkers.map((w) => (
            <button
              key={w.id}
              onClick={() => toggle(w.id)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#F5F5FA] flex items-center gap-2"
            >
              <span
                className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border transition-colors"
                style={{
                  backgroundColor: selected.has(w.id)
                    ? w.color
                    : "transparent",
                  borderColor: selected.has(w.id)
                    ? w.color
                    : "#DDD",
                }}
              >
                {selected.has(w.id) && (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                  >
                    <path
                      d="M1.5 4L3.5 6L6.5 2"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                style={{ backgroundColor: w.color }}
              >
                {w.name[0]}
              </span>
              <span
                className={
                  selected.has(w.id)
                    ? "font-semibold text-[#111]"
                    : "text-[#444456]"
                }
              >
                {w.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Model color filter dropdown

function ModelColorFilter({
  selected,
  onChange,
}: {
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node)
      )
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () =>
      document.removeEventListener("mousedown", handle);
  }, []);

  const toggle = (key: string) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(next);
  };

  const label =
    selected.size === 0
      ? "Filters"
      : `${selected.size} filter${selected.size > 1 ? "s" : ""}`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 pl-2.5 pr-2 h-7 text-xs text-[#444456] border border-[#E0E0EC] rounded-md bg-white hover:bg-[#F5F5FA] transition-colors whitespace-nowrap"
      >
        {selected.size > 0 && (
          <span className="flex items-center gap-0.5">
            {[...selected].map((k) => (
              <span
                key={k}
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: POST_COLORS[k] }}
              />
            ))}
          </span>
        )}
        <span>{label}</span>
        <ChevronDown size={10} className="text-[#999]" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-[#E0E0EC] rounded-lg shadow-lg py-1 min-w-[228px]">
          <button
            onClick={() => onChange(new Set())}
            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#F5F5FA] flex items-center gap-2 ${selected.size === 0 ? "font-semibold text-[#111]" : "text-[#444456]"}`}
          >
            <span className="w-3.5 h-3.5 rounded border border-[#DDD] flex items-center justify-center shrink-0">
              {selected.size === 0 && (
                <span className="w-2 h-2 rounded-sm bg-[#111]" />
              )}
            </span>
            All
          </button>
          <div className="h-px bg-[#F0F0F0] my-1" />
          {MODEL_COLOR_OPTS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => toggle(opt.key)}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#F5F5FA] flex items-center gap-2"
            >
              <span
                className="w-3.5 h-3.5 rounded flex items-center justify-center shrink-0 border transition-colors"
                style={{
                  backgroundColor: selected.has(opt.key)
                    ? opt.color
                    : "transparent",
                  borderColor: selected.has(opt.key)
                    ? opt.color
                    : "#DDD",
                }}
              >
                {selected.has(opt.key) && (
                  <svg
                    width="8"
                    height="8"
                    viewBox="0 0 8 8"
                    fill="none"
                  >
                    <path
                      d="M1.5 4L3.5 6L6.5 2"
                      stroke="white"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: opt.color }}
              />
              <span
                className={
                  selected.has(opt.key)
                    ? "font-semibold text-[#111]"
                    : "text-[#444456]"
                }
              >
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Gear menu

function GearMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node)
      )
        setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () =>
      document.removeEventListener("mousedown", handle);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center justify-center w-7 h-7 border border-[#E0E0EC] rounded-md bg-white hover:bg-[#F5F5FA] transition-colors text-[#666]"
      >
        <Settings size={14} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-white border border-[#E0E0EC] rounded-lg shadow-lg py-1 min-w-[180px]">
          <button
            onClick={() => setOpen(false)}
            className="w-full text-left px-3 py-2 text-xs text-[#444456] hover:bg-[#F5F5FA] flex items-center gap-2"
          >
            <RefreshCw size={12} className="text-[#999]" />
            Rebuild snapshot
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full text-left px-3 py-2 text-xs text-[#444456] hover:bg-[#F5F5FA] flex items-center gap-2"
          >
            <Zap size={12} className="text-[#999]" />
            Generate week
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full text-left px-3 py-2 text-xs text-[#444456] hover:bg-[#F5F5FA] flex items-center gap-2"
          >
            <RotateCcw size={12} className="text-[#999]" />
            Regenerate week
          </button>
        </div>
      )}
    </div>
  );
}

// Main App

export default function App() {
  // По умолчанию открыты только модели: все воркеры развёрнуты, аккаунты скрыты
  const [expandedWorkers, setExpandedWorkers] = useState<
    Set<string>
  >(new Set(DATA.map((w) => w.id)));
  const [expandedModels, setExpandedModels] = useState<
    Set<string>
  >(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const [currentWeek, setCurrentWeek] = useState(26);
  const [workerFilters, setWorkerFilters] = useState<
    Set<string>
  >(new Set());
  const [modelColorFilters, setModelColorFilters] = useState<
    Set<string>
  >(new Set());
  const [search, setSearch] = useState("");
  const [tooltip, setTooltip] = useState<TooltipState | null>(
    null,
  );
  const [timeHover, setTimeHover] = useState<TimeHover | null>(
    null,
  );
  const [workerHover, setWorkerHover] =
    useState<WorkerHover | null>(null);
  const [shiftHover, setShiftHover] =
    useState<ShiftHover | null>(null);
  const [modelsHover, setModelsHover] =
    useState<ModelsHover | null>(null);
  const [banHover, setBanHover] = useState<BanHover | null>(
    null,
  );
  const [shifts, setShifts] = useState<ShiftsMap>(() => {
    const m: ShiftsMap = {};
    DATA.forEach((w) =>
      w.models.forEach((mo) => {
        DAYS_SHORT.forEach((_, d) => {
          const days = mo.accounts
            .map((a) => a.days[d])
            .filter(isDayData) as DayData[];
          const totalPosts = days.reduce(
            (s, x) => s + x.posts,
            0,
          );
          m[`${mo.id}_${d}`] = autoShift(totalPosts);
        });
      }),
    );
    return m;
  });

  const toggleWorker = useCallback((id: string) => {
    setExpandedWorkers((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);
  const toggleModel = useCallback((id: string) => {
    setExpandedModels((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }, []);
  const setShift = useCallback(
    (modelId: string, d: number, val: number) => {
      setShifts((p) => ({ ...p, [`${modelId}_${d}`]: val }));
    },
    [],
  );

  const modelMatchesColorFilter = useCallback(
    (model: CRMModel): boolean => {
      if (modelColorFilters.size === 0) return true;
      if (
        modelColorFilters.has("ban") &&
        model.accounts.some((a) => a.banned)
      )
        return true;
      const colorKeys = new Set(
        [...modelColorFilters].filter((k) => k !== "ban"),
      );
      for (let d = 0; d < 7; d++) {
        const agg = modelDayAgg(model, d, shifts);
        if (
          agg !== null &&
          colorKeys.has(postColorKey(agg.posts))
        )
          return true;
      }
      return false;
    },
    [modelColorFilters, shifts],
  );

  const wkLabel = weekLabel(currentWeek);
  const wkDates = weekDates(currentWeek);
  const searchLower = search.toLowerCase();

  const banFilterActive = modelColorFilters.has("ban");
  const colorOnlyFilterActive =
    modelColorFilters.size > 0 && !banFilterActive;

  const searchMatchType: "worker" | "model" | "account" | null =
    (() => {
      if (!searchLower) return null;
      if (
        DATA.some((w) =>
          w.models.some((m) =>
            m.accounts.some((a) =>
              stripU(a.username)
                .toLowerCase()
                .includes(searchLower),
            ),
          ),
        )
      )
        return "account";
      if (
        DATA.some((w) =>
          w.models.some((m) =>
            m.name.toLowerCase().includes(searchLower),
          ),
        )
      )
        return "model";
      if (
        DATA.some((w) =>
          w.name.toLowerCase().includes(searchLower),
        )
      )
        return "worker";
      return null;
    })();

  // Expand workers to model level for: ban filter, color filter, or model/account search
  const effectiveWorkerExpanded = (wid: string) =>
    banFilterActive ||
    colorOnlyFilterActive ||
    searchMatchType === "account" ||
    searchMatchType === "model"
      ? true
      : expandedWorkers.has(wid);

  // Expand models to account level only for ban filter or account search
  const effectiveModelExpanded = (mid: string) =>
    banFilterActive || searchMatchType === "account"
      ? true
      : expandedModels.has(mid);

  const accountFilter: "all" | "banned" | string =
    banFilterActive
      ? "banned"
      : searchMatchType === "account"
        ? searchLower
        : "all";

  const modelMatchesSearch = (
    worker: Worker,
    model: CRMModel,
  ) => {
    if (!searchLower) return true;
    if (worker.name.toLowerCase().includes(searchLower))
      return true;
    if (model.name.toLowerCase().includes(searchLower))
      return true;
    return model.accounts.some((a) =>
      stripU(a.username).toLowerCase().includes(searchLower),
    );
  };

  const filteredWorkers = DATA.filter((w) => {
    if (!showDeleted && w.deleted) return false;
    if (workerFilters.size > 0 && !workerFilters.has(w.id))
      return false;
    if (searchLower) {
      if (w.name.toLowerCase().includes(searchLower))
        return true;
      const hasMatch = w.models.some(
        (m) =>
          m.name.toLowerCase().includes(searchLower) ||
          m.accounts.some((a) =>
            stripU(a.username)
              .toLowerCase()
              .includes(searchLower),
          ),
      );
      if (!hasMatch) return false;
    }
    // When a color/ban filter is active, hide workers that have no matching visible models
    if (modelColorFilters.size > 0) {
      if (!w.models.some((m) => modelMatchesColorFilter(m)))
        return false;
    }
    return true;
  });

  const btnBase =
    "inline-flex items-center gap-1.5 px-2.5 h-7 text-xs text-[#444456] border border-[#E0E0EC] rounded-md bg-white hover:bg-[#F5F5FA] active:bg-[#EDEDF5] transition-colors whitespace-nowrap";

  return (
    <div
      className="h-screen flex flex-col overflow-hidden bg-[#F4F4F8]"
      style={{ fontFamily: "'Inter', sans-serif" }}
    >
      {/* HEADER */}
      <div className="shrink-0 bg-white border-b border-[#E0E0EC]">
        {/* Top row */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-[#EAEAF2]">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-[14px] font-semibold text-[#0D0D18] tracking-tight">
                Shift Weeks Management
              </span>
              <span className="text-xs text-[#9898AA] ml-2">
                Reddit posting shifts
              </span>
            </div>
            <div className="w-px h-5 bg-[#E4E4EC]" />
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentWeek((w) => w - 1)}
                className={btnBase}
              >
                <ChevronLeft size={12} />
                <span>Wk {currentWeek - 1}</span>
              </button>
              <div className="px-3 h-7 flex items-center text-xs font-medium text-[#0D0D18] bg-[#F0F0F8] rounded-md border border-[#E0E0EC] min-w-[196px] justify-center">
                {currentWeek === 26
                  ? "Current week"
                  : wkLabel.label}
              </div>
              <button
                onClick={() => setCurrentWeek((w) => w + 1)}
                className={btnBase}
              >
                <span>Wk {currentWeek + 1}</span>
                <Next size={12} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button className={btnBase}>
              <DollarSign size={12} className="text-[#666]" />
              Total salary
            </button>
            <div className="w-px h-5 bg-[#E4E4EC]" />
            <GearMenu />
            <div className="w-px h-5 bg-[#E4E4EC]" />
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-[#6E6E82] whitespace-nowrap">
                Show deleted
              </span>
              <button
                onClick={() => setShowDeleted((p) => !p)}
                className="relative rounded-full transition-colors duration-200 shrink-0"
                style={{
                  width: 32,
                  height: 18,
                  backgroundColor: showDeleted
                    ? "#5E6AD2"
                    : "#C8C8D6",
                }}
              >
                <span
                  className="absolute top-[2px] left-[2px] bg-white rounded-full shadow-sm transition-transform duration-200"
                  style={{
                    width: 14,
                    height: 14,
                    transform: showDeleted
                      ? "translateX(14px)"
                      : "translateX(0)",
                  }}
                />
              </button>
            </label>
          </div>
        </div>

        {/* Toolbar row */}
        <div className="flex items-center justify-between px-5 h-10 gap-3">
          <div className="flex items-center gap-1.5">
            {/* View models */}
            <div className="inline-flex items-center border border-[#E0E0EC] rounded-md overflow-hidden h-7 bg-white">
              <span className="px-2 text-xs text-[#444456] border-r border-[#E0E0EC] select-none">
                Models view
              </span>
              <button
                onClick={() => {
                  setExpandedWorkers(
                    new Set(DATA.map((w) => w.id)),
                  );
                  setExpandedModels(new Set());
                }}
                className="w-7 flex items-center justify-center text-[#666] hover:bg-[#F5F5FA] transition-colors h-full border-r border-[#E0E0EC]"
                title="Expand models"
              >
                <ChevronDown size={11} />
              </button>
              <button
                onClick={() => {
                  setExpandedWorkers(new Set());
                  setExpandedModels(new Set());
                }}
                className="w-7 flex items-center justify-center text-[#666] hover:bg-[#F5F5FA] transition-colors h-full"
                title="Collapse models"
              >
                <ChevronUp size={11} />
              </button>
            </div>

            {/* View accounts */}
            <div className="inline-flex items-center border border-[#E0E0EC] rounded-md overflow-hidden h-7 bg-white">
              <span className="px-2 text-xs text-[#444456] border-r border-[#E0E0EC] select-none">
                Accounts view
              </span>
              <button
                onClick={() => {
                  setExpandedWorkers(
                    new Set(DATA.map((w) => w.id)),
                  );
                  setExpandedModels(
                    new Set(
                      DATA.flatMap((w) =>
                        w.models.map((m) => m.id),
                      ),
                    ),
                  );
                }}
                className="w-7 flex items-center justify-center text-[#666] hover:bg-[#F5F5FA] transition-colors h-full border-r border-[#E0E0EC]"
                title="Expand accounts"
              >
                <ChevronDown size={11} />
              </button>
              <button
                onClick={() => setExpandedModels(new Set())}
                className="w-7 flex items-center justify-center text-[#666] hover:bg-[#F5F5FA] transition-colors h-full"
                title="Collapse accounts"
              >
                <ChevronUp size={11} />
              </button>
            </div>

            <div className="w-px h-4 bg-[#E4E4EC]" />
            <WorkerMultiSelect
              selected={workerFilters}
              onChange={setWorkerFilters}
              showDeleted={showDeleted}
            />
            <ModelColorFilter
              selected={modelColorFilters}
              onChange={setModelColorFilters}
            />
          </div>

          <div className="relative">
            <Search
              size={12}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#BCBCCC]"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
            {DAYS_SHORT.map((_, i) => (
              <col key={i} />
            ))}
          </colgroup>

          <thead>
            <tr>
              <th
                className="text-left text-[10px] font-semibold text-[#9898AA] uppercase tracking-widest px-4 border-b border-[#E0E0EC] border-r border-[#E8E8F0] bg-white"
                style={{
                  position: "sticky",
                  top: 0,
                  left: 0,
                  zIndex: 32,
                  height: 36,
                }}
              >
                Worker
              </th>
              <th
                className="text-left text-[10px] font-semibold text-[#9898AA] uppercase tracking-widest px-3 border-b border-[#E0E0EC] border-r border-[#E8E8F0] bg-white"
                style={{
                  position: "sticky",
                  top: 0,
                  left: W1,
                  zIndex: 32,
                  height: 36,
                }}
              >
                Model
              </th>
              <th
                className="text-center text-[10px] font-semibold text-[#9898AA] uppercase tracking-widest px-2 border-b border-[#E0E0EC] border-r border-[#E8E8F0] bg-white"
                style={{
                  position: "sticky",
                  top: 0,
                  left: W1 + W2,
                  zIndex: 32,
                  height: 36,
                }}
              >
                Shifts
              </th>
              {DAYS_SHORT.map((day, i) => (
                <th
                  key={i}
                  className="text-center px-3 border-b border-[#E0E0EC] border-r border-[#E8E8F0] last:border-r-0 bg-white"
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 29,
                    height: 36,
                  }}
                >
                  <div className="text-[11px] font-semibold text-[#0D0D18] leading-none">
                    {day}
                  </div>
                  <div className="text-[10px] font-normal text-[#BCBCCC] mt-0.5 leading-none">
                    {wkDates[i]}
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredWorkers.map((worker, wi) => {
              const isWorkerExpanded = expandedWorkers.has(
                worker.id,
              );
              const wShifts = workerWeekShifts(worker, shifts);
              const visibleModels = worker.models.filter(
                (m) =>
                  modelMatchesColorFilter(m) &&
                  modelMatchesSearch(worker, m),
              );

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
                  onTooltipEnter={(
                    x,
                    y,
                    data,
                    username,
                    banned,
                  ) =>
                    setTooltip({ x, y, data, username, banned })
                  }
                  onTooltipLeave={() => setTooltip(null)}
                  onTimeHover={(x, y, start, end) =>
                    setTimeHover({ x, y, start, end })
                  }
                  onTimeLeave={() => setTimeHover(null)}
                  wkDates={wkDates}
                  effectiveWorkerExpanded={
                    effectiveWorkerExpanded
                  }
                  effectiveModelExpanded={
                    effectiveModelExpanded
                  }
                  accountFilter={accountFilter}
                  onWorkerHover={(x, y, w) =>
                    setWorkerHover({ x, y, worker: w })
                  }
                  onWorkerLeave={() => setWorkerHover(null)}
                  onShiftHover={(x, y, v) =>
                    setShiftHover({ x, y, value: v })
                  }
                  onShiftLeave={() => setShiftHover(null)}
                  onModelsHover={(x, y, m) =>
                    setModelsHover({ x, y, models: m })
                  }
                  onModelsLeave={() => setModelsHover(null)}
                  onBanHover={(x, y, u, d) =>
                    setBanHover({
                      x,
                      y,
                      username: u,
                      banDate: d,
                    })
                  }
                  onBanLeave={() => setBanHover(null)}
                />
              );
            })}
          </tbody>
        </table>

        {filteredWorkers.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-[#BCBCCC]">
            <Search size={22} className="mb-2 opacity-40" />
            <span className="text-sm">
              No workers match your filters
            </span>
          </div>
        )}
      </div>

      {tooltip && <Tooltip tip={tooltip} />}
      {timeHover && <TimeTooltip tip={timeHover} />}
      {workerHover && <WorkerTooltip tip={workerHover} />}
      {shiftHover && <ShiftTooltip tip={shiftHover} />}
      {modelsHover && <ModelsTooltip tip={modelsHover} />}
      {banHover && <BanTooltip tip={banHover} />}
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
  onTooltipEnter: (
    x: number,
    y: number,
    data: DayData,
    username: string,
    banned: boolean,
  ) => void;
  onTooltipLeave: () => void;
  onTimeHover: (
    x: number,
    y: number,
    start: string,
    end: string,
  ) => void;
  onTimeLeave: () => void;
  wkDates: string[];
  effectiveWorkerExpanded: (id: string) => boolean;
  effectiveModelExpanded: (id: string) => boolean;
  accountFilter: "all" | "banned" | string;
  onWorkerHover: (x: number, y: number, worker: Worker) => void;
  onWorkerLeave: () => void;
  onShiftHover: (x: number, y: number, value: number) => void;
  onShiftLeave: () => void;
  onModelsHover: (
    x: number,
    y: number,
    models: CRMModel[],
  ) => void;
  onModelsLeave: () => void;
  onBanHover: (
    x: number,
    y: number,
    username: string,
    banDate: string,
  ) => void;
  onBanLeave: () => void;
}

function WorkerSection({
  worker,
  visibleModels,
  isWorkerExpanded,
  expandedModels,
  isFirst,
  wShifts,
  shifts,
  onToggleWorker,
  onToggleModel,
  onSetShift,
  onTooltipEnter,
  onTooltipLeave,
  onTimeHover,
  onTimeLeave,
  wkDates,
  effectiveWorkerExpanded,
  effectiveModelExpanded,
  accountFilter,
  onWorkerHover,
  onWorkerLeave,
  onShiftHover,
  onShiftLeave,
  onModelsHover,
  onModelsLeave,
  onBanHover,
  onBanLeave,
}: WorkerSectionProps) {
  const topBorder = isFirst
    ? {}
    : { borderTop: `2px solid #B8B8D0` };
  const workerBg = worker.deleted ? "#FFF5F5" : BG_WORKER;
  const stickyBgCls = worker.deleted
    ? "bg-[#FFF5F5] group-hover:bg-[#FFEBEB]"
    : "bg-[#F7F7FA] group-hover:bg-[#EDEDF5]";
  const dayBgCls = worker.deleted
    ? "bg-[#FFF5F5] group-hover:bg-[#FFEBEB]"
    : "bg-[#F7F7FA] group-hover:bg-[#EDEDF5]";

  return (
    <>
      <tr
        className="group cursor-pointer"
        style={{ ...topBorder, backgroundColor: workerBg }}
        onClick={() => onToggleWorker(worker.id)}
      >
        <td
          className={`px-3 border-r border-[#E8E8F0] transition-colors ${stickyBgCls}`}
          style={{ ...stickyStyle(0), height: RH_WORKER }}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onWorkerHover(r.left + r.width / 2, r.top, worker);
          }}
          onMouseLeave={onWorkerLeave}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-4 h-4 flex items-center justify-center text-[#BCBCCC] shrink-0">
              {effectiveWorkerExpanded(worker.id) ? (
                <ChevronDown size={13} strokeWidth={2.5} />
              ) : (
                <ChevronRight size={13} strokeWidth={2.5} />
              )}
            </div>
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
              style={{ backgroundColor: worker.color }}
            >
              {worker.name[0]}
            </div>
            <span className="text-[13px] font-semibold text-[#0D0D18] tracking-tight truncate">
              {worker.name}
            </span>
            {worker.deleted && (
              <span className="shrink-0 px-1.5 py-px text-[10px] font-medium text-red-500 bg-red-50 rounded border border-red-200 leading-none">
                deleted
              </span>
            )}
          </div>
        </td>
        <td
          className={`px-3 border-r border-[#E8E8F0] transition-colors ${stickyBgCls}`}
          style={{ ...stickyStyle(W1), height: RH_WORKER }}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onModelsHover(
              r.left + r.width / 2,
              r.top,
              worker.models,
            );
          }}
          onMouseLeave={onModelsLeave}
        >
          <span className="text-xs text-[#BCBCCC]">
            {worker.models.length} model
            {worker.models.length !== 1 ? "s" : ""}
          </span>
        </td>
        <td
          className={`px-2 text-center border-r border-[#E8E8F0] transition-colors ${stickyBgCls}`}
          style={{ ...stickyStyle(W1 + W2), height: RH_WORKER }}
          onMouseEnter={
            wShifts > 0
              ? (e) => {
                  const r =
                    e.currentTarget.getBoundingClientRect();
                  onShiftHover(
                    r.left + r.width / 2,
                    r.top,
                    wShifts,
                  );
                }
              : undefined
          }
          onMouseLeave={wShifts > 0 ? onShiftLeave : undefined}
        >
          <span className="text-[13px] font-bold text-[#0D0D18] tabular-nums">
            {wShifts}
          </span>
        </td>
        {DAYS_SHORT.map((_, d) => {
          const s = workerDayAgg(worker, d, shifts);
          return (
            <td
              key={d}
              className={`border-r border-[#E8E8F0] last:border-r-0 transition-colors ${dayBgCls}`}
              style={{ height: RH_WORKER }}
              onMouseEnter={
                s
                  ? (e) => {
                      const r =
                        e.currentTarget.getBoundingClientRect();
                      onTimeHover(
                        r.left + r.width / 2,
                        r.top,
                        s.start,
                        s.end,
                      );
                    }
                  : undefined
              }
              onMouseLeave={s ? onTimeLeave : undefined}
            >
              <div className="flex items-center justify-between h-full px-3">
                <span
                  style={{
                    minWidth: 22,
                    display: "inline-flex",
                    justifyContent: "center",
                  }}
                >
                  {s ? (
                    <PostsBadge n={s.posts} />
                  ) : (
                    <span className="text-[#D8D8E4] text-xs">
                      —
                    </span>
                  )}
                </span>
                <DeletedBadge n={s?.deleted ?? 0} />
                <span
                  style={{
                    minWidth: 28,
                    display: "inline-flex",
                    justifyContent: "center",
                  }}
                >
                  {s ? (
                    <ShiftBadge value={s.totalShifts} />
                  ) : null}
                </span>
              </div>
            </td>
          );
        })}
      </tr>

      {effectiveWorkerExpanded(worker.id) &&
        visibleModels.map((model) => {
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
              wkDates={wkDates}
              effectiveModelExpanded={effectiveModelExpanded}
              accountFilter={accountFilter}
              onShiftHover={onShiftHover}
              onShiftLeave={onShiftLeave}
              onBanHover={onBanHover}
              onBanLeave={onBanLeave}
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
  onTooltipEnter: (
    x: number,
    y: number,
    data: DayData,
    username: string,
    banned: boolean,
  ) => void;
  onTooltipLeave: () => void;
  onTimeHover: (
    x: number,
    y: number,
    start: string,
    end: string,
  ) => void;
  onTimeLeave: () => void;
  wkDates: string[];
  effectiveModelExpanded: (id: string) => boolean;
  accountFilter: "all" | "banned" | string;
  onShiftHover: (x: number, y: number, value: number) => void;
  onShiftLeave: () => void;
  onBanHover: (
    x: number,
    y: number,
    username: string,
    banDate: string,
  ) => void;
  onBanLeave: () => void;
}

function ModelSection({
  model,
  worker,
  isModelExpanded,
  mShifts,
  shifts,
  onToggleModel,
  onSetShift,
  onTooltipEnter,
  onTooltipLeave,
  onTimeHover,
  onTimeLeave,
  wkDates,
  effectiveModelExpanded,
  accountFilter,
  onShiftHover,
  onShiftLeave,
  onBanHover,
  onBanLeave,
}: ModelSectionProps) {
  const visibleAccounts =
    accountFilter === "all"
      ? model.accounts
      : accountFilter === "banned"
        ? model.accounts.filter((a) => a.banned)
        : model.accounts.filter((a) =>
            stripU(a.username)
              .toLowerCase()
              .includes(accountFilter),
          );

  return (
    <>
      <tr
        className="group cursor-pointer"
        style={{
          borderTop: `1px solid ${BORDER_CELL}`,
          backgroundColor: BG_MODEL,
        }}
        onClick={() => onToggleModel(model.id)}
      >
        <td
          className="border-r border-[#E8E8F0] bg-white group-hover:bg-[#F8F8FC] transition-colors"
          style={{ ...stickyStyle(0), height: RH_MODEL }}
        />
        <td
          className="px-3 border-r border-[#E8E8F0] bg-white group-hover:bg-[#F8F8FC] transition-colors"
          style={{ ...stickyStyle(W1), height: RH_MODEL }}
        >
          <div className="flex items-center gap-1.5">
            <div className="w-3.5 h-3.5 flex items-center justify-center text-[#BCBCCC] shrink-0">
              {effectiveModelExpanded(model.id) ? (
                <ChevronDown size={11} strokeWidth={2.5} />
              ) : (
                <ChevronRight size={11} strokeWidth={2.5} />
              )}
            </div>
            <span className="text-[12px] font-medium text-[#1A1A30]">
              {model.name}
            </span>
          </div>
        </td>
        <td
          className="px-2 text-center border-r border-[#E8E8F0] bg-white group-hover:bg-[#F8F8FC] transition-colors"
          style={{ ...stickyStyle(W1 + W2), height: RH_MODEL }}
          onMouseEnter={
            mShifts > 0
              ? (e) => {
                  const r =
                    e.currentTarget.getBoundingClientRect();
                  onShiftHover(
                    r.left + r.width / 2,
                    r.top,
                    mShifts,
                  );
                }
              : undefined
          }
          onMouseLeave={mShifts > 0 ? onShiftLeave : undefined}
        >
          <span className="text-[12px] font-normal tabular-nums text-[#555566]">
            {mShifts}
          </span>
        </td>
        {DAYS_SHORT.map((_, d) => {
          const s = modelDayAgg(model, d, shifts);
          const shiftVal =
            shifts[`${model.id}_${d}`] ?? model.shifts[d];
          return (
            <td
              key={d}
              className="border-r border-[#E8E8F0] last:border-r-0 bg-white group-hover:bg-[#F8F8FC] transition-colors"
              style={{ height: RH_MODEL }}
              onClick={(e) => e.stopPropagation()}
              onMouseEnter={
                s
                  ? (e) => {
                      const r =
                        e.currentTarget.getBoundingClientRect();
                      onTimeHover(
                        r.left + r.width / 2,
                        r.top,
                        s.start,
                        s.end,
                      );
                    }
                  : undefined
              }
              onMouseLeave={s ? onTimeLeave : undefined}
            >
              <div className="flex items-center justify-between h-full px-3">
                <span
                  style={{
                    minWidth: 22,
                    display: "inline-flex",
                    justifyContent: "center",
                  }}
                >
                  {s ? (
                    <PostsBadge
                      n={s.posts}
                      borderColor={postBorderColor(s.posts)}
                    />
                  ) : null}
                </span>
                <DeletedBadge n={s?.deleted ?? 0} />
                <ShiftSelect
                  value={shiftVal}
                  onChange={(v) => onSetShift(model.id, d, v)}
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            </td>
          );
        })}
      </tr>

      {effectiveModelExpanded(model.id) &&
        visibleAccounts.map((account) => (
          <tr
            key={account.id}
            className="group"
            style={{
              borderTop: `1px solid ${BORDER_CELL}`,
              backgroundColor: BG_ACCT,
            }}
          >
            {/* Col 1: indent */}
            <td
              className="border-r border-[#E8E8F0] bg-white group-hover:bg-[#F0F0FA] transition-colors"
              style={{ ...stickyStyle(0), height: RH_ACCT }}
            />

            {/* Col 2: username as reddit link */}
            <td
              className="px-3 border-r border-[#E8E8F0] bg-white group-hover:bg-[#F0F0FA] transition-colors"
              style={{ ...stickyStyle(W1), height: RH_ACCT }}
            >
              <div className="flex items-center gap-1.5 pl-5 min-w-0">
                <a
                  href={`https://www.reddit.com/user/${stripU(account.username)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-[11px] font-medium truncate hover:underline"
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    color: account.banned
                      ? "#EF4444"
                      : "#3535A8",
                  }}
                >
                  {stripU(account.username)}
                </a>
                {account.banned && (
                  <span className="shrink-0 px-1.5 py-px text-[9px] font-bold tracking-wide bg-red-100 text-red-500 rounded border border-red-200 leading-none">
                    BAN
                  </span>
                )}
              </div>
            </td>

            {/* Col 3: empty */}
            <td
              className="border-r border-[#E8E8F0] bg-white group-hover:bg-[#F0F0FA] transition-colors"
              style={{
                ...stickyStyle(W1 + W2),
                height: RH_ACCT,
              }}
            />

            {/* Day cells */}
            {account.days.map((day, d) => (
              <td
                key={d}
                className={`border-r border-[#E8E8F0] last:border-r-0 bg-white group-hover:bg-[#F0F0FA] transition-colors ${isDayData(day) ? "cursor-default" : ""}`}
                style={{ height: RH_ACCT }}
                onMouseEnter={
                  isDayData(day)
                    ? (e) => {
                        const rect =
                          e.currentTarget.getBoundingClientRect();
                        onTooltipEnter(
                          rect.left + rect.width / 2,
                          rect.top,
                          day,
                          account.username,
                          account.banned,
                        );
                      }
                    : day === "banned"
                      ? (e) => {
                          const rect =
                            e.currentTarget.getBoundingClientRect();
                          const banDate =
                            wkDates[account.banFromDay ?? d] ??
                            "unknown";
                          onBanHover(
                            rect.left + rect.width / 2,
                            rect.top,
                            stripU(account.username),
                            banDate,
                          );
                        }
                      : undefined
                }
                onMouseLeave={
                  isDayData(day)
                    ? onTooltipLeave
                    : day === "banned"
                      ? onBanLeave
                      : undefined
                }
              >
                {isDayData(day) ? (
                  <div className="flex items-center justify-between h-full px-3">
                    <span
                      className="text-[11px] font-semibold tabular-nums"
                      style={{ color: "#111111" }}
                    >
                      {day.posts}
                    </span>
                    <span
                      className="text-[11px] font-medium tabular-nums"
                      style={{
                        color:
                          day.deleted > 0
                            ? "#F87171"
                            : "transparent",
                        minWidth: 16,
                        textAlign: "center",
                      }}
                    >
                      {day.deleted > 0 ? day.deleted : "·"}
                    </span>
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] text-[#BCBCCC]"
                      style={{
                        fontFamily:
                          "'JetBrains Mono', monospace",
                      }}
                    >
                      <Clock
                        size={9}
                        className="shrink-0 opacity-70"
                      />
                      <span className="truncate">
                        {day.start}–{day.end}
                      </span>
                    </span>
                  </div>
                ) : day === "banned" ? (
                  <div className="flex items-center justify-center h-full">
                    <span className="px-1.5 py-px text-[9px] font-bold tracking-wide bg-red-100 text-red-500 rounded border border-red-200 leading-none uppercase">
                      ban
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <span className="text-[#E0E0EA] text-[12px]">
                      ·
                    </span>
                  </div>
                )}
              </td>
            ))}
          </tr>
        ))}
    </>
  );
}
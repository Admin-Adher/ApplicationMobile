import { Search, Filter, ChevronDown, Building2, Clock, Layers, Plus, Maximize2, Minus, Pencil, FileText, ArrowLeftRight, X, Hammer, MessageSquareMore, AlertTriangle, LayoutDashboard, Map, Star } from "lucide-react";

const NAVY = "#003082";

type Building = { id: string; name: string; plans: number; reserves: number };

const RECENT: Building[] = [
  { id: "gb12", name: "GuestBlock 12", plans: 8, reserves: 3 },
  { id: "gb01", name: "GuestBlock 1", plans: 12, reserves: 1 },
  { id: "svA", name: "Service A — Cuisine", plans: 5, reserves: 0 },
];

const ALL: Building[] = [
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `gb${i + 1}`,
    name: `GuestBlock ${i + 1}`,
    plans: 6 + (i % 7),
    reserves: i % 4,
  })),
  { id: "svA", name: "Service A — Cuisine", plans: 5, reserves: 0 },
  { id: "svB", name: "Service B — Buanderie", plans: 4, reserves: 2 },
  { id: "svC", name: "Service C — Maintenance", plans: 3, reserves: 0 },
  { id: "svD", name: "Service D — Stockage", plans: 4, reserves: 1 },
  ...Array.from({ length: 12 }, (_, i) => ({
    id: `vN${i + 1}`,
    name: `Villa N${i + 1}`,
    plans: 7 + (i % 5),
    reserves: i % 3,
  })),
  { id: "comm", name: "Bâtiments communs", plans: 9, reserves: 4 },
  { id: "tech", name: "Local technique", plans: 3, reserves: 0 },
  { id: "park", name: "Parking couvert", plans: 2, reserves: 1 },
  { id: "exte", name: "Aménagement extérieur", plans: 6, reserves: 2 },
];

export function BottomSheet() {
  return (
    <div className="min-h-screen w-full bg-[#F5F7FA] font-sans relative overflow-hidden">
      {/* ===== Background screen (dimmed) ===== */}
      <div className="absolute inset-0">
        {/* Header */}
        <div className="px-5 pt-12 pb-3 bg-white">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-[28px] font-extrabold text-slate-900 leading-none">Plans</h1>
              <button className="mt-1 inline-flex items-center gap-1 text-[#003082] text-sm">
                Tropicalia <ChevronDown className="w-4 h-4" />
              </button>
            </div>
            <button className="inline-flex items-center gap-1.5 border border-slate-200 rounded-full px-3 py-1.5 text-xs text-slate-700">
              <Filter className="w-3.5 h-3.5" /> Filtres
            </button>
          </div>
        </div>

        {/* Building chips placeholder (greyed) */}
        <div className="px-5 pt-3 pb-2 bg-white flex gap-2 overflow-hidden">
          <div className="px-3 py-2 rounded-full border-2 border-[#003082] bg-white text-xs font-semibold text-[#003082] flex items-center gap-1.5 whitespace-nowrap">
            <Building2 className="w-3.5 h-3.5" /> GuestBlock 12
          </div>
        </div>

        {/* Plan area greyed */}
        <div className="px-5 pt-3 bg-white pb-6">
          <div className="h-7 w-2/3 bg-slate-200 rounded mb-2" />
          <div className="h-3 w-1/3 bg-slate-100 rounded mb-4" />
          <div className="h-[200px] bg-slate-100 rounded-lg border border-slate-200" />
        </div>
      </div>

      {/* Dim overlay */}
      <div className="absolute inset-0 bg-black/40" />

      {/* ===== Bottom sheet ===== */}
      <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl shadow-2xl flex flex-col" style={{ height: "78%" }}>
        {/* Drag handle */}
        <div className="pt-2 pb-1 flex justify-center">
          <div className="w-10 h-1 rounded-full bg-slate-300" />
        </div>

        {/* Title row */}
        <div className="px-5 pt-2 pb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Choisir un bâtiment</h2>
            <p className="text-xs text-slate-500 mt-0.5">32 bâtiments dans Tropicalia</p>
          </div>
          <button className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
            <X className="w-4 h-4 text-slate-600" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pb-2">
          <div className="flex items-center gap-2 bg-slate-100 rounded-xl px-3 py-2.5">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              defaultValue=""
              placeholder="Rechercher par nom (ex. GuestBlock 7)"
              className="flex-1 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
              readOnly
            />
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {/* Recents */}
          <div className="px-3 pt-3 pb-1.5 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Récemment consultés</span>
          </div>
          {RECENT.map((b, i) => (
            <BuildingRow key={b.id} b={b} active={i === 0} pinned />
          ))}

          {/* Separator */}
          <div className="px-3 pt-4 pb-1.5 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tous les bâtiments · 32</span>
          </div>
          {ALL.slice(0, 8).map((b) => (
            <BuildingRow key={b.id} b={b} />
          ))}
        </div>
      </div>
    </div>
  );
}

function BuildingRow({ b, active = false, pinned = false }: { b: Building; active?: boolean; pinned?: boolean }) {
  return (
    <button
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl ${active ? "bg-[#003082]/8 border border-[#003082]/20" : ""}`}
    >
      <div
        className={`w-9 h-9 rounded-lg flex items-center justify-center ${active ? "bg-[#003082] text-white" : "bg-slate-100 text-slate-500"}`}
      >
        <Building2 className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-1.5">
          <span className={`text-[14px] font-semibold truncate ${active ? "text-[#003082]" : "text-slate-900"}`}>{b.name}</span>
          {pinned && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500">
          <span>{b.plans} plans</span>
          {b.reserves > 0 && (
            <>
              <span className="w-0.5 h-0.5 rounded-full bg-slate-300" />
              <span className="text-rose-600 font-medium">{b.reserves} réserve{b.reserves > 1 ? "s" : ""}</span>
            </>
          )}
        </div>
      </div>
      {active && <div className="w-2 h-2 rounded-full bg-[#003082]" />}
    </button>
  );
}

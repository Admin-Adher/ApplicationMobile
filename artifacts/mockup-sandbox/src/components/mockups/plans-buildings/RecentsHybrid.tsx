import { Filter, ChevronDown, Building2, Clock, Plus, Maximize2, Minus, Pencil, FileText, ArrowLeftRight, X, Hammer, MessageSquareMore, AlertTriangle, LayoutDashboard, Map } from "lucide-react";

const NAVY = "#003082";

const RECENTS = [
  { id: "gb12", name: "GuestBlock 12", reserves: 3 },
  { id: "gb01", name: "GuestBlock 1", reserves: 1 },
  { id: "svA", name: "Service A", reserves: 0 },
];

export function RecentsHybrid() {
  return (
    <div className="min-h-screen w-full bg-[#F5F7FA] font-sans flex flex-col">
      {/* Status bar spacer */}
      <div className="h-6" />

      {/* Header */}
      <div className="px-5 pt-2 pb-3 bg-white">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold text-slate-900 leading-none">Plans</h1>
            <button className="mt-1 inline-flex items-center gap-1 text-[#003082] text-sm">
              Tropicalia <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <button className="inline-flex items-center gap-1.5 border border-slate-200 rounded-full px-3 py-1.5 text-xs text-slate-700 bg-white">
            <Filter className="w-3.5 h-3.5" /> Filtres
          </button>
        </div>
      </div>

      {/* === Building row : récents + Tous (32) === */}
      <div className="bg-white px-5 pb-3">
        <div className="flex items-center gap-1.5 pb-1.5">
          <Clock className="w-3 h-3 text-slate-400" />
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Récents</span>
        </div>
        <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1" style={{ scrollbarWidth: "none" }}>
          {RECENTS.map((b, i) => (
            <button
              key={b.id}
              className={`shrink-0 px-3 py-2 rounded-full text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap relative ${
                i === 0
                  ? "bg-white border-2 border-[#003082] text-[#003082]"
                  : "bg-slate-100 border border-slate-200 text-slate-600"
              }`}
            >
              <Building2 className="w-3.5 h-3.5" />
              {b.name}
              {b.reserves > 0 && (
                <span className="ml-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {b.reserves}
                </span>
              )}
            </button>
          ))}
          <button className="shrink-0 px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 whitespace-nowrap bg-[#003082] text-white shadow-sm">
            Tous · 32
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Level chips */}
      <div className="bg-white px-5 pb-3 flex gap-2 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        <Chip active>Tous niveaux</Chip>
        <Chip>RDC</Chip>
        <Chip>R+1</Chip>
        <Chip>R+2</Chip>
      </div>

      {/* Plan tab */}
      <div className="bg-white px-5 pb-3 flex gap-2">
        <button className="px-3 py-2 rounded-lg border border-[#003082] bg-white flex items-center gap-2 text-xs font-semibold text-slate-800">
          <FileText className="w-3.5 h-3.5 text-slate-500" />
          RDC
          <span className="ml-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#003082] text-white text-[10px] font-bold flex items-center justify-center">
            1
          </span>
        </button>
      </div>

      {/* Plan card */}
      <div className="bg-white px-5 pb-2 flex-1 flex flex-col">
        <div className="flex items-start justify-between gap-2 pb-1">
          <div className="min-w-0">
            <h2 className="text-[15px] font-bold text-slate-900 truncate">PLANTA DE LOSA NIVEL 01 02.A...</h2>
            <p className="text-[11px] text-slate-500 mt-0.5">PDF · 14/04/2026</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center"><Minus className="w-3.5 h-3.5 text-slate-600" /></button>
            <span className="w-1.5 h-1.5 rounded-full bg-[#003082]" />
            <button className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center"><Plus className="w-3.5 h-3.5 text-slate-600" /></button>
          </div>
        </div>
        <div className="flex gap-2 pb-3 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          <ActionPill icon={<Clock className="w-3 h-3" />} label="R01" />
          <ActionPill icon={<ArrowLeftRight className="w-3 h-3" />} label="Remplacer" />
          <ActionPill icon={<X className="w-3 h-3" />} label="Retirer" tone="amber" />
          <ActionPill icon={<FileText className="w-3 h-3" />} label="Plan" tone="rose" />
        </div>

        {/* Plan thumbnail */}
        <div className="relative rounded-lg border border-slate-200 bg-slate-50 overflow-hidden flex-1 min-h-[180px]">
          <div className="absolute inset-0 bg-[linear-gradient(0deg,#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] bg-[size:14px_14px] opacity-60" />
          <div className="absolute inset-3 border border-slate-300 rounded">
            <div className="grid grid-cols-6 gap-px bg-slate-300 h-full p-px">
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className="bg-slate-50" />
              ))}
            </div>
          </div>
          {/* Hors-zone chip */}
          <div className="absolute top-2 right-10 bg-white/90 border border-slate-200 rounded-full px-2 py-0.5 text-[10px] text-slate-600 shadow-sm">
            ☁ Hors...
          </div>
          <button className="absolute top-2 right-2 w-6 h-6 rounded bg-slate-700/80 flex items-center justify-center">
            <Maximize2 className="w-3 h-3 text-white" />
          </button>
          {/* Pin */}
          <div className="absolute top-1/2 left-[55%] -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shadow-md ring-2 ring-white">
            1
          </div>
          {/* FAB */}
          <button className="absolute bottom-3 right-3 w-11 h-11 rounded-full bg-[#003082] text-white flex items-center justify-center shadow-lg">
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-between pt-2.5">
          <div className="flex items-center gap-1.5">
            <button className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center"><Minus className="w-3 h-3 text-slate-600" /></button>
            <button className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center"><Maximize2 className="w-3 h-3 text-slate-600" /></button>
            <button className="w-7 h-7 rounded border border-slate-200 flex items-center justify-center"><Plus className="w-3 h-3 text-slate-600" /></button>
          </div>
          <button className="inline-flex items-center gap-1.5 border border-[#003082] text-[#003082] rounded-full px-3 py-1.5 text-xs font-semibold">
            <Pencil className="w-3 h-3" /> Annoter
          </button>
        </div>
      </div>

      {/* Reserves bar */}
      <div className="bg-white border-t border-slate-100 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-slate-100 flex items-center justify-center">
            <span className="text-[11px]">≡</span>
          </div>
          <span className="text-[13px] font-medium text-slate-800">1 réserve</span>
        </div>
        <button className="inline-flex items-center gap-1.5 border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-slate-700 bg-white">
          <FileText className="w-3 h-3" /> PDF
          <ChevronDown className="w-3 h-3" />
        </button>
      </div>

      {/* Tab bar */}
      <div className="bg-white border-t border-slate-200 px-2 py-2 flex items-center justify-around">
        <Tab icon={<LayoutDashboard className="w-5 h-5" />} label="Dashboard" />
        <Tab icon={<Map className="w-5 h-5" />} label="Plans" active />
        <Tab icon={<AlertTriangle className="w-5 h-5" />} label="Réserves" badge="1" />
        <Tab icon={<MessageSquareMore className="w-5 h-5" />} label="Messages" />
        <Tab icon={<Hammer className="w-5 h-5" />} label="Terrain" />
      </div>
    </div>
  );
}

function Chip({ children, active = false }: { children: React.ReactNode; active?: boolean }) {
  return (
    <button
      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap ${
        active ? "bg-white border-2 border-[#003082] text-[#003082]" : "bg-slate-100 border border-slate-200 text-slate-600"
      }`}
    >
      {children}
    </button>
  );
}

function ActionPill({ icon, label, tone }: { icon: React.ReactNode; label: string; tone?: "amber" | "rose" }) {
  const cls =
    tone === "amber"
      ? "border-amber-300 text-amber-700 bg-amber-50"
      : tone === "rose"
      ? "border-rose-300 text-rose-700 bg-rose-50"
      : "border-slate-200 text-slate-700 bg-white";
  return (
    <button className={`shrink-0 inline-flex items-center gap-1 border rounded-md px-2 py-1 text-[11px] font-medium ${cls}`}>
      {icon}
      {label}
    </button>
  );
}

function Tab({ icon, label, active = false, badge }: { icon: React.ReactNode; label: string; active?: boolean; badge?: string }) {
  return (
    <button className="flex flex-col items-center gap-0.5 px-2 relative">
      <div className={active ? "text-[#003082]" : "text-slate-400"}>
        {icon}
        {badge && (
          <span className="absolute -top-1 right-3 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
      </div>
      <span className={`text-[10px] font-medium ${active ? "text-[#003082]" : "text-slate-400"}`}>{label}</span>
    </button>
  );
}

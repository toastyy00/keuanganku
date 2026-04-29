# Portfolio Tracker — Hidden Menu Feature

Fitur portfolio tracker tersembunyi dengan Supabase sync, live chart berdasarkan harga real, activity feed, dan pocket management.

## Decisions (Confirmed)

- **Price API**: CoinGecko Free API (`api.coingecko.com/api/v3`) — supports CORS, no API key needed
- **Chart Data**: Chart menampilkan **timeline total value nyata portfolio**. Contoh: saat ini total Rp 1jt → 1 jam lagi turun ke Rp 800rb → 1 jam lagi naik ke Rp 1,2jt — chart line mengikuti pergerakan itu. Dihitung dari `Σ(jumlah_aset_saat_ini × harga_historis_aset_pada_timestamp_itu)` menggunakan CoinGecko `/coins/{id}/market_chart`. Saat harga aset bergerak, chart otomatis bergerak.
- **Currency Display**: Pakai `exchangeRate.ts` yang sudah ada (auto-fetch USD/IDR)
- **Pull-to-Reveal**: Pakai mekanisme yang sudah ada di `DashboardPage.tsx`
- **Sync**: Ikuti pola sync-engine existing, tambah 3 entity baru tanpa ubah logic existing

---

## Proposed Changes

### 1. Database — Supabase Migration

#### [NEW] [003_portfolio.sql](file:///d:/Documents/expenses-tracker/supabase/migrations/003_portfolio.sql)

3 tabel baru. Tidak ada tabel existing yang diubah.

**`portfolio_pockets`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK → auth.users | RLS |
| `name` | TEXT | Nama kantong |
| `source_type` | TEXT | `CEX` / `WEB3` / `WALLET` / `LAINNYA` |
| `source` | TEXT nullable | Deskripsi sumber |
| `color_theme` | TEXT | Hex color untuk kartu & chart |
| `icon` | TEXT | Icon identifier |
| `sort_order` | INT | Urutan tampilan |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMPTZ | Sync support |

**`portfolio_assets`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK | RLS |
| `pocket_id` | UUID FK → pockets | |
| `ticker` | TEXT | e.g. BTC, SOL, JUP |
| `coingecko_id` | TEXT nullable | Auto-resolved dari ticker |
| `amount` | NUMERIC | Jumlah kepemilikan |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMPTZ | |

**`portfolio_activity_log`**

| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID FK | RLS |
| `pocket_id` | UUID FK | |
| `asset_id` | UUID FK → assets | |
| `ticker` | TEXT | Denormalized |
| `action` | TEXT | `ADD` / `REDUCE` |
| `amount_change` | NUMERIC | Jumlah perubahan (positive) |
| `balance_after` | NUMERIC | Saldo setelah perubahan |
| `price_at_time` | NUMERIC | Harga USD saat dicatat |
| `note` | TEXT nullable | |
| `created_at` / `updated_at` / `deleted_at` | TIMESTAMPTZ | |

Semua tabel: RLS (`auth.uid() = user_id`), reuse `set_updated_at()` trigger, index `(user_id, updated_at DESC)`.

---

### 2. Type Definitions

#### [MODIFY] [index.ts](file:///d:/Documents/expenses-tracker/src/types/index.ts)

Append 3 interfaces di akhir file. Tidak ubah type existing:

```typescript
export interface PortfolioPocket {
  id: string;
  name: string;
  source_type: 'CEX' | 'WEB3' | 'WALLET' | 'LAINNYA';
  source?: string;
  color_theme: string;
  icon: string;
  sort_order: number;
  created_at: string;
}

export interface PortfolioAsset {
  id: string;
  pocket_id: string;
  ticker: string;
  coingecko_id?: string;
  amount: number;
  created_at: string;
}

export interface PortfolioActivityLog {
  id: string;
  pocket_id: string;
  asset_id: string;
  ticker: string;
  action: 'ADD' | 'REDUCE';
  amount_change: number;
  balance_after: number;
  price_at_time: number;
  note?: string;
  created_at: string;
}
```

---

### 3. Data Layer

#### [NEW] [portfolio-repository.ts](file:///d:/Documents/expenses-tracker/src/lib/portfolio-repository.ts)

Local-first repository (pola identik dengan `repository.ts`):
- `LocalPortfolioPocketRepo` — CRUD pockets via IDB + sync queue
- `LocalPortfolioAssetRepo` — CRUD assets via IDB + sync queue
- `LocalPortfolioActivityLogRepo` — Create + getByPocket via IDB + sync queue
- Semua pakai `readIDB`/`writeIDB`, `scopedDataKey`, `enqueueSyncUpsert`/`enqueueSyncDelete`

#### [NEW] [portfolio-sync.ts](file:///d:/Documents/expenses-tracker/src/lib/portfolio-sync.ts)

Pull/push handlers untuk 3 entity portfolio (pola identik dengan pull/push di `sync-engine.ts`):
- `pullPortfolioPockets()`, `pullPortfolioAssets()`, `pullPortfolioActivityLog()`
- `applyPortfolioPocketOp()`, `applyPortfolioAssetOp()`, `applyPortfolioActivityLogOp()`
- Normalize functions, cursor-based pagination, soft-delete handling

#### [MODIFY] [sync-engine.ts](file:///d:/Documents/expenses-tracker/src/lib/sync-engine.ts)

**Surgical changes only** — tidak ubah logic existing:

1. Extend `SyncEntity` type: tambah `'portfolio_pockets' | 'portfolio_assets' | 'portfolio_activity_log'`
2. Extend `SyncPayload` type: tambah portfolio types
3. `applyOperation()` switch: tambah 3 case baru → delegate ke `portfolio-sync.ts`
4. `pullFromRemote()`: tambah 3 pull calls + cursor management
5. `BASE_KEYS`: tambah 3 key baru

> [!IMPORTANT]
> Zero changes ke logic expenses/categories/recurring. Hanya menambahkan dispatch entries.

#### [NEW] [portfolio-prices.ts](file:///d:/Documents/expenses-tracker/src/lib/portfolio-prices.ts)

CoinGecko price service:

**Live prices:**
```
fetchCurrentPrices(coingeckoIds: string[]): Promise<Record<string, {usd: number}>>
```
- Endpoint: `GET /api/v3/simple/price?ids=bitcoin,solana&vs_currencies=usd`
- Batch up to 50 IDs per request
- In-memory cache 30s TTL (refresh saat user tap refresh button)

**Historical prices (untuk chart):**
```
fetchHistoricalPrices(coingeckoId: string, days: number): Promise<[timestamp_ms, price_usd][]>
```
- Endpoint: `GET /api/v3/coins/{id}/market_chart?vs_currency=usd&days={days}`
- CoinGecko auto-granularity: days=1 → ~5min intervals, days=7 → hourly, days=30+ → daily
- Timeframe mapping: 24H→1 day, 1W→7, 1M→30, 1Y→365, ALL→max

**Ticker → CoinGecko ID resolver:**
```
resolveCoingeckoId(ticker: string): string
```
- Hardcoded mapping populer: BTC→bitcoin, ETH→ethereum, SOL→solana, BNB→binancecoin, JUP→jupiter-exchange-solana, PYTH→pyth-network, WEN→wen-4, TNSR→tensor, dll
- Fallback: lowercase ticker sebagai ID

**Chart Value Computation — Inti dari chart line:**
```
computePortfolioValueSeries(
  assets: {coingecko_id: string, amount: number}[],
  historicalByAsset: Record<string, [timestamp_ms, price_usd][]>,
  timeframe: '24H'|'1W'|'1M'|'1Y'|'ALL'
): {timestamp: number, value: number}[]
```

Logika:
1. Fetch historical prices per aset dari CoinGecko
2. Resample ke target resolution: 24H→96 pts (15min), 1W→168 pts (hourly), 1M→30 pts, 1Y→365 pts
3. Per timestamp: **total_value = Σ(asset.amount × price_aset_pada_timestamp)**
4. Contoh: hold 5 SOL + 100 JUP → pada jam 10:00: total = 5×$148 + 100×$0.19 = $759 → pada jam 11:00: total = 5×$145 + 100×$0.20 = $745
5. Hasilnya: array of `{timestamp, value}` yang menggambarkan pergerakan total value portfolio secara real berdasarkan harga market

> [!NOTE]
> Chart BUKAN synthetic/random data. Chart line bergerak sesuai historical total value nyata dari portfolio — naik turun mengikuti harga aset yang di-hold di market.

---

### 4. State Management

#### [NEW] [usePortfolioStore.ts](file:///d:/Documents/expenses-tracker/src/store/usePortfolioStore.ts)

Zustand store (pola identik `useExpenseStore.ts`):

**State:**
- `pockets: PortfolioPocket[]`
- `assets: PortfolioAsset[]`
- `activityLogs: PortfolioActivityLog[]`
- `prices: Record<string, {usd: number}>` — current prices (not persisted)
- `isLoading`, `error`, `_hasHydrated`, `cacheScope`, `hasLoadedOnce`, `lastLoadedAt`

**Actions:**
- `loadPortfolio()` — load pockets + assets + logs dari IDB, trigger background sync
- `ensureScope(scope)` — scope switching (same pattern)
- Pocket CRUD: `addPocket()`, `updatePocket()`, `deletePocket()`
- Asset CRUD: `addAsset()`, `updateAssetAmount(id, newAmount, action, note)` — auto-creates activity log entry
- `removeAsset(id)` — soft delete asset
- `fetchPrices(pocketId)` — fetch live prices untuk semua assets di pocket
- `refreshPrices()` — force refresh, bypass cache

**Persist config:**
- `partialize`: persist `pockets`, `assets`, `activityLogs`, `cacheScope` (warm cache)
- `prices` NOT persisted — always fresh fetch saat buka kantong

#### [MODIFY] [index.ts](file:///d:/Documents/expenses-tracker/src/store/index.ts)

+1 line: `export { usePortfolioStore } from './usePortfolioStore';`

---

### 5. UI Components

#### [NEW] [src/components/portfolio/PocketList.tsx](file:///d:/Documents/expenses-tracker/src/components/portfolio/)

Halaman utama portfolio — list kantong:
- Header: back button (→ dashboard), "PORTFOLIO" label, "POCKETS" title
- Tombol `+` hijau untuk tambah kantong
- Per-kantong: kartu dengan gradient background dari `color_theme`, icon, nama, source type, jumlah aset
- Tombol `⋯` per-kartu → buka PocketSettingsSheet
- Tap kartu → set `activePocketId`
- Footer text: "PRICES REFRESH INSIDE EACH POCKET."
- Style: neo-brutalism matching app design (border, shadows, uppercase labels)

#### [NEW] [src/components/portfolio/PocketDetail.tsx](file:///d:/Documents/expenses-tracker/src/components/portfolio/)

Detail kantong (layout inspired by Pintu app, adapted to app's neo-brutalism style):
- **Header**: back button (→ pocket list), pocket name, "PORTFOLIO" label
- **Chart section**: background color dari `color_theme`
  - Total Assets value (Rp format + USD di bawah)
  - Refresh button
  - `PortfolioChart` component
  - Timeframe tabs: 24H, 1W, 1M, 1Y, ALL
- **Active Balance section**: 
  - "ACTIVE BALANCE" label + "ADD ASSET" button
  - Per-aset: ticker badge (warna hijau), nama, harga USD, jumlah, value Rp, tombol `⋯`
- **Action buttons row** (replace Deposit/Tarik/Transfer/Jual-Beli dengan):
  - Add Asset, Refresh Prices, Pocket Settings, (optional: Export)
- **Activity Feed section** di bawah

**Pada refresh/reload**: persist `activePocketId` di `sessionStorage` agar tetap di pocket yang sama.

#### [NEW] [src/components/portfolio/PortfolioChart.tsx](file:///d:/Documents/expenses-tracker/src/components/portfolio/)

Canvas-based interactive chart:

**Rendering:**
- HTML5 Canvas 2D — smooth line with gradient fill below
- Line color & gradient dari pocket's `color_theme`
- Responsive: fill container width, fixed height ~200px

**Data Input:**
- Receives `dataPoints: {timestamp: number, value: number}[]` from parent
- Ini adalah total value portfolio per timestamp (sudah dihitung di `computePortfolioValueSeries`)
- Data point resolution:
  - 24H: ~96 points (setiap 15 menit)
  - 1W: ~168 points (setiap jam)
  - 1M: ~30 points (harian)
  - 1Y: ~365 points (harian)
  - ALL: semua data tersedia

**Y-Axis Scaling:**
- **24H, 1W**: LOCAL min/max scaling → `y_min = min(data) * 0.998`, `y_max = max(data) * 1.002` — membuat fluktuasi kecil terlihat jelas
- **1M, 1Y, ALL**: ABSOLUTE scaling dari 0 atau meaningful baseline — menunjukkan trend pertumbuhan keseluruhan
- Never use fixed y-axis range across all timeframes

**Scrubbing:**
- `onMouseMove` / `onTouchMove` over canvas → show vertical crosshair line
- Crosshair snaps to nearest data point (binary search pada array)
- While scrubbing: callback `onScrub(point)` ke parent → update value display + change % di header secara realtime
- `onMouseUp` / `onTouchEnd` / `onMouseLeave`: snap back ke latest value via `onScrubEnd()`
- Floating date/time label di atas crosshair line
- Smooth crosshair movement via requestAnimationFrame

#### [NEW] [src/components/portfolio/PocketSettingsSheet.tsx](file:///d:/Documents/expenses-tracker/src/components/portfolio/)

BottomSheet (reuse existing `BottomSheet` component):
- **NAME**: text input
- **SOURCE TYPE**: toggle buttons (CEX, WEB3, WALLET, LAINNYA)
- **SOURCE**: optional text input
- **THEME**: color palette swatches (6+ colors, e.g. hijau, biru, teal, orange, merah muda, ungu)
- **ICON**: icon picker (briefcase, wallet, bank, shield, link — using Lucide icons)
- **SAVE** button (hijau)
- **DELETE POCKET** button (merah, outline) — dengan konfirmasi

#### [NEW] [src/components/portfolio/AddAssetSheet.tsx](file:///d:/Documents/expenses-tracker/src/components/portfolio/)

BottomSheet untuk tambah aset baru:
- **TICKER**: text input uppercase, dengan suggestion list token populer
- **AMOUNT**: numeric input
- **NOTE**: optional text input (e.g. "staked Project 0", "Solana")
- **ADD** button → creates asset + creates activity log entry (action=ADD) + fetch price

#### [NEW] [src/components/portfolio/AssetActionSheet.tsx](file:///d:/Documents/expenses-tracker/src/components/portfolio/)

BottomSheet untuk modify aset existing:
- Display: ticker, current amount, current price
- **Action toggle**: ADD / REDUCE
- **AMOUNT**: numeric input untuk jumlah perubahan
- **NOTE**: optional
- **APPLY** button → update asset amount, create activity log entry, refresh display
- **REMOVE ASSET** button (merah) — hapus aset entirely

#### [NEW] [src/components/portfolio/ActivityFeed.tsx](file:///d:/Documents/expenses-tracker/src/components/portfolio/)

Chronological feed dengan date headers:
- **Date grouping logic**:
  - Tanggal hari ini → "TODAY"
  - Tanggal kemarin → "YESTERDAY"  
  - Lainnya → tanggal lengkap (e.g. "28 April 2026")
- **Per-entry display**:
  - Clock icon + ticker + ADD/REDUCE badge (hijau/merah)
  - Timestamp (HH:mm) + harga USD saat dicatat
  - Optional note di bawah
  - Amount change: `+4.913` (hijau) atau `-1` (merah) di kanan
  - Balance after: `Balance 4.913 JUP`
- **TX count** per hari di header kanan

---

### 6. Page Container

#### [MODIFY] [PortfolioPage.tsx](file:///d:/Documents/expenses-tracker/src/pages/PortfolioPage.tsx)

Rewrite sebagai state-based container (bukan sub-routes):

```
PortfolioPage
├── activePocketId === null → <PocketList />
└── activePocketId !== null → <PocketDetail pocketId={activePocketId} />
```

- `activePocketId` state + persist di `sessionStorage('portfolio_active_pocket')`
- Saat refresh: baca sessionStorage → tetap di pocket yang sama
- Back dari detail → `setActivePocketId(null)` + clear sessionStorage
- Back dari list → `navigate('/')` (dashboard)

**Tidak perlu route changes** — `/portfolio` sudah ada di `App.tsx`.

---

### 7. App Integration

#### [MODIFY] [App.tsx](file:///d:/Documents/expenses-tracker/src/App.tsx)

+3 lines only di existing useEffect (line ~86-90):
```typescript
import { usePortfolioStore } from './store/usePortfolioStore';
// Inside AppInner:
const ensurePortfolioScope = usePortfolioStore((s) => s.ensureScope);
// Inside useEffect for scope management:
ensurePortfolioScope(activeScope);
```

Portfolio data is NOT loaded at app startup — only when user navigates to `/portfolio`.

---

## File Summary

| Action | File | Description |
|--------|------|-------------|
| **NEW** | `supabase/migrations/003_portfolio.sql` | 3 tables + RLS + triggers |
| **MODIFY** | `src/types/index.ts` | +3 interfaces (append) |
| **NEW** | `src/lib/portfolio-repository.ts` | Local-first CRUD |
| **NEW** | `src/lib/portfolio-sync.ts` | Pull/push sync handlers |
| **MODIFY** | `src/lib/sync-engine.ts` | +3 entity dispatch (surgical) |
| **NEW** | `src/lib/portfolio-prices.ts` | CoinGecko fetcher + historical |
| **NEW** | `src/store/usePortfolioStore.ts` | Zustand store |
| **MODIFY** | `src/store/index.ts` | +1 export |
| **NEW** | `src/components/portfolio/PocketList.tsx` | Pocket list UI |
| **NEW** | `src/components/portfolio/PocketDetail.tsx` | Detail + chart + assets |
| **NEW** | `src/components/portfolio/PortfolioChart.tsx` | Canvas chart + scrubbing |
| **NEW** | `src/components/portfolio/PocketSettingsSheet.tsx` | Create/edit pocket |
| **NEW** | `src/components/portfolio/AddAssetSheet.tsx` | Add asset |
| **NEW** | `src/components/portfolio/AssetActionSheet.tsx` | Modify asset amount |
| **NEW** | `src/components/portfolio/ActivityFeed.tsx` | Activity feed |
| **MODIFY** | `src/pages/PortfolioPage.tsx` | Container rewrite |
| **MODIFY** | `src/App.tsx` | +scope management |

**Total: 11 new files, 5 modified files**

---

## Verification Plan

### Build
- `npm run build` — TypeScript compiles tanpa error

### Browser Tests
1. Pull-to-reveal dari dashboard → portfolio page loads
2. Create pocket → muncul di list dengan warna/icon benar
3. Edit pocket settings → warna/icon/nama berubah
4. Delete pocket → hilang dari list
5. Open pocket → chart renders, prices fetch
6. Add asset (SOL) → muncul di active balance, activity log entry created
7. Modify asset amount → balance updated, new log entry
8. Chart scrubbing → crosshair, value updates, snap back
9. Timeframe switch → chart re-renders dengan scaling berbeda
10. Page refresh saat di pocket detail → tetap di pocket yang sama
11. Cross-device: create pocket di PC → muncul di mobile setelah sync

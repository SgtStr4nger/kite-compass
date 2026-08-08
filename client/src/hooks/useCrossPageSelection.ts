import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Cross-page select-all for admin data tables.
 *
 * Tracks which IDs match the *current* filters (via an `/ids` endpoint that
 * returns IDs only — never full row data) so the header checkbox reflects the
 * whole filtered result set, not just the page that happens to be visible.
 *
 * - `check`: fetch matching IDs and union them into the selection.
 * - `uncheck`: clear the entire cross-page selection.
 * - `allSelected`: `true` / `false` / `"indeterminate"` for the header checkbox.
 */
export function useCrossPageSelection({
  filterSignature,
  fetchFilteredIds,
  selectedIds,
  setSelectedIds,
  onError,
}: {
  filterSignature: string;
  fetchFilteredIds: () => Promise<number[]>;
  selectedIds: number[];
  setSelectedIds: React.Dispatch<React.SetStateAction<number[]>>;
  onError: (message: string) => void;
}) {
  const [filteredIds, setFilteredIds] = useState<number[]>([]);
  const [loadedSignature, setLoadedSignature] = useState("");
  const lastFetch = useRef<Promise<number[]> | null>(null);

  // Keep the "all matching ids" cache fresh whenever the filter set changes.
  useEffect(() => {
    if (filterSignature === loadedSignature) return;
    let cancelled = false;
    fetchFilteredIds()
      .then((ids) => {
        if (cancelled) return;
        setFilteredIds(ids);
        setLoadedSignature(filterSignature);
      })
      .catch(() => {
        if (!cancelled) onError("Could not resolve filtered rows");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterSignature]);

  const ensureIds = useCallback(async (): Promise<number[]> => {
    if (lastFetch.current) return lastFetch.current;
    const p = fetchFilteredIds();
    lastFetch.current = p;
    try {
      return await p;
    } finally {
      lastFetch.current = null;
    }
  }, [fetchFilteredIds]);

  const allSelected: boolean | "indeterminate" =
    filteredIds.length === 0
      ? false
      : filteredIds.every((id) => selectedIds.includes(id))
        ? true
        : selectedIds.length > 0
          ? "indeterminate"
          : false;

  const toggleSelectAll = async (checked: boolean) => {
    if (!checked) {
      setSelectedIds([]);
      return;
    }
    try {
      const ids = await ensureIds();
      setSelectedIds((prev) => Array.from(new Set([...prev, ...ids])));
    } catch {
      onError("Could not select all matching rows");
    }
  };

  return { allSelected, toggleSelectAll };
}

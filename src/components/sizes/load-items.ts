import { fromRow, type SizeItem, type SizeRow } from "@/lib/sizes/types";

/** The wire rows' version: a browser holding a day-old copy of an older format fetches the new one. */
const ROWS_URL = "/api/sizes?v=2";

let rowsPromise: Promise<SizeItem[]> | null = null;
/** Every figure (fetched once per page load, static and cached by the CDN). */
export function loadSizeItems(): Promise<SizeItem[]> {
  rowsPromise ??= fetch(ROWS_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`sizes ${r.status}`);
      return r.json() as Promise<SizeRow[]>;
    })
    .then((rows) => rows.map(fromRow))
    .catch((e) => {
      rowsPromise = null;
      throw e;
    });
  return rowsPromise;
}

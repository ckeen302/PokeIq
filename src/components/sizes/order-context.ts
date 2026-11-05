"use client";

import { createContext } from "react";
import type { Order } from "@/lib/sizes/order";

/** The line's order on /pokedex/sizes, shared by the 3D view and the table under it (which follows it without a reload). */
export const SizesOrderContext = createContext<{ order: Order; setOrder(o: Order): void } | null>(null);

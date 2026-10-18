"use client";

import { useEffect } from "react";
import { initAccount } from "@/lib/account";

/** Loads the signed-in trainer and starts progress sync once per page load. */
export function AccountSync() {
  useEffect(() => {
    void initAccount();
  }, []);
  return null;
}

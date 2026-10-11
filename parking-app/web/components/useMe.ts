"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Me } from "@/lib/types";

/** The signed-in driver, or null when signed out (or the API can't say). */
const fetchMe = () => api<Me>("/v1/me").catch(() => null);

/** `me` is undefined while loading, null when signed out. */
export function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetchMe().then(m => { if (live) setMe(m); });
    return () => { live = false; };
  }, []);
  const reload = useCallback(() => fetchMe().then(setMe), []);
  return { me, reload };
}

"use client";

import { useEffect } from "react";

/** Registra o service worker do PWA (public/sw.js). Sem UI própria. */
export function SwRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Falha silenciosa — PWA é um extra, não deve quebrar a aplicação.
    });
  }, []);

  return null;
}

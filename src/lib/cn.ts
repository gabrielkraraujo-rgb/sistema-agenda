import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// O design system define o degrau de fonte custom `text-13` (globals.css).
// Sem registrá-lo aqui, o tailwind-merge o classifica como COR de texto e
// descarta classes legítimas como `text-white` quando aparecem juntas
// (ex.: botão primário ficava preto com texto invisível).
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": ["text-13"] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

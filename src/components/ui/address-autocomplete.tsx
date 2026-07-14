"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { searchPlaces } from "@/server/actions/places";
import type { PlaceSuggestionDTO } from "@/lib/types";

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

export interface AddressAutocompleteValue {
  text: string;
  placeId: string | null;
}

export interface AddressAutocompleteProps {
  label?: string;
  placeholder?: string;
  error?: string;
  value: AddressAutocompleteValue;
  onChange: (value: AddressAutocompleteValue) => void;
  containerClassName?: string;
  id?: string;
}

/** Campo de endereço com sugestões do Google (Places API New), specs/08.
 * Digitar depois de selecionar uma sugestão zera `placeId` — o texto vira
 * "livre" até uma nova seleção. Sem dependências externas (dropdown próprio
 * sobre o `Input` do design system). */
export function AddressAutocomplete({
  label,
  placeholder,
  error,
  value,
  onChange,
  containerClassName,
  id,
}: AddressAutocompleteProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  const [open, setOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestionDTO[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Fecha o dropdown ao clicar/tocar fora do componente.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function scheduleSearch(query: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setLoading(false);
      setSearched(false);
      setOpen(false);
      return;
    }

    setSuggestions([]);
    setLoading(true);
    setSearched(false);
    setOpen(true);
    const requestId = ++requestIdRef.current;

    debounceRef.current = setTimeout(() => {
      searchPlaces(trimmed)
        .then((results) => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return;
          setSuggestions(results);
          setHighlightedIndex(-1);
        })
        .catch(() => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return;
          setSuggestions([]);
        })
        .finally(() => {
          if (!mountedRef.current || requestIdRef.current !== requestId) return;
          setLoading(false);
          setSearched(true);
        });
    }, DEBOUNCE_MS);
  }

  function handleInputChange(text: string) {
    // Digitar depois de selecionar uma sugestão zera o placeId — specs/08.
    onChange({ text, placeId: null });
    scheduleSearch(text);
  }

  function selectSuggestion(suggestion: PlaceSuggestionDTO) {
    requestIdRef.current++; // invalida qualquer busca pendente
    onChange({ text: suggestion.description, placeId: suggestion.placeId });
    setSuggestions([]);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || suggestions.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" && highlightedIndex >= 0) {
      event.preventDefault();
      selectSuggestion(suggestions[highlightedIndex]);
    }
  }

  const showDropdown = open && (loading || searched);

  return (
    <div ref={containerRef} className={cn("flex flex-col gap-1.5", containerClassName)}>
      {label && (
        <label htmlFor={inputId} className="text-13 font-medium text-ink-primary">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-invalid={!!error}
          autoComplete="off"
          value={value.text}
          placeholder={placeholder}
          title={value.text || undefined}
          onChange={(e) => handleInputChange(e.target.value)}
          onFocus={() => {
            if (value.text.trim().length >= MIN_CHARS && (suggestions.length > 0 || searched)) {
              setOpen(true);
            }
          }}
          onKeyDown={handleKeyDown}
          className={cn(
            // Uma linha só, cortado com reticências; o texto completo aparece
            // ao focar (edição) ou no title (hover).
            "h-10 w-full truncate rounded-sm border border-border-ring bg-bg-surface px-3 pr-9 text-sm text-ink-primary",
            "placeholder:text-ink-muted",
            "transition-shadow duration-150 ease-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-accent",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "[@media(pointer:coarse)]:h-11",
            error && "border-status-critical focus-visible:ring-status-critical",
          )}
        />
        {loading && (
          <Loader2
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-ink-muted"
            strokeWidth={2}
            aria-hidden="true"
          />
        )}

        {showDropdown && (
          <ul
            id={listboxId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-sm border border-hairline bg-bg-surface py-1 shadow-[0_4px_12px_rgba(11,11,11,0.08)]"
          >
            {suggestions.length === 0 && !loading && (
              <li className="px-3 py-2.5 text-13 text-ink-muted">Nenhuma sugestão</li>
            )}
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.placeId}
                role="option"
                aria-selected={index === highlightedIndex}
                className={cn(
                  "flex min-h-11 cursor-pointer items-center px-3 py-2.5 text-sm text-ink-primary",
                  "transition-colors duration-150 ease-out",
                  index === highlightedIndex ? "bg-bg-subtle" : "hover:bg-bg-subtle",
                )}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault(); // evita o blur do input antes do clique
                  selectSuggestion(suggestion);
                }}
              >
                {suggestion.description}
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && <p className="text-13 text-status-critical">{error}</p>}
    </div>
  );
}

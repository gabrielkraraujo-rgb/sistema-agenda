"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { testWhatsapp, updateSettings } from "@/server/actions/settings";
import type { SettingsDTO } from "@/lib/types";

interface ConfiguracoesClientProps {
  initialSettings: SettingsDTO;
}

export function ConfiguracoesClient({ initialSettings }: ConfiguracoesClientProps) {
  const { toast } = useToast();

  // ── WhatsApp (Evolution) ────────────────────────────────────────────
  const [evolutionBaseUrl, setEvolutionBaseUrl] = useState(initialSettings.evolutionBaseUrl ?? "");
  const [evolutionInstance, setEvolutionInstance] = useState(initialSettings.evolutionInstance ?? "");
  const [evolutionApiKey, setEvolutionApiKey] = useState("");
  const [evolutionApiKeySet, setEvolutionApiKeySet] = useState(initialSettings.evolutionApiKeySet);
  const [whatsappTargetNumber, setWhatsappTargetNumber] = useState(
    initialSettings.whatsappTargetNumber ?? "",
  );
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);
  const [testingWhatsapp, setTestingWhatsapp] = useState(false);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  // ── Google Maps ─────────────────────────────────────────────────────
  const [googleMapsApiKey, setGoogleMapsApiKey] = useState("");
  const [googleMapsApiKeySet, setGoogleMapsApiKeySet] = useState(initialSettings.googleMapsApiKeySet);
  const [savingMaps, setSavingMaps] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);

  // ── Notificações ─────────────────────────────────────────────────────
  const [notifyDailySummary, setNotifyDailySummary] = useState(initialSettings.notifyDailySummary);
  const [dailySummaryTime, setDailySummaryTime] = useState(initialSettings.dailySummaryTime);
  const [notifyEventReminder, setNotifyEventReminder] = useState(initialSettings.notifyEventReminder);
  const [defaultReminderMinutes, setDefaultReminderMinutes] = useState(
    initialSettings.defaultReminderMinutes,
  );
  const [notifyNewInvite, setNotifyNewInvite] = useState(initialSettings.notifyNewInvite);
  const [notifyLateAlert, setNotifyLateAlert] = useState(initialSettings.notifyLateAlert);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  async function handleSaveWhatsapp() {
    setSavingWhatsapp(true);
    setWhatsappError(null);

    const result = await updateSettings({
      evolutionBaseUrl,
      evolutionInstance,
      evolutionApiKey,
      whatsappTargetNumber,
    });

    setSavingWhatsapp(false);
    if (!result.ok) {
      setWhatsappError(result.error);
      return;
    }
    if (evolutionApiKey) {
      setEvolutionApiKeySet(true);
      setEvolutionApiKey("");
    }
    toast({ title: "Configurações do WhatsApp salvas", variant: "success" });
  }

  async function handleTestWhatsapp() {
    setTestingWhatsapp(true);
    const result = await testWhatsapp();
    setTestingWhatsapp(false);
    toast({
      title: result.ok ? "Mensagem de teste enviada" : "Não foi possível enviar",
      description: result.ok ? undefined : result.error,
      variant: result.ok ? "success" : "error",
    });
  }

  async function handleSaveMaps() {
    setSavingMaps(true);
    setMapsError(null);

    const result = await updateSettings({ googleMapsApiKey });

    setSavingMaps(false);
    if (!result.ok) {
      setMapsError(result.error);
      return;
    }
    if (googleMapsApiKey) {
      setGoogleMapsApiKeySet(true);
      setGoogleMapsApiKey("");
    }
    toast({ title: "Chave do Google Maps salva", variant: "success" });
  }

  async function handleSaveNotifications() {
    setSavingNotifications(true);
    setNotificationsError(null);

    const result = await updateSettings({
      notifyDailySummary,
      dailySummaryTime,
      notifyEventReminder,
      defaultReminderMinutes,
      notifyNewInvite,
      notifyLateAlert,
    });

    setSavingNotifications(false);
    if (!result.ok) {
      setNotificationsError(result.error);
      return;
    }
    toast({ title: "Notificações atualizadas", variant: "success" });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Input
            label="URL base da Evolution API"
            value={evolutionBaseUrl}
            onChange={(e) => setEvolutionBaseUrl(e.target.value)}
            placeholder="https://sua-evolution.exemplo.com"
          />
          <Input
            label="Instância"
            value={evolutionInstance}
            onChange={(e) => setEvolutionInstance(e.target.value)}
            placeholder="nome-da-instancia"
          />
          <div className="flex flex-col gap-1.5">
            <Input
              label="Chave da API"
              type="password"
              value={evolutionApiKey}
              onChange={(e) => setEvolutionApiKey(e.target.value)}
              placeholder={evolutionApiKeySet ? "Definida — deixe em branco para manter" : "Não definida"}
              autoComplete="off"
            />
          </div>
          <Input
            label="Número de destino"
            value={whatsappTargetNumber}
            onChange={(e) => setWhatsappTargetNumber(e.target.value)}
            placeholder="+55 11 91234-5678"
          />

          {whatsappError && <p className="text-13 text-status-critical">{whatsappError}</p>}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={handleSaveWhatsapp} loading={savingWhatsapp} className="flex-1">
              Salvar
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleTestWhatsapp}
              loading={testingWhatsapp}
              className="flex-1 gap-1.5"
            >
              <Send className="size-4" strokeWidth={2} aria-hidden="true" />
              Enviar teste
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Google Maps</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Input
            label="Chave da API"
            type="password"
            value={googleMapsApiKey}
            onChange={(e) => setGoogleMapsApiKey(e.target.value)}
            placeholder={googleMapsApiKeySet ? "Definida — deixe em branco para manter" : "Não definida"}
            autoComplete="off"
          />
          <p className="text-13 text-ink-muted">
            Habilite Routes API e Places API (New) nesta chave.
          </p>

          {mapsError && <p className="text-13 text-status-critical">{mapsError}</p>}

          <Button type="button" onClick={handleSaveMaps} loading={savingMaps}>
            Salvar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notificações</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-primary">Resumo diário</span>
            <Switch checked={notifyDailySummary} onCheckedChange={setNotifyDailySummary} aria-label="Resumo diário" />
          </div>
          <Input
            label="Horário do resumo"
            type="time"
            value={dailySummaryTime}
            onChange={(e) => setDailySummaryTime(e.target.value)}
            disabled={!notifyDailySummary}
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-primary">Lembrete antes do evento</span>
            <Switch
              checked={notifyEventReminder}
              onCheckedChange={setNotifyEventReminder}
              aria-label="Lembrete antes do evento"
            />
          </div>
          <Input
            label="Antecedência padrão (minutos)"
            type="number"
            min={0}
            max={1440}
            value={defaultReminderMinutes}
            onChange={(e) => setDefaultReminderMinutes(Number(e.target.value))}
            disabled={!notifyEventReminder}
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-primary">Novo convite</span>
            <Switch checked={notifyNewInvite} onCheckedChange={setNotifyNewInvite} aria-label="Novo convite" />
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-ink-primary">Alerta de atraso</span>
            <Switch checked={notifyLateAlert} onCheckedChange={setNotifyLateAlert} aria-label="Alerta de atraso" />
          </div>

          {notificationsError && (
            <p className="text-13 text-status-critical">{notificationsError}</p>
          )}

          <Button type="button" onClick={handleSaveNotifications} loading={savingNotifications}>
            Salvar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

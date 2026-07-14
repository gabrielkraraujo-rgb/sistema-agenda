"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, CircleAlert, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AddressAutocomplete,
  type AddressAutocompleteValue,
} from "@/components/ui/address-autocomplete";
import { useToast } from "@/components/ui/toast";
import { changePassword, logout } from "@/server/actions/auth";
import { updateProfile } from "@/server/actions/profile";
import type { ActionResult, ProfileDTO } from "@/lib/types";

async function updateProfileAction(
  _prevState: ActionResult | undefined,
  formData: FormData,
): Promise<ActionResult> {
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const addressPlaceId = String(formData.get("addressPlaceId") ?? "").trim();

  return updateProfile({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: phone || null,
    address: address || null,
    addressPlaceId: addressPlaceId || null,
  });
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}

interface PerfilClientProps {
  initialProfile: ProfileDTO;
}

export function PerfilClient({ initialProfile }: PerfilClientProps) {
  const { toast } = useToast();

  const [address, setAddress] = useState<AddressAutocompleteValue>({
    text: initialProfile.address ?? "",
    placeId: initialProfile.addressPlaceId,
  });

  const [profileState, profileAction] = useActionState(updateProfileAction, undefined);
  const [passwordState, passwordAction] = useActionState(changePassword, undefined);
  const passwordFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (profileState?.ok) {
      toast({ title: "Perfil atualizado", variant: "success" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileState]);

  useEffect(() => {
    if (passwordState?.ok) {
      toast({ title: "Senha alterada", variant: "success" });
      passwordFormRef.current?.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passwordState]);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Dados pessoais</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={profileAction} className="flex flex-col gap-4">
            <Input
              label="Nome"
              name="name"
              defaultValue={initialProfile.name}
              maxLength={120}
              required
            />
            <Input
              label="E-mail"
              name="email"
              type="email"
              defaultValue={initialProfile.email}
              required
            />
            <Input
              label="Telefone"
              name="phone"
              type="tel"
              defaultValue={initialProfile.phone ?? ""}
              placeholder="+55 11 91234-5678"
            />
            <div className="flex flex-col gap-1.5">
              <AddressAutocomplete
                label="Endereço"
                value={address}
                onChange={setAddress}
                placeholder="Rua, número, bairro, cidade"
              />
              <input type="hidden" name="address" value={address.text} />
              <input type="hidden" name="addressPlaceId" value={address.placeId ?? ""} />
              <p className="text-13 text-ink-muted">
                Usado para calcular o tempo até seus compromissos.
              </p>
              {address.text && (
                <p
                  className={
                    "flex items-center gap-1 text-13 " +
                    (address.placeId ? "text-status-good" : "text-ink-muted")
                  }
                >
                  {address.placeId ? (
                    <>
                      <CircleCheck className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                      Endereço validado
                    </>
                  ) : (
                    <>
                      <CircleAlert className="size-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
                      Endereço em texto livre — selecione uma sugestão para maior precisão
                    </>
                  )}
                </p>
              )}
            </div>

            {profileState && !profileState.ok && (
              <p className="text-13 text-status-critical">{profileState.error}</p>
            )}

            <SaveButton label="Salvar alterações" />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Trocar senha</CardTitle>
        </CardHeader>
        <CardContent>
          <form ref={passwordFormRef} action={passwordAction} className="flex flex-col gap-4">
            <Input
              label="Senha atual"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
            <Input
              label="Nova senha"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
            />

            {passwordState && !passwordState.ok && (
              <p className="text-13 text-status-critical">{passwordState.error}</p>
            )}

            <SaveButton label="Trocar senha" />
          </form>
        </CardContent>
      </Card>

      <form action={logout}>
        <Button type="submit" variant="destructive" className="w-full gap-2">
          <LogOut className="size-4" strokeWidth={2} aria-hidden="true" />
          Sair
        </Button>
      </form>
    </div>
  );
}
